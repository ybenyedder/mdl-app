import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import {
  createUserSession,
  requireAuth,
  setSessionCookie
} from '$lib/server/auth';
import { encryptText, hashPassword, hmacLookup } from '$lib/server/crypto';
import { ADHESION_METHODS, db, schoolSettings, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { createStripeCheckoutSession, getStripeConfig } from '$lib/server/stripe';
import type { RequestHandler } from './$types';

const directAdhesionSchema = z.object({
  paymentMethod: z.enum(ADHESION_METHODS).default('especes'),
  email: z.string().trim().email('Adresse email invalide').max(160).optional(),
  password: z.string().min(10, 'Mot de passe de 10 caractères minimum').max(128).optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  classe: z.string().trim().min(1).max(30).optional(),
  rgpdConsent: z.boolean().optional()
});

export const GET: RequestHandler = async ({ locals }) => {
  const [settingsRow] = await db.select().from(schoolSettings).limit(1);
  const stripeConfig = await getStripeConfig();
  return json({
    ok: true,
    schoolName: locals.settings.schoolName,
    mdlName: locals.settings.mdlName,
    schoolYear: locals.settings.schoolYear,
    membershipFeeCents: settingsRow?.membershipFeeCents ?? locals.settings.membershipFeeCents,
    registrationMode: locals.settings.registrationMode,
    stripeEnabled: stripeConfig.enabled,
    user: locals.user
      ? {
          id: locals.user.id,
          firstName: locals.user.firstName,
          lastName: locals.user.lastName,
          email: locals.user.email,
          classe: locals.user.classe,
          isAdherent: locals.user.isAdherent
        }
      : null
  });
};

export const POST: RequestHandler = async (event) => {
  const body = await parseJsonBody(event.request, directAdhesionSchema);
  const [settingsRow] = await db.select().from(schoolSettings).limit(1);
  const feeCents = settingsRow?.membershipFeeCents ?? event.locals.settings.membershipFeeCents;
  const stripeConfig = await getStripeConfig();

  let targetUser = event.locals.user;

  if (!targetUser) {
    if (event.locals.settings.registrationMode === 'invite_only') {
      throw error(403, 'Ce lycée fonctionne sur invitation uniquement.');
    }
    if (!body.email || !body.password || !body.firstName || !body.lastName || !body.classe) {
      throw error(400, 'Prénom, nom, classe, email et mot de passe sont requis.');
    }
    if (body.rgpdConsent !== true) {
      throw error(400, 'Le consentement RGPD est obligatoire.');
    }

    const normalizedEmail = body.email.trim().toLowerCase();
    const emailHash = hmacLookup(normalizedEmail);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1);

    if (existing) {
      throw error(
        409,
        'Un compte existe déjà avec cet email. Connecte-toi d’abord pour finaliser ton adhésion.'
      );
    }

    const passwordHash = await hashPassword(body.password);
    const [created] = await db
      .insert(users)
      .values({
        emailEncrypted: encryptText(normalizedEmail),
        emailHash,
        passwordHash,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        classe: body.classe.trim(),
        role: 'invite',
        isAdherent: false
      })
      .returning();

    const session = await createUserSession(created.id, event.request, true);
    setSessionCookie(event.cookies, session.rawToken, session.expiresAt);

    targetUser = {
      id: created.id,
      email: normalizedEmail,
      firstName: created.firstName,
      lastName: created.lastName,
      classe: created.classe,
      role: 'invite',
      roleLabel: 'Invité',
      permissions: [],
      customTitle: null,
      isAdherent: false,
      totpEnabled: false
    };

    await appendAuditLog({
      actorUserId: created.id,
      actorRole: 'invite',
      action: 'auth:register_via_adhesion',
      targetType: 'user',
      targetId: created.id,
      details: { classe: created.classe }
    });
  } else {
    requireAuth(event);
  }

  if (targetUser.isAdherent) {
    return json({ ok: true, alreadyAdherent: true });
  }

  const nowIso = new Date().toISOString();

  if (feeCents === 0 || body.paymentMethod === 'gratuit') {
    if (feeCents > 0 && body.paymentMethod === 'gratuit') {
      throw error(400, 'La cotisation est payante ; choisis Stripe, espèces, chèque ou virement.');
    }
    const nextRole = targetUser.role === 'invite' ? 'adherent' : targetUser.role;
    await db
      .update(users)
      .set({
        isAdherent: true,
        role: nextRole,
        adhesionMethod: 'gratuit',
        adhesionPaidAt: nowIso,
        updatedAt: nowIso
      })
      .where(eq(users.id, targetUser.id));

    await appendAuditLog({
      actorUserId: targetUser.id,
      actorRole: nextRole,
      action: 'members.direct_adhesion_activated',
      targetType: 'user',
      targetId: targetUser.id,
      details: { method: 'gratuit' }
    });

    return json({ ok: true, activated: true, paymentMethod: 'gratuit' });
  }

  if (body.paymentMethod === 'stripe') {
    if (!stripeConfig.enabled || !stripeConfig.secretKey) {
      throw error(400, 'Le paiement CB Stripe n’est pas activé par l’administrateur.');
    }
    const origin = event.url.origin;
    const session = await createStripeCheckoutSession({
      secretKey: stripeConfig.secretKey,
      currency: stripeConfig.currency,
      productName: `Cotisation annuelle ${event.locals.settings.mdlName}`,
      description: `Adhésion ${event.locals.settings.schoolYear} — ${targetUser.firstName} ${targetUser.lastName}`,
      unitAmountCents: feeCents,
      quantity: 1,
      customerEmail: targetUser.email,
      successUrl: `${origin}/adhesion?stripe_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/adhesion?stripe_status=cancel`,
      metadata: {
        kind: 'adhesion',
        userId: String(targetUser.id)
      }
    });
    return json({ ok: true, checkoutUrl: session.url, paymentMethod: 'stripe' });
  }

  // Espèces / chèque / virement : enregistré en attente de validation par le bureau
  await db
    .update(users)
    .set({
      adhesionMethod: body.paymentMethod,
      updatedAt: nowIso
    })
    .where(eq(users.id, targetUser.id));

  await appendAuditLog({
    actorUserId: targetUser.id,
    actorRole: targetUser.role,
    action: 'members.adhesion_pending_payment',
    targetType: 'user',
    targetId: targetUser.id,
    details: { method: body.paymentMethod, feeCents }
  });

  return json({
    ok: true,
    pendingValidation: true,
    paymentMethod: body.paymentMethod
  });
};
