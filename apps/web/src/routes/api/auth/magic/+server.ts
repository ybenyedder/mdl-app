import { json, redirect } from '@sveltejs/kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { enforceRateLimit } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { createUserSession, getClientIpHash, setSessionCookie } from '$lib/server/auth';
import { generateRandomToken, hashToken, hmacLookup, decryptText, verifyTotpCode } from '$lib/server/crypto';
import { db, sessions, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { sendOptionalEmail } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

const magicRequestSchema = z.object({
  email: z.string().trim().email('Adresse email invalide').max(160)
});

const magicTotpVerifySchema = z.object({
  totpCode: z.string().trim().regex(/^\d{6}$/, 'Code 2FA à 6 chiffres requis')
});

const MAGIC_TTL_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ request, url }) => {
  const ipHash = getClientIpHash(request);
  const limited = await enforceRateLimit(`magic:${ipHash}`, 10, 15 * 60 * 1000);
  if (limited) return limited;

  const { email } = await parseJsonBody(request, magicRequestSchema);

  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = hmacLookup(normalizedEmail);

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.emailHash, emailHash), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    return json({
      ok: true,
      message: 'Si un compte existe avec cet email, un lien de connexion a été envoyé.'
    });
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MS).toISOString();

  await db
    .update(users)
    .set({
      magicTokenHash: tokenHash,
      magicTokenExpiresAt: expiresAt,
      updatedAt: nowIso
    })
    .where(eq(users.id, user.id));

  const baseUrl = (process.env.PUBLIC_APP_URL?.trim() || url.origin).replace(/\/$/, '');
  const magicUrl = `${baseUrl}/api/auth/magic?token=${encodeURIComponent(rawToken)}`;

  const emailResult = await sendOptionalEmail({
    to: normalizedEmail,
    subject: 'Votre lien de connexion — MDL Connect',
    text: `Bonjour,\n\nCliquez sur ce lien valable 15 minutes pour vous connecter à MDL Connect :\n${magicUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`
  });

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.magic_requested',
    targetType: 'user',
    targetId: user.id,
    details: { emailSent: emailResult.sent }
  });

  if (!emailResult.sent) {
    if (process.env.NODE_ENV !== 'production') {
      return json({
        ok: true,
        previewMagicUrl: magicUrl,
        message: 'SMTP non configuré : lien de prévisualisation généré (hors production).'
      });
    }

    return json({
      ok: true,
      message: "Service d'envoi d'email non configuré. Contactez un administrateur."
    });
  }

  return json({
    ok: true,
    message: 'Si un compte existe avec cet email, un lien de connexion a été envoyé.'
  });
};

export const GET: RequestHandler = async ({ url, request, cookies }) => {
  const rawToken = url.searchParams.get('token')?.trim();
  if (!rawToken || rawToken.length < 16) {
    return json({ error: 'Lien magique manquant ou invalide.' }, { status: 400 });
  }

  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      totpEnabled: users.totpEnabled
    })
    .from(users)
    .where(
      and(
        eq(users.magicTokenHash, tokenHash),
        gt(users.magicTokenExpiresAt, nowIso),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  if (!user) {
    return json({ error: 'Lien magique invalide ou expiré.' }, { status: 400 });
  }

  const [consumed] = await db
    .update(users)
    .set({
      magicTokenHash: null,
      magicTokenExpiresAt: null,
      updatedAt: nowIso
    })
    .where(and(eq(users.id, user.id), eq(users.magicTokenHash, tokenHash)))
    .returning({ id: users.id });

  if (!consumed) {
    return json({ error: 'Lien magique déjà utilisé.' }, { status: 400 });
  }

  const { rawToken: sessionToken, expiresAt } = await createUserSession(
    user.id,
    request,
    !user.totpEnabled
  );
  setSessionCookie(cookies, sessionToken, expiresAt);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.magic_login',
    targetType: 'user',
    targetId: user.id,
    details: { totpRequired: user.totpEnabled }
  });

  if (user.totpEnabled) {
    redirect(302, '/connexion?totp=1');
  }

  redirect(302, '/dashboard');
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
  const ipHash = getClientIpHash(request);
  const limited = await enforceRateLimit(`magic-totp:${ipHash}`, 10, 15 * 60 * 1000);
  if (limited) return limited;

  const session = locals.session;
  if (!session) {
    return json({ error: 'Session expirée. Redemande un lien magique.' }, { status: 401 });
  }

  const { totpCode } = await parseJsonBody(request, magicTotpVerifySchema);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      role: users.role,
      totpEnabled: users.totpEnabled,
      totpSecretEncrypted: users.totpSecretEncrypted
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, session.id), isNull(users.deletedAt)))
    .limit(1);

  if (!row || !row.totpEnabled || !row.totpSecretEncrypted) {
    return json({ error: 'Validation 2FA indisponible pour cette session.' }, { status: 400 });
  }

  let secret = '';
  try {
    secret = decryptText(row.totpSecretEncrypted);
  } catch {
    return json({ error: 'Impossible de vérifier le secret 2FA.' }, { status: 500 });
  }

  if (!verifyTotpCode(secret, totpCode)) {
    return json({ error: 'Code 2FA invalide.' }, { status: 401 });
  }

  await db
    .update(sessions)
    .set({ twoFactorVerified: true })
    .where(eq(sessions.id, row.sessionId));

  await appendAuditLog({
    actorUserId: row.userId,
    actorRole: row.role,
    action: 'auth.magic_totp_verified',
    targetType: 'user',
    targetId: row.userId
  });

  return json({ ok: true });
};
