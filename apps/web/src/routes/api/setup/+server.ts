import { error, json } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { createUserSession, hasAnyUsers, requireAuth, setSessionCookie } from '$lib/server/auth';
import { encryptText, hashPassword, hmacLookup } from '$lib/server/crypto';
import {
  db,
  events,
  meetings,
  merchItems,
  REGISTRATION_MODES,
  schoolSettings,
  users
} from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { validateLogoUrlInput } from '$lib/server/logo-validation';
import type { RequestHandler } from './$types';

const setupPayloadSchema = z.object({
  admin: z
    .object({
      firstName: z.string().trim().min(1, 'Prénom requis').max(60),
      lastName: z.string().trim().min(1, 'Nom requis').max(60),
      email: z.string().trim().email('Email invalide').max(160),
      password: z.string().min(10, '10 caractères minimum').max(128)
    })
    .optional(),
  schoolName: z.string().trim().min(2, 'Nom du lycée requis').max(120),
  schoolCity: z.string().trim().min(2, 'Ville requise (ex : Cagnes-sur-Mer)').max(100),
  schoolPostalCode: z.string().trim().max(16).default(''),
  schoolDepartment: z.string().trim().max(80).default(''),
  schoolUai: z.string().trim().max(20).nullable().optional(),
  mdlName: z.string().trim().min(2, 'Nom de la MDL requis').max(80),
  legalRepresentative: z.string().trim().max(120).default(''),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1d4ed8'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f59e0b'),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  membershipFeeCents: z.number().int().min(0).max(50_000).default(500),
  schoolYear: z.string().trim().min(4).max(20).default('2026-2027'),
  registrationMode: z.enum(REGISTRATION_MODES).default('open'),
  schoolCode: z.string().trim().max(40).nullable().optional(),
  stripeEnabled: z.boolean().optional(),
  stripePublishableKey: z.string().trim().max(250).nullable().optional(),
  stripeSecretKey: z.string().trim().max(250).nullable().optional(),
  stripeWebhookSecret: z.string().trim().max(250).nullable().optional(),
  merchSupplierName: z.string().trim().max(120).default(''),
  merchSupplierEmail: z.string().trim().max(160).default(''),
  merchSupplierUrl: z.string().trim().max(300).default(''),
  createStarterKit: z.boolean().default(false),
  markCompleted: z.boolean().default(true)
});

export const GET: RequestHandler = async ({ locals }) => {
  const [settingsRow, usersCountRow, eventsCountRow, merchCountRow, meetingsCountRow] =
    await Promise.all([
      db.select().from(schoolSettings).limit(1),
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(events),
      db.select({ value: count() }).from(merchItems),
      db.select({ value: count() }).from(meetings)
    ]);

  const row = settingsRow[0];
  const usersTotal = Number(usersCountRow[0]?.value ?? 0);
  const eventsTotal = Number(eventsCountRow[0]?.value ?? 0);
  const merchTotal = Number(merchCountRow[0]?.value ?? 0);
  const meetingsTotal = Number(meetingsCountRow[0]?.value ?? 0);

  return json({
    ok: true,
    needsAdminBootstrap: usersTotal === 0,
    setupCompleted: Boolean(row?.setupCompleted),
    checklist: {
      hasAdmin: usersTotal > 0,
      hasLocation: Boolean(row?.schoolName && row?.schoolCity),
      hasBranding: Boolean(row?.mdlName && row?.primaryColor),
      hasStripe: Boolean(row?.stripeEnabled && (row?.stripeSecretKeyEncrypted || process.env.STRIPE_SECRET_KEY)),
      hasSupplier: Boolean(row?.merchSupplierName),
      hasEvents: eventsTotal > 0,
      hasMerch: merchTotal > 0,
      hasMeetings: meetingsTotal > 0
    },
    school: {
      schoolName: row?.schoolName ?? locals.settings.schoolName,
      schoolCity: row?.schoolCity ?? locals.settings.schoolCity,
      schoolPostalCode: row?.schoolPostalCode ?? locals.settings.schoolPostalCode,
      schoolDepartment: row?.schoolDepartment ?? locals.settings.schoolDepartment,
      schoolUai: row?.schoolUai ?? locals.settings.schoolUai,
      mdlName: row?.mdlName ?? locals.settings.mdlName,
      legalRepresentative: row?.legalRepresentative ?? '',
      primaryColor: row?.primaryColor ?? locals.settings.primaryColor,
      accentColor: row?.accentColor ?? locals.settings.accentColor,
      logoUrl: row?.logoUrl ?? locals.settings.logoUrl,
      membershipFeeCents: row?.membershipFeeCents ?? locals.settings.membershipFeeCents,
      schoolYear: row?.schoolYear ?? locals.settings.schoolYear,
      registrationMode: row?.registrationMode ?? locals.settings.registrationMode,
      stripeEnabled: locals.settings.stripeEnabled,
      stripePublishableKey: locals.settings.stripePublishableKey,
      merchSupplierName: row?.merchSupplierName ?? '',
      merchSupplierEmail: row?.merchSupplierEmail ?? '',
      merchSupplierUrl: row?.merchSupplierUrl ?? ''
    }
  });
};

export const POST: RequestHandler = async (event) => {
  const usersExist = await hasAnyUsers();
  let actor = event.locals.user;

  if (usersExist) {
    actor = requireAuth(event, 'admin:settings');
  }

  const body = await parseJsonBody(event.request, setupPayloadSchema);

  if (!usersExist && !body.admin) {
    throw error(400, 'Crée d’abord le compte Administrateur / Président pour initialiser la plateforme.');
  }

  const [existing] = await db.select().from(schoolSettings).limit(1);

  if (body.registrationMode === 'school_code' && !existing?.schoolCodeHash && !body.schoolCode?.trim()) {
    throw error(400, 'Saisis un code secret d’établissement ou choisis un autre mode d’inscription.');
  }

  if (body.stripePublishableKey && !body.stripePublishableKey.startsWith('pk_')) {
    throw error(400, 'La clé publique Stripe doit commencer par pk_test_ ou pk_live_.');
  }
  if (
    body.stripeSecretKey &&
    !body.stripeSecretKey.startsWith('sk_') &&
    !body.stripeSecretKey.startsWith('rk_')
  ) {
    throw error(400, 'La clé secrète Stripe doit commencer par sk_test_, sk_live_ ou rk_.');
  }
  if (body.stripeWebhookSecret && !body.stripeWebhookSecret.startsWith('whsec_')) {
    throw error(400, 'Le secret webhook Stripe doit commencer par whsec_.');
  }

  const nowIso = new Date().toISOString();
  let bootstrappedUserId: number | null = null;

  if (!usersExist && body.admin) {
    const normalizedEmail = body.admin.email.trim().toLowerCase();
    const passwordHash = await hashPassword(body.admin.password);
    const [createdAdmin] = await db
      .insert(users)
      .values({
        emailEncrypted: encryptText(normalizedEmail),
        emailHash: hmacLookup(normalizedEmail),
        passwordHash,
        firstName: body.admin.firstName.trim(),
        lastName: body.admin.lastName.trim(),
        classe: 'Bureau MDL',
        role: 'president',
        customTitle: 'Président / Admin MDL',
        isAdherent: true,
        adhesionMethod: 'gratuit',
        adhesionPaidAt: nowIso
      })
      .returning();

    bootstrappedUserId = createdAdmin.id;
    const session = await createUserSession(createdAdmin.id, event.request, true);
    setSessionCookie(event.cookies, session.rawToken, session.expiresAt);
  }

  const nextSecretEncrypted =
    body.stripeSecretKey !== undefined
      ? body.stripeSecretKey
        ? encryptText(body.stripeSecretKey)
        : null
      : (existing?.stripeSecretKeyEncrypted ?? null);

  const nextWebhookEncrypted =
    body.stripeWebhookSecret !== undefined
      ? body.stripeWebhookSecret
        ? encryptText(body.stripeWebhookSecret)
        : null
      : (existing?.stripeWebhookSecretEncrypted ?? null);

  const nextSchoolCodeHash =
    body.schoolCode !== undefined
      ? body.schoolCode
        ? hmacLookup(body.schoolCode)
        : null
      : (existing?.schoolCodeHash ?? null);

  const nextStripeEnabled =
    body.stripeEnabled !== undefined ? body.stripeEnabled : (existing?.stripeEnabled ?? false);

  if (nextStripeEnabled && !nextSecretEncrypted && !process.env.STRIPE_SECRET_KEY?.trim()) {
    throw error(400, 'Renseigne ta clé secrète Stripe (sk_...) pour activer le paiement CB.');
  }

  let nextLogoUrl: string | null = existing?.logoUrl ?? null;
  if (body.logoUrl !== undefined) {
    const logoCheck = await validateLogoUrlInput(body.logoUrl);
    if (!logoCheck.ok) {
      throw error(400, logoCheck.error);
    }
    nextLogoUrl = logoCheck.value;
  }

  const values = {
    schoolName: body.schoolName,
    schoolCity: body.schoolCity,
    schoolPostalCode: body.schoolPostalCode,
    schoolDepartment: body.schoolDepartment,
    schoolUai: body.schoolUai ?? null,
    mdlName: body.mdlName,
    legalRepresentative: body.legalRepresentative,
    primaryColor: body.primaryColor,
    accentColor: body.accentColor,
    logoUrl: nextLogoUrl,
    membershipFeeCents: body.membershipFeeCents,
    schoolYear: body.schoolYear,
    registrationMode: body.registrationMode,
    schoolCodeHash: nextSchoolCodeHash,
    stripeEnabled: nextStripeEnabled,
    stripePublishableKey:
      body.stripePublishableKey !== undefined
        ? body.stripePublishableKey || null
        : (existing?.stripePublishableKey ?? null),
    stripeSecretKeyEncrypted: nextSecretEncrypted,
    stripeWebhookSecretEncrypted: nextWebhookEncrypted,
    merchSupplierName: body.merchSupplierName,
    merchSupplierEmail: body.merchSupplierEmail,
    merchSupplierUrl: body.merchSupplierUrl,
    setupCompleted: body.markCompleted,
    updatedAt: nowIso
  };

  if (existing) {
    await db.update(schoolSettings).set(values).where(eq(schoolSettings.id, existing.id));
  } else {
    await db.insert(schoolSettings).values(values);
  }

  const effectiveActorId = actor?.id ?? bootstrappedUserId;

  if (body.createStarterKit) {
    const [existingMerch] = await db.select({ id: merchItems.id }).from(merchItems).limit(1);
    if (!existingMerch) {
      await db.insert(merchItems).values({
        title: `Pull de promo ${body.schoolYear} (${body.mdlName})`,
        description: `Sweat à capuche 320g coton bio brodé aux couleurs de ${body.schoolName} (${body.schoolCity}). Précommande zéro avance.`,
        category: 'pull',
        priceCents: 2900,
        supplierCostCents: 1850,
        supplierName: body.merchSupplierName,
        supplierEmail: body.merchSupplierEmail,
        supplierUrl: body.merchSupplierUrl,
        sizesJson: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        isActive: true,
        zeroAdvanceMode: true,
        createdBy: effectiveActorId
      });
    }

    const [existingEvent] = await db.select({ id: events.id }).from(events).limit(1);
    if (!existingEvent && effectiveActorId) {
      await db.insert(events).values({
        title: `Journée d'accueil ${body.mdlName}`,
        description: `Présentation des clubs, adhésions et animations au foyer de ${body.schoolName}.`,
        eventDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        location: `Foyer · ${body.schoolName}`,
        capacity: 150,
        priceFullCents: 200,
        priceReducedCents: 0,
        pricePresaleCents: 0,
        isPublic: true
      });
    }

    const [existingMeeting] = await db.select({ id: meetings.id }).from(meetings).limit(1);
    if (!existingMeeting && effectiveActorId) {
      await db.insert(meetings).values({
        title: `Réunion de lancement ${body.mdlName}`,
        description: 'Répartition des rôles, budget prévisionnel et calendrier des événements.',
        scope: 'bureau',
        scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        location: `Foyer MDL · ${body.schoolCity}`,
        agendaJson: [
          { title: 'Installation du bureau & rôles', durationMin: 15, done: false },
          { title: 'Calendrier boutique & événements', durationMin: 20, done: false }
        ],
        status: 'planifiee',
        createdBy: effectiveActorId
      });
    }
  }

  await appendAuditLog({
    actorUserId: effectiveActorId,
    actorRole: 'president',
    action: usersExist ? 'admin.setup_wizard_updated' : 'admin.setup_bootstrapped',
    targetType: 'school_settings',
    targetId: 1,
    details: {
      schoolName: body.schoolName,
      schoolCity: body.schoolCity,
      createStarterKit: body.createStarterKit,
      stripeEnabled: nextStripeEnabled
    }
  });

  return json({ ok: true, setupCompleted: body.markCompleted });
};
