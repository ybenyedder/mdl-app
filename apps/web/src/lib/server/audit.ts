import { createHash } from 'node:crypto';
import { desc, asc } from 'drizzle-orm';
import { db } from './db';
import { auditLogs } from './db/schema';

export function computeAuditEntryHash(
  prevHash: string,
  payload: {
    actorUserId: number | null;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string | null;
    detailsJson: string;
    createdAt: string;
  }
): string {
  const canonical = JSON.stringify({
    prevHash,
    actorUserId: payload.actorUserId,
    actorRole: payload.actorRole,
    action: payload.action,
    targetType: payload.targetType,
    targetId: payload.targetId,
    detailsJson: payload.detailsJson,
    createdAt: payload.createdAt
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function appendAuditLog(input: {
  actorUserId: number | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const [latest] = await db
    .select({ entryHash: auditLogs.entryHash })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1);

  const prevHash = latest?.entryHash ?? 'GENESIS';
  const createdAt = new Date().toISOString();
  const targetId =
    input.targetId !== undefined && input.targetId !== null ? String(input.targetId) : null;
  const detailsJson = JSON.stringify(input.details ?? {});

  const entryHash = computeAuditEntryHash(prevHash, {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId,
    detailsJson,
    createdAt
  });

  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId,
    detailsJson,
    prevHash,
    entryHash,
    createdAt
  });
}

export async function verifyAuditChain(): Promise<{
  valid: boolean;
  total: number;
  brokenAtId?: number;
}> {
  const rows = await db.select().from(auditLogs).orderBy(asc(auditLogs.id));
  let expectedPrev = 'GENESIS';

  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      // Autoriser l'ancre initiale seed si la base démarre sur un enregistrement genesis personnalisé
      if (row.id === rows[0]?.id && row.prevHash === '0'.repeat(64)) {
        expectedPrev = row.entryHash;
        continue;
      }
      return { valid: false, total: rows.length, brokenAtId: row.id };
    }
    if (row.id === rows[0]?.id && row.prevHash === '0'.repeat(64)) {
      expectedPrev = row.entryHash;
      continue;
    }
    const recomputed = computeAuditEntryHash(row.prevHash, {
      actorUserId: row.actorUserId,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detailsJson: row.detailsJson,
      createdAt: new Date(row.createdAt).toISOString()
    });
    if (recomputed !== row.entryHash) {
      // Vérifier aussi avec row.createdAt brut si déjà formaté ISO identique
      const rawRecomputed = computeAuditEntryHash(row.prevHash, {
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        detailsJson: row.detailsJson,
        createdAt: row.createdAt
      });
      if (rawRecomputed !== row.entryHash) {
        return { valid: false, total: rows.length, brokenAtId: row.id };
      }
    }
    expectedPrev = row.entryHash;
  }

  return { valid: true, total: rows.length };
}
