import { error, json } from '@sveltejs/kit';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { agAttendances, agCandidates, assemblies } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { assemblyCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const assemblyPostSchema = assemblyCreateSchema.extend({
  voteOpensAt: z.string().trim().optional(),
  voteClosesAt: z.string().trim().optional()
});

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'ag:read');

  const [assemblyRows, candidateCounts, attendanceCounts] = await Promise.all([
    db.select().from(assemblies).orderBy(desc(assemblies.scheduledAt), desc(assemblies.id)),
    db
      .select({ assemblyId: agCandidates.assemblyId, total: count() })
      .from(agCandidates)
      .groupBy(agCandidates.assemblyId),
    db
      .select({ assemblyId: agAttendances.assemblyId, total: count() })
      .from(agAttendances)
      .where(eq(agAttendances.present, true))
      .groupBy(agAttendances.assemblyId)
  ]);

  const candMap = new Map(candidateCounts.map((r) => [r.assemblyId, Number(r.total)]));
  const attMap = new Map(attendanceCounts.map((r) => [r.assemblyId, Number(r.total)]));

  return json({
    assemblies: assemblyRows.map((a) => ({
      ...a,
      candidatesCount: candMap.get(a.id) ?? 0,
      attendancesCount: attMap.get(a.id) ?? 0
    }))
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:manage');
  const body = await parseJsonBody(event.request, assemblyPostSchema);

  const scheduledDate = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    throw error(400, 'Date de séance invalide.');
  }

  let voteOpensAt: string | null = null;
  if (body.voteOpensAt) {
    const dt = new Date(body.voteOpensAt);
    if (Number.isNaN(dt.getTime())) throw error(400, 'Date d’ouverture du vote invalide.');
    voteOpensAt = dt.toISOString();
  }

  let voteClosesAt: string | null = null;
  if (body.voteClosesAt) {
    const dt = new Date(body.voteClosesAt);
    if (Number.isNaN(dt.getTime())) throw error(400, 'Date de clôture du vote invalide.');
    voteClosesAt = dt.toISOString();
  }

  const [created] = await db
    .insert(assemblies)
    .values({
      title: body.title,
      description: body.description,
      scheduledAt: scheduledDate.toISOString(),
      location: body.location,
      status: 'brouillon',
      voteOpensAt,
      voteClosesAt,
      quorumRequired: body.quorumRequired,
      createdBy: user.id
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ag:create',
    targetType: 'assembly',
    targetId: created.id,
    details: { title: created.title, scheduledAt: created.scheduledAt }
  });

  return json({ assembly: created }, { status: 201 });
};
