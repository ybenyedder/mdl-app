import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import {
  decryptText,
  encryptText,
  generateTotpSecret,
  generateTotpUri,
  verifyPassword,
  verifyTotpCode
} from '$lib/server/crypto';
import { db, sessions, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { generateQrSvg } from '$lib/server/tickets';
import type { RequestHandler } from './$types';

const totpActivateSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres requis')
});

const totpDisableSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis')
});

export const POST: RequestHandler = async (event) => {
  const actor = requireAuth(event);

  const [userRow] = await db
    .select({
      id: users.id,
      totpEnabled: users.totpEnabled
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!userRow) {
    return json({ error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  if (userRow.totpEnabled) {
    return json(
      { error: 'La double authentification est déjà activée.' },
      { status: 409 }
    );
  }

  const secret = generateTotpSecret();
  const encryptedSecret = encryptText(secret);
  const nowIso = new Date().toISOString();

  await db
    .update(users)
    .set({
      totpSecretEncrypted: encryptedSecret,
      totpEnabled: false,
      updatedAt: nowIso
    })
    .where(eq(users.id, actor.id));

  const issuer = event.locals.settings.mdlName || 'MDL Connect';
  const otpauthUri = generateTotpUri(secret, actor.email, issuer);
  const qrSvg = await generateQrSvg(otpauthUri);
  const qrSvgUri = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'auth.totp_setup',
    targetType: 'user',
    targetId: actor.id
  });

  return json({
    ok: true,
    secret,
    otpauthUri,
    qrSvg,
    qrSvgUri
  });
};

export const PUT: RequestHandler = async (event) => {
  const actor = requireAuth(event);
  const { code } = await parseJsonBody(event.request, totpActivateSchema);

  const [userRow] = await db
    .select({
      id: users.id,
      totpSecretEncrypted: users.totpSecretEncrypted
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!userRow?.totpSecretEncrypted) {
    return json(
      { error: "Initialisez d'abord la configuration 2FA (POST)." },
      { status: 400 }
    );
  }

  let secret = '';
  try {
    secret = decryptText(userRow.totpSecretEncrypted);
  } catch {
    return json({ error: 'Secret TOTP illisible.' }, { status: 500 });
  }

  if (!verifyTotpCode(secret, code)) {
    return json({ error: 'Code TOTP invalide.' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  await db
    .update(users)
    .set({ totpEnabled: true, updatedAt: nowIso })
    .where(eq(users.id, actor.id));

  if (event.locals.session) {
    await db
      .update(sessions)
      .set({ twoFactorVerified: true })
      .where(eq(sessions.id, event.locals.session.id));
  }

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'auth.totp_enabled',
    targetType: 'user',
    targetId: actor.id
  });

  return json({ ok: true, totpEnabled: true });
};

export const DELETE: RequestHandler = async (event) => {
  const actor = requireAuth(event);
  const { password } = await parseJsonBody(event.request, totpDisableSchema);

  const [userRow] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!userRow?.passwordHash) {
    return json(
      { error: 'Aucun mot de passe défini sur ce compte.' },
      { status: 400 }
    );
  }

  const valid = await verifyPassword(userRow.passwordHash, password);
  if (!valid) {
    return json({ error: 'Mot de passe incorrect.' }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpSecretEncrypted: null,
      updatedAt: nowIso
    })
    .where(eq(users.id, actor.id));

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'auth.totp_disabled',
    targetType: 'user',
    targetId: actor.id
  });

  return json({ ok: true, totpEnabled: false });
};
