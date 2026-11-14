import { error, json } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { hmacLookup } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { pollVotes, polls } from '$lib/server/db/schema';
import { parseJsonBody, safeJsonParse } from '$lib/server/http';
import { canAccessPollScope } from '$lib/server/polls';
import { pollCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'polls:read');

  const [pollRows, allVotes] = await Promise.all([
    db.select().from(polls).orderBy(desc(polls.createdAt), desc(polls.id)),
    db
      .select({
        pollId: pollVotes.pollId,
        voterKeyHash: pollVotes.voterKeyHash,
        optionIndexesJson: pollVotes.optionIndexesJson
      })
      .from(pollVotes)
  ]);

  const votesByPoll = new Map<number, typeof allVotes>();
  for (const v of allVotes) {
    const list = votesByPoll.get(v.pollId) ?? [];
    list.push(v);
    votesByPoll.set(v.pollId, list);
  }

  const visiblePolls = pollRows
    .filter((p) => canAccessPollScope(user, p.scope))
    .map((p) => {
      const options = safeJsonParse<string[]>(p.optionsJson, []);
      const counts = new Array<number>(options.length).fill(0);
      const votes = votesByPoll.get(p.id) ?? [];
      const userVoterHash = hmacLookup(`poll:${p.id}:user:${user.id}`);
      let hasVoted = false;

      for (const v of votes) {
        if (v.voterKeyHash === userVoterHash) {
          hasVoted = true;
        }
        const indexes = safeJsonParse<number[]>(v.optionIndexesJson, []);
        for (const idx of indexes) {
          if (Number.isInteger(idx) && idx >= 0 && idx < counts.length) {
            counts[idx] += 1;
          }
        }
      }

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        scope: p.scope,
        options,
        isOpen: p.isOpen,
        multipleChoice: p.multipleChoice,
        closesAt: p.closesAt,
        createdAt: p.createdAt,
        counts,
        totalVotes: votes.length,
        hasVoted
      };
    });

  return json({ polls: visiblePolls });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'polls:create');
  const body = await parseJsonBody(event.request, pollCreateSchema);

  let closesAt: string | null = null;
  if (body.closesAt) {
    const dt = new Date(body.closesAt);
    if (Number.isNaN(dt.getTime())) {
      throw error(400, 'Date de clôture invalide.');
    }
    closesAt = dt.toISOString();
  }

  const [created] = await db
    .insert(polls)
    .values({
      title: body.title,
      description: body.description,
      scope: body.scope,
      optionsJson: JSON.stringify(body.options),
      isOpen: true,
      multipleChoice: body.multipleChoice,
      createdBy: user.id,
      closesAt
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'poll:create',
    targetType: 'poll',
    targetId: created.id,
    details: { title: created.title, scope: created.scope }
  });

  return json(
    {
      poll: {
        ...created,
        options: body.options,
        counts: new Array<number>(body.options.length).fill(0),
        totalVotes: 0,
        hasVoted: false
      }
    },
    { status: 201 }
  );
};
