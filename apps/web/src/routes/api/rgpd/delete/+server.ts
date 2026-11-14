import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { verifyPassword } from '$lib/server/crypto';
import { db, users } from '$lib/server/db';
import type { RequestHandler } from './$types';

const rgpdDeleteSchema = z.object({
  cancel: z.boolean().optional().default(false),
  password: z.string().optional()
});

const GRACE_PERIOD_DAYS = 30;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
  const actor = requireAuth(event);

  let cancel = false;
  let password: string | undefined;

  const contentLength = event.request.headers.get('content-length');
  if (contentLength !== '0') {
    try {
      const text = await event.request.text();
      if (text.trim().length > 0) {
        const parsed = rgpdDeleteSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          return json({ error: 'Requête invalide.' }, { status: 400 });
        }
        cancel = parsed.data.cancel;
        password = parsed.data.password;
      }
    } catch {
      return json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }
  }

  const [userRow] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!userRow) {
    return json({ error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  if (cancel) {
    await db
      .update(users)
      .set({
        deletionRequestedAt: null,
        updatedAt: nowIso
      })
      .where(eq(users.id, actor.id));

    await appendAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'rgpd.deletion_cancelled',
      targetType: 'user',
      targetId: actor.id
    });

    return json({
      ok: true,
      deletionRequestedAt: null,
      scheduledDeletionAt: null,
      message: 'Demande de suppression annulée.'
    });
  }

  if (password !== undefined && userRow.passwordHash) {
    const valid = await verifyPassword(userRow.passwordHash, password);
    if (!valid) {
      return json({ error: 'Mot de passe incorrect.' }, { status: 403 });
    }
  }

  const scheduledDeletionAt = new Date(Date.now() + GRACE_PERIOD_MS).toISOString();

  await db
    .update(users)
    .set({
      deletionRequestedAt: nowIso,
      updatedAt: nowIso
    })
    .where(eq(users.id, actor.id));

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'rgpd.deletion_requested',
    targetType: 'user',
    targetId: actor.id,
    details: { scheduledDeletionAt, gracePeriodDays: GRACE_PERIOD_DAYS }
  });

  return json({
    ok: true,
    deletionRequestedAt: nowIso,
    scheduledDeletionAt,
    gracePeriodDays: GRACE_PERIOD_DAYS,
    message: 'Suppression programmée dans 30 jours. Vous pouvez annuler avant cette échéance.'
  });
};
