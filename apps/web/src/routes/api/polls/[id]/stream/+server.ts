import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { polls } from '$lib/server/db/schema';
import { createSseResponse, parsePositiveIntId, safeJsonParse } from '$lib/server/http';
import { canAccessPollScope, computePollTally } from '$lib/server/polls';
import { registerSseClient } from '$lib/server/sse';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'polls:read');
  const id = parsePositiveIntId(event.params.id, 'Sondage');

  const [poll] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
  if (!poll) {
    throw error(404, 'Sondage introuvable.');
  }

  if (!canAccessPollScope(user, poll.scope)) {
    throw error(403, 'Accès refusé à ce sondage.');
  }

  const options = safeJsonParse<string[]>(poll.optionsJson, []);
  const initialTally = await computePollTally(id, options.length);

  return createSseResponse((controller) => {
    const unregister = registerSseClient(`poll:${id}`, controller);
    try {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: results\ndata: ${JSON.stringify(initialTally)}\n\n`)
      );
    } catch {
      unregister();
    }
    return unregister;
  });
};
