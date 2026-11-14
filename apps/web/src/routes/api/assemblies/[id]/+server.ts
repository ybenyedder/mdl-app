import { error, json } from '@sveltejs/kit';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
  agAttendances,
  agCandidates,
  agVotes,
  assemblies,
  ASSEMBLY_STATUSES,
  users,
  type AssemblyStatus
} from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { hasPermission } from '$shared/permissions';
import { candidateCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const STATUS_RANK: Record<AssemblyStatus, number> = {
  brouillon: 0,
  candidatures: 1,
  vote_ouvert: 2,
  cloturee: 3
};

const assemblyPatchSchema = z.object({
  status: z.enum(ASSEMBLY_STATUSES).optional(),
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().max(2000).optional(),
  scheduledAt: z.string().trim().min(8).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  quorumRequired: z.number().int().min(1).max(2000).optional(),
  voteOpensAt: z.string().trim().nullable().optional(),
  voteClosesAt: z.string().trim().nullable().optional()
});

const attendancePostSchema = z.object({
  action: z.literal('attendance'),
  present: z.boolean().default(true),
  targetUserId: z.number().int().positive().optional()
});

const candidatePostSchema = candidateCreateSchema.extend({
  action: z.literal('candidate').optional()
});

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:read');
  const id = parsePositiveIntId(event.params.id, 'Assemblée');

  const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
  if (!assembly) {
    throw error(404, 'Assemblée générale introuvable.');
  }

  const [candidates, attendances, voteStats, blankStats, userVoteRow, userAttendanceRow] =
    await Promise.all([
      db
        .select()
        .from(agCandidates)
        .where(eq(agCandidates.assemblyId, id))
        .orderBy(asc(agCandidates.positionTitle), desc(agCandidates.votesCount), asc(agCandidates.id)),
      db
        .select({
          id: agAttendances.id,
          userId: agAttendances.userId,
          present: agAttendances.present,
          signedAt: agAttendances.signedAt,
          firstName: users.firstName,
          lastName: users.lastName,
          classe: users.classe,
          role: users.role
        })
        .from(agAttendances)
        .innerJoin(users, eq(agAttendances.userId, users.id))
        .where(eq(agAttendances.assemblyId, id))
        .orderBy(desc(agAttendances.signedAt)),
      db
        .select({ total: count() })
        .from(agVotes)
        .where(eq(agVotes.assemblyId, id)),
      db
        .select({ total: count() })
        .from(agVotes)
        .where(and(eq(agVotes.assemblyId, id), eq(agVotes.isBlank, true))),
      db
        .select({ id: agVotes.id })
        .from(agVotes)
        .where(
          and(
            eq(agVotes.assemblyId, id),
            eq(agVotes.voterId, user.id),
            eq(agVotes.anonymized, false)
          )
        )
        .limit(1),
      db
        .select({ id: agAttendances.id, present: agAttendances.present })
        .from(agAttendances)
        .where(and(eq(agAttendances.assemblyId, id), eq(agAttendances.userId, user.id)))
        .limit(1)
    ]);

  const totalVotes = Number(voteStats[0]?.total ?? 0);
  const blankVotes = Number(blankStats[0]?.total ?? 0);
  const presentCount = attendances.filter((a) => a.present).length;

  return json({
    assembly,
    candidates,
    attendances,
    tally: {
      totalVotes,
      blankVotes,
      presentCount,
      quorumReached: presentCount >= assembly.quorumRequired || totalVotes >= assembly.quorumRequired
    },
    hasVoted: userVoteRow.length > 0,
    hasSignedAttendance: Boolean(userAttendanceRow[0]?.present)
  });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:manage');
  const id = parsePositiveIntId(event.params.id, 'Assemblée');
  const body = await parseJsonBody(event.request, assemblyPatchSchema);

  const [existing] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
  if (!existing) {
    throw error(404, 'Assemblée générale introuvable.');
  }

  if (body.status && STATUS_RANK[body.status] < STATUS_RANK[existing.status]) {
    throw error(
      400,
      `Transition de statut interdite : ${existing.status} vers ${body.status}.`
    );
  }

  const updates: Partial<typeof assemblies.$inferInsert> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.location !== undefined) updates.location = body.location;
  if (body.quorumRequired !== undefined) updates.quorumRequired = body.quorumRequired;

  if (body.scheduledAt !== undefined) {
    const dt = new Date(body.scheduledAt);
    if (Number.isNaN(dt.getTime())) throw error(400, 'Date de séance invalide.');
    updates.scheduledAt = dt.toISOString();
  }
  if (body.voteOpensAt !== undefined) {
    if (body.voteOpensAt === null || body.voteOpensAt === '') {
      updates.voteOpensAt = null;
    } else {
      const dt = new Date(body.voteOpensAt);
      if (Number.isNaN(dt.getTime())) throw error(400, 'Date d’ouverture invalide.');
      updates.voteOpensAt = dt.toISOString();
    }
  }
  if (body.voteClosesAt !== undefined) {
    if (body.voteClosesAt === null || body.voteClosesAt === '') {
      updates.voteClosesAt = null;
    } else {
      const dt = new Date(body.voteClosesAt);
      if (Number.isNaN(dt.getTime())) throw error(400, 'Date de clôture invalide.');
      updates.voteClosesAt = dt.toISOString();
    }
  }

  const nowIso = new Date().toISOString();
  const closingNow = body.status === 'cloturee' && existing.status !== 'cloturee';
  const openingVoteNow = body.status === 'vote_ouvert' && existing.status !== 'vote_ouvert';

  if (body.status) {
    updates.status = body.status;
    if (openingVoteNow && updates.voteOpensAt === undefined && !existing.voteOpensAt) {
      updates.voteOpensAt = nowIso;
    }
    if (closingNow && updates.voteClosesAt === undefined) {
      updates.voteClosesAt = nowIso;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw error(400, 'Aucune modification fournie.');
  }

  let anonymizedCount = 0;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(assemblies)
      .set(updates)
      .where(eq(assemblies.id, id))
      .returning();

    if (closingNow) {
      const anonymizedRows = await tx
        .update(agVotes)
        .set({ voterId: null, anonymized: true })
        .where(and(eq(agVotes.assemblyId, id), eq(agVotes.anonymized, false)))
        .returning({ id: agVotes.id });
      anonymizedCount = anonymizedRows.length;
    }

    return row;
  });

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: closingNow ? 'ag:close_anonymize' : 'ag:update',
    targetType: 'assembly',
    targetId: id,
    details: {
      previousStatus: existing.status,
      newStatus: updated.status,
      anonymizedVotes: anonymizedCount
    }
  });

  return json({ assembly: updated, anonymizedVotes: anonymizedCount });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:read');
  const id = parsePositiveIntId(event.params.id, 'Assemblée');

  const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
  if (!assembly) {
    throw error(404, 'Assemblée générale introuvable.');
  }

  let rawBody: unknown;
  try {
    rawBody = await event.request.json();
  } catch {
    throw error(400, 'Corps JSON invalide.');
  }

  const isAttendance =
    typeof rawBody === 'object' &&
    rawBody !== null &&
    (rawBody as { action?: unknown }).action === 'attendance';

  if (isAttendance) {
    const parsed = attendancePostSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw error(400, parsed.error.issues[0]?.message || 'Données d’émargement invalides.');
    }

    if (assembly.status === 'cloturee') {
      throw error(400, 'L’émargement est clos pour cette assemblée.');
    }

    const targetUserId = parsed.data.targetUserId ?? user.id;
    if (targetUserId !== user.id && !hasPermission(user.role, 'ag:manage')) {
      throw error(403, 'Vous ne pouvez signer l’émargement que pour votre propre compte.');
    }

    const [targetUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
      .limit(1);
    if (!targetUser) {
      throw error(404, 'Adhérent introuvable.');
    }

    const nowIso = new Date().toISOString();
    const [attendance] = await db
      .insert(agAttendances)
      .values({
        assemblyId: id,
        userId: targetUserId,
        present: parsed.data.present,
        signedAt: nowIso
      })
      .onConflictDoUpdate({
        target: [agAttendances.assemblyId, agAttendances.userId],
        set: { present: parsed.data.present, signedAt: nowIso }
      })
      .returning();

    await appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ag:attendance_sign',
      targetType: 'assembly',
      targetId: id,
      details: { targetUserId, present: parsed.data.present }
    });

    return json({ attendance }, { status: 201 });
  }

  if (assembly.status !== 'candidatures') {
    throw error(400, 'Le dépôt de candidatures n’est ouvert que lorsque le statut est "candidatures".');
  }

  const parsedCandidate = candidatePostSchema.safeParse(rawBody);
  if (!parsedCandidate.success) {
    throw error(400, parsedCandidate.error.issues[0]?.message || 'Candidature invalide.');
  }

  const [candidate] = await db
    .insert(agCandidates)
    .values({
      assemblyId: id,
      userId: user.id,
      fullName: parsedCandidate.data.fullName,
      classe: parsedCandidate.data.classe,
      positionTitle: parsedCandidate.data.positionTitle,
      professionOfFaith: parsedCandidate.data.professionOfFaith,
      approved: true
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ag:candidate_create',
    targetType: 'ag_candidate',
    targetId: candidate.id,
    details: { assemblyId: id, positionTitle: candidate.positionTitle }
  });

  return json({ candidate }, { status: 201 });
};
