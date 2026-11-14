import { error, json } from '@sveltejs/kit';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { agCandidates, agVotes, assemblies, VOTE_CAST_MODES } from '$lib/server/db/schema';
import { isPgErrorCode, parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { checkRateLimit } from '$lib/server/rate-limit';
import { broadcastSse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

const voteSchema = z
  .object({
    candidateId: z.number().int().positive().nullable().optional(),
    isBlank: z.boolean().default(false),
    castMode: z.enum(VOTE_CAST_MODES).default('en_ligne')
  })
  .refine(
    (data) => (data.isBlank ? data.candidateId == null : typeof data.candidateId === 'number'),
    { message: 'Sélectionnez un candidat valide ou un vote blanc.' }
  );

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:vote');
  if (!user.isAdherent) {
    throw error(403, 'Seuls les adhérents à jour de cotisation peuvent participer au vote.');
  }

  const rl = await checkRateLimit(`vote:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    throw error(429, `Trop de tentatives de vote. Réessayez dans ${rl.retryAfterSeconds}s.`);
  }

  const id = parsePositiveIntId(event.params.id, 'Assemblée');
  const body = await parseJsonBody(event.request, voteSchema);

  let tallyResult: {
    assemblyId: number;
    totalVotes: number;
    blankVotes: number;
    candidates: Array<{
      id: number;
      fullName: string;
      positionTitle: string;
      votesCount: number;
    }>;
  };

  try {
    tallyResult = await db.transaction(async (tx) => {
      const [assembly] = await tx
        .select()
        .from(assemblies)
        .where(eq(assemblies.id, id))
        .limit(1);

      if (!assembly) {
        throw error(404, 'Assemblée générale introuvable.');
      }

      if (assembly.status !== 'vote_ouvert') {
        throw error(400, 'Le scrutin n’est pas ouvert pour cette assemblée.');
      }

      if (!body.isBlank && body.candidateId) {
        const [candidate] = await tx
          .select({ id: agCandidates.id })
          .from(agCandidates)
          .where(
            and(
              eq(agCandidates.id, body.candidateId),
              eq(agCandidates.assemblyId, id),
              eq(agCandidates.approved, true)
            )
          )
          .limit(1);

        if (!candidate) {
          throw error(404, 'Candidat introuvable ou non approuvé pour cette assemblée.');
        }
      }

      await tx.insert(agVotes).values({
        assemblyId: id,
        voterId: user.id,
        candidateId: body.isBlank ? null : body.candidateId!,
        isBlank: body.isBlank,
        castMode: body.castMode,
        anonymized: false
      });

      if (!body.isBlank && body.candidateId) {
        await tx
          .update(agCandidates)
          .set({ votesCount: sql`${agCandidates.votesCount} + 1` })
          .where(and(eq(agCandidates.id, body.candidateId), eq(agCandidates.assemblyId, id)));
      }

      const [candidates, totalRow, blankRow] = await Promise.all([
        tx
          .select({
            id: agCandidates.id,
            fullName: agCandidates.fullName,
            positionTitle: agCandidates.positionTitle,
            votesCount: agCandidates.votesCount
          })
          .from(agCandidates)
          .where(eq(agCandidates.assemblyId, id))
          .orderBy(desc(agCandidates.votesCount)),
        tx.select({ total: count() }).from(agVotes).where(eq(agVotes.assemblyId, id)),
        tx
          .select({ total: count() })
          .from(agVotes)
          .where(and(eq(agVotes.assemblyId, id), eq(agVotes.isBlank, true)))
      ]);

      return {
        assemblyId: id,
        totalVotes: Number(totalRow[0]?.total ?? 0),
        blankVotes: Number(blankRow[0]?.total ?? 0),
        candidates
      };
    });
  } catch (err) {
    if (isPgErrorCode(err, '23505')) {
      throw error(409, 'Vous avez déjà voté lors de cette assemblée générale.');
    }
    throw err;
  }

  broadcastSse(`ag:${id}`, 'tally', tallyResult);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ag:vote_cast',
    targetType: 'assembly',
    targetId: id,
    details: { castMode: body.castMode }
  });

  return json({ recorded: true, tally: tallyResult }, { status: 201 });
};
