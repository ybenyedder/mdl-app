import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { enforceRateLimit } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { createUserSession, getClientIpHash, setSessionCookie } from '$lib/server/auth';
import { encryptText, hashPassword, hashToken, hmacLookup } from '$lib/server/crypto';
import { db, invitations, schoolSettings, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { registerSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const registerPayloadSchema = registerSchema.extend({
  inviteToken: z.string().trim().min(10).max(256).optional()
});

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const ipHash = getClientIpHash(request);
  const limited = await enforceRateLimit(`reg:${ipHash}`, 10, 60 * 60 * 1000);
  if (limited) return limited;

  const {
    email,
    password,
    firstName,
    lastName,
    classe,
    schoolCode,
    legalGuardianEmail,
    inviteToken
  } = await parseJsonBody(request, registerPayloadSchema);

  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = hmacLookup(normalizedEmail);
  const nowIso = new Date().toISOString();

  const [settingsRow] = await db.select().from(schoolSettings).limit(1);
  const registrationMode = settingsRow?.registrationMode ?? locals.settings.registrationMode;

  let validInvitation: typeof invitations.$inferSelect | null = null;
  if (inviteToken) {
    const tokenHash = hashToken(inviteToken);
    const [inv] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, nowIso)
        )
      )
      .limit(1);

    if (!inv) {
      return json({ error: "Jeton d'invitation invalide ou expiré." }, { status: 403 });
    }
    if (!hashesEqual(inv.emailHash, emailHash)) {
      return json(
        { error: "Cette invitation n'est pas associée à cette adresse email." },
        { status: 403 }
      );
    }
    validInvitation = inv;
  }

  if (!validInvitation) {
    if (registrationMode === 'invite_only') {
      return json(
        { error: 'Les inscriptions sont réservées aux personnes invitées.' },
        { status: 403 }
      );
    }

    if (registrationMode === 'school_code') {
      const expectedHash = settingsRow?.schoolCodeHash;
      if (!expectedHash || !schoolCode || !hashesEqual(hmacLookup(schoolCode), expectedHash)) {
        return json({ error: 'Code établissement invalide.' }, { status: 403 });
      }
    }
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailHash, emailHash))
    .limit(1);

  if (existingUser) {
    return json(
      { error: 'Un compte existe déjà avec cette adresse email.' },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const emailEncrypted = encryptText(normalizedEmail);
  const cleanGuardianEmail = legalGuardianEmail?.trim().toLowerCase();
  const legalGuardianEmailEncrypted = cleanGuardianEmail
    ? encryptText(cleanGuardianEmail)
    : null;

  const assignedRole = validInvitation ? validInvitation.role : 'adherent';
  const assignedCustomTitle = validInvitation ? validInvitation.customTitle : null;

  const createdUser = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(users)
      .values({
        emailEncrypted,
        emailHash,
        legalGuardianEmailEncrypted,
        passwordHash,
        firstName,
        lastName,
        classe,
        role: assignedRole,
        customTitle: assignedCustomTitle,
        isAdherent: false
      })
      .returning();

    if (validInvitation) {
      await tx
        .update(invitations)
        .set({ acceptedAt: nowIso })
        .where(eq(invitations.id, validInvitation.id));
    }

    return inserted;
  });

  const { rawToken, expiresAt } = await createUserSession(createdUser.id, request, true);
  setSessionCookie(cookies, rawToken, expiresAt);

  await appendAuditLog({
    actorUserId: createdUser.id,
    actorRole: createdUser.role,
    action: 'auth.register',
    targetType: 'user',
    targetId: createdUser.id,
    details: {
      registrationMode,
      viaInvitation: Boolean(validInvitation)
    }
  });

  return json(
    {
      ok: true,
      user: {
        id: createdUser.id,
        email: normalizedEmail,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        classe: createdUser.classe,
        role: createdUser.role,
        customTitle: createdUser.customTitle,
        isAdherent: createdUser.isAdherent,
        totpEnabled: createdUser.totpEnabled
      }
    },
    { status: 201 }
  );
};
