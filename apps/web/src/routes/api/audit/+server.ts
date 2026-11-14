import { json } from '@sveltejs/kit';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { verifyAuditChain } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { auditLogs } from '$lib/server/db/schema';
import { safeJsonParse } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'audit:read');

  const rawLimit = Number.parseInt(event.url.searchParams.get('limit') || '100', 10);
  const rawOffset = Number.parseInt(event.url.searchParams.get('offset') || '0', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  const actionFilter = event.url.searchParams.get('action')?.trim();
  const targetTypeFilter = event.url.searchParams.get('targetType')?.trim();

  const conditions: SQL[] = [];
  if (actionFilter) conditions.push(eq(auditLogs.action, actionFilter));
  if (targetTypeFilter) conditions.push(eq(auditLogs.targetType, targetTypeFilter));

  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows, chain] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereExpr)
      .orderBy(desc(auditLogs.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLogs).where(whereExpr),
    verifyAuditChain()
  ]);

  return json({
    logs: rows.map((row) => ({
      ...row,
      details: safeJsonParse<Record<string, unknown>>(row.detailsJson, {})
    })),
    total: Number(totalRows[0]?.total ?? 0),
    limit,
    offset,
    chain
  });
};
