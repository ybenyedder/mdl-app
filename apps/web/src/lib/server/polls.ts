import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pollVotes, type PollScope } from '$lib/server/db/schema';
import { safeJsonParse } from '$lib/server/http';
import { isBureauRole } from '$shared/permissions';

export function canAccessPollScope(
  user: NonNullable<App.Locals['user']>,
  scope: PollScope
): boolean {
  if (scope === 'bureau') {
    return isBureauRole(user.role);
  }
  if (scope === 'adherents') {
    return user.isAdherent || isBureauRole(user.role);
  }
  return true;
}

export interface PollTally {
  pollId: number;
  counts: number[];
  totalVotes: number;
}

export async function computePollTally(pollId: number, optionCount: number): Promise<PollTally> {
  const votes = await db
    .select({ optionIndexesJson: pollVotes.optionIndexesJson })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId));

  const counts = new Array<number>(optionCount).fill(0);
  for (const vote of votes) {
    const indexes = safeJsonParse<number[]>(vote.optionIndexesJson, []);
    for (const idx of indexes) {
      if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) {
        counts[idx] += 1;
      }
    }
  }

  return {
    pollId,
    counts,
    totalVotes: votes.length
  };
}
