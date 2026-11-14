import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { enforceRateLimit, safeDecrypt } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { createUserSession, getClientIpHash, setSessionCookie } from '$lib/server/auth';
import { decryptText, hmacLookup, verifyPassword, verifyTotpCode } from '$lib/server/crypto';
import { db, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { loginSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const ipHash = getClientIpHash(request);
  const ipLimited = await enforceRateLimit(`login:${ipHash}`, 120, 15 * 60 * 1000);
  if (ipLimited) return ipLimited;

  const { email, password, totpCode } = await parseJsonBody(request, loginSchema);
  const emailHash = hmacLookup(email);
  const acctLimited = await enforceRateLimit(
    `login-acct:${ipHash}:${emailHash}`,
    15,
    15 * 60 * 1000
  );
  if (acctLimited) return acctLimited;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.emailHash, emailHash), isNull(users.deletedAt)))
    .limit(1);

  if (!user || !user.passwordHash) {
    return json({ error: 'Email ou mot de passe incorrect.' }, { status: 401 });
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    return json({ error: 'Email ou mot de passe incorrect.' }, { status: 401 });
  }

  if (user.totpEnabled) {
    const cleanTotp = totpCode?.trim();
    if (!cleanTotp) {
      return json({ requiresTotp: true });
    }

    if (!user.totpSecretEncrypted) {
      return json({ error: 'Configuration 2FA invalide.' }, { status: 500 });
    }

    let secret = '';
    try {
      secret = decryptText(user.totpSecretEncrypted);
    } catch {
      return json({ error: 'Impossible de vérifier le secret 2FA.' }, { status: 500 });
    }

    if (!verifyTotpCode(secret, cleanTotp)) {
      return json({ error: 'Code 2FA invalide.', requiresTotp: true }, { status: 401 });
    }
  }

  const { rawToken, expiresAt } = await createUserSession(user.id, request, true);
  setSessionCookie(cookies, rawToken, expiresAt);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    details: {
      totpUsed: user.totpEnabled
    }
  });

  return json({
    ok: true,
    user: {
      id: user.id,
      email: safeDecrypt(user.emailEncrypted, email.trim().toLowerCase()),
      firstName: user.firstName,
      lastName: user.lastName,
      classe: user.classe,
      role: user.role,
      customTitle: user.customTitle,
      isAdherent: user.isAdherent,
      totpEnabled: user.totpEnabled
    }
  });
};
