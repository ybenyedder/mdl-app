import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { hmacLookup } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { polls, pollVotes } from '$lib/server/db/schema';
import { isPgErrorCode, parseJsonBody, parsePositiveIntId, safeJsonParse } from '$lib/server/http';
import { canAccessPollScope, computePollTally } from '$lib/server/polls';
import { broadcastSse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

const pollVoteSchema = z.object({
  optionIndexes: z.array(z.number().int().min(0).max(50)).min(1).max(10)
});

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'polls:vote');
  const id = parsePositiveIntId(event.params.id, 'Sondage');
  const body = await parseJsonBody(event.request, pollVoteSchema);

  const [poll] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
  if (!poll) {
    throw error(404, 'Sondage introuvable.');
  }

  if (!canAccessPollScope(user, poll.scope)) {
    throw error(403, `Ce sondage est réservé à la portée "${poll.scope}".`);
  }

  if (!poll.isOpen || (poll.closesAt && new Date(poll.closesAt).getTime() < Date.now())) {
    throw error(400, 'Ce sondage est clos.');
  }

  const options = safeJsonParse<string[]>(poll.optionsJson, []);
  const uniqueIndexes = [...new Set(body.optionIndexes)];

  if (!poll.multipleChoice && uniqueIndexes.length !== 1) {
    throw error(400, 'Ce sondage n’autorise qu’un seul choix.');
  }

  for (const idx of uniqueIndexes) {
    if (idx < 0 || idx >= options.length) {
      throw error(400, 'Option de vote invalide.');
    }
  }

  const voterKeyHash = hmacLookup(`poll:${id}:user:${user.id}`);

  try {
    await db.insert(pollVotes).values({
      pollId: id,
      voterKeyHash,
      optionIndexesJson: JSON.stringify(uniqueIndexes)
    });
  } catch (err) {
    if (isPgErrorCode(err, '23505')) {
      throw error(409, 'Vous avez déjà participé à ce sondage.');
    }
    throw err;
  }

  const tally = await computePollTally(id, options.length);
  broadcastSse(`poll:${id}`, 'results', tally);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'poll:vote',
    targetType: 'poll',
    targetId: id
  });

  return json({ recorded: true, tally }, { status: 201 });
};
