import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { safeDecrypt } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { encryptText, generateRandomToken, hashToken, hmacLookup } from '$lib/server/crypto';
import { ADHESION_METHODS, db, invitations, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { sendOptionalEmail } from '$lib/server/notifications';
import { findRoleBySlug } from '$lib/server/roles';
import { hasPermission, isElevatedRole, type Role } from '$shared/permissions';
import { roleSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const inviteCreateSchema = z.object({
  action: z.literal('invite').optional().default('invite'),
  email: z.string().trim().email('Email invalide').max(160),
  role: roleSchema.default('adherent'),
  customTitle: z.string().trim().max(80).nullable().optional()
});

const isoDateSchema = z
  .string()
  .trim()
  .refine((val) => !Number.isNaN(Date.parse(val)), 'Date invalide');

const manualAdhesionExistingSchema = z.object({
  action: z.literal('adhesion'),
  userId: z.number().int().positive(),
  adhesionMethod: z.enum(ADHESION_METHODS).default('especes'),
  adhesionPaidAt: isoDateSchema.optional()
});

const manualAdhesionNewMemberSchema = z.object({
  action: z.literal('adhesion'),
  email: z.string().trim().email('Email invalide').max(160),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  classe: z.string().trim().min(1).max(30),
  adhesionMethod: z.enum(ADHESION_METHODS).default('especes'),
  adhesionPaidAt: isoDateSchema.optional()
});

const postMemberSchema = z.union([
  manualAdhesionExistingSchema,
  manualAdhesionNewMemberSchema,
  inviteCreateSchema
]);

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'members:read');

  const [memberRows, invitationRows] = await Promise.all([
    db
      .select({
        id: users.id,
        emailEncrypted: users.emailEncrypted,
        firstName: users.firstName,
        lastName: users.lastName,
        classe: users.classe,
        role: users.role,
        customTitle: users.customTitle,
        isAdherent: users.isAdherent,
        adhesionPaidAt: users.adhesionPaidAt,
        adhesionMethod: users.adhesionMethod,
        totpEnabled: users.totpEnabled,
        deletionRequestedAt: users.deletionRequestedAt,
        createdAt: users.createdAt
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({
        id: invitations.id,
        emailEncrypted: invitations.emailEncrypted,
        role: invitations.role,
        customTitle: invitations.customTitle,
        invitedBy: invitations.invitedBy,
        acceptedAt: invitations.acceptedAt,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt
      })
      .from(invitations)
      .orderBy(desc(invitations.createdAt))
  ]);

  const members = memberRows.map((row) => ({
    id: row.id,
    email: safeDecrypt(row.emailEncrypted, 'chiffrement-indisponible'),
    firstName: row.firstName,
    lastName: row.lastName,
    classe: row.classe,
    role: row.role,
    customTitle: row.customTitle,
    isAdherent: row.isAdherent,
    adhesionPaidAt: row.adhesionPaidAt,
    adhesionMethod: row.adhesionMethod,
    totpEnabled: row.totpEnabled,
    deletionRequestedAt: row.deletionRequestedAt,
    createdAt: row.createdAt
  }));

  const inviteList = invitationRows.map((inv) => ({
    id: inv.id,
    email: safeDecrypt(inv.emailEncrypted, 'chiffrement-indisponible'),
    role: inv.role,
    customTitle: inv.customTitle,
    invitedBy: inv.invitedBy,
    acceptedAt: inv.acceptedAt,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt
  }));

  return json({
    ok: true,
    members,
    invitations: inviteList
  });
};

export const POST: RequestHandler = async (event) => {
  const payload = await parseJsonBody(event.request, postMemberSchema);
  const nowIso = new Date().toISOString();

  if (payload.action === 'adhesion') {
    const actor = requireAuth(event, 'members:manage');
    const adhesionMethod = payload.adhesionMethod ?? 'especes';
    const paidAt = payload.adhesionPaidAt
      ? new Date(payload.adhesionPaidAt).toISOString()
      : nowIso;

    if ('userId' in payload) {
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
        .limit(1);

      if (!target) {
        return json({ error: 'Membre introuvable.' }, { status: 404 });
      }

      const [updated] = await db
        .update(users)
        .set({
          isAdherent: true,
          adhesionMethod,
          adhesionPaidAt: paidAt,
          updatedAt: nowIso
        })
        .where(eq(users.id, target.id))
        .returning({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          classe: users.classe,
          role: users.role,
          isAdherent: users.isAdherent,
          adhesionMethod: users.adhesionMethod,
          adhesionPaidAt: users.adhesionPaidAt
        });

      await appendAuditLog({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'members.adhesion_recorded',
        targetType: 'user',
        targetId: updated.id,
        details: { adhesionMethod }
      });

      return json({ ok: true, member: updated });
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const emailHash = hmacLookup(normalizedEmail);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1);

    if (existing) {
      return json(
        { error: 'Un compte existe déjà avec cette adresse email.' },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(users)
      .values({
        emailEncrypted: encryptText(normalizedEmail),
        emailHash,
        passwordHash: null,
        firstName: payload.firstName,
        lastName: payload.lastName,
        classe: payload.classe,
        role: 'adherent',
        isAdherent: true,
        adhesionMethod,
        adhesionPaidAt: paidAt
      })
      .returning({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        classe: users.classe,
        role: users.role,
        isAdherent: users.isAdherent,
        adhesionMethod: users.adhesionMethod,
        adhesionPaidAt: users.adhesionPaidAt
      });

    await appendAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'members.manual_adhesion_created',
      targetType: 'user',
      targetId: created.id,
      details: { adhesionMethod }
    });

    return json(
      { ok: true, member: { ...created, email: normalizedEmail } },
      { status: 201 }
    );
  }

  const actor = requireAuth(event, 'members:invite');
  const { email, customTitle } = payload;
  const role: Role = payload.role ?? 'adherent';

  const targetRoleDef = await findRoleBySlug(role);
  if (!targetRoleDef) {
    return json({ error: `Rôle introuvable : ${role}.` }, { status: 400 });
  }

  if (role === 'president' && actor.role !== 'president') {
    return json(
      { error: 'Seul un président peut inviter avec le rôle président.' },
      { status: 403 }
    );
  }

  if ((targetRoleDef.isElevated || isElevatedRole(role)) && !hasPermission(actor.role, 'admin:roles')) {
    return json(
      { error: 'Permission admin:roles requise pour attribuer ce rôle.' },
      { status: 403 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = hmacLookup(normalizedEmail);

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.emailHash, emailHash), isNull(users.deletedAt)))
    .limit(1);

  if (existingUser) {
    return json(
      { error: 'Un membre actif existe déjà avec cet email.' },
      { status: 409 }
    );
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const [createdInvite] = await db
    .insert(invitations)
    .values({
      emailHash,
      emailEncrypted: encryptText(normalizedEmail),
      role,
      customTitle: customTitle ?? null,
      tokenHash,
      invitedBy: actor.id,
      expiresAt
    })
    .returning({
      id: invitations.id,
      role: invitations.role,
      customTitle: invitations.customTitle,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt
    });

  const baseUrl = (process.env.PUBLIC_APP_URL?.trim() || event.url.origin).replace(/\/$/, '');
  const inviteUrl = `${baseUrl}/inscription?invite=${encodeURIComponent(rawToken)}`;

  const emailResult = await sendOptionalEmail({
    to: normalizedEmail,
    subject: `Invitation à rejoindre ${event.locals.settings.mdlName}`,
    text: `Bonjour,\n\nVous avez été invité(e) à rejoindre ${event.locals.settings.mdlName} (${event.locals.settings.schoolName}).\nUtilisez ce lien pour créer votre compte :\n${inviteUrl}\n`
  });

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'members.invite_created',
    targetType: 'invitation',
    targetId: createdInvite.id,
    details: { role, emailSent: emailResult.sent }
  });

  return json(
    {
      ok: true,
      invitation: {
        ...createdInvite,
        email: normalizedEmail
      },
      ...(!emailResult.sent && process.env.NODE_ENV !== 'production'
        ? { previewInviteUrl: inviteUrl }
        : {})
    },
    { status: 201 }
  );
};
