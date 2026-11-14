import { error } from '@sveltejs/kit';
import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, tickets } from '$lib/server/db/schema';
import { createSseResponse, parsePositiveIntId } from '$lib/server/http';
import { registerSseClient } from '$lib/server/sse';
import { hasAnyPermission } from '$shared/permissions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const id = parsePositiveIntId(event.params.id, 'Événement');
  const [ev] = await db.select().from(events).where(eq(events.id, id)).limit(1);

  if (!ev) {
    throw error(404, 'Événement introuvable.');
  }

  const user = event.locals.user;
  if (
    !ev.isPublic &&
    (!user || !hasAnyPermission(user.role, ['tickets:manage', 'tickets:read_admin']))
  ) {
    throw error(403, 'Accès refusé à cet événement privé.');
  }

  const [soldRow] = await db
    .select({ sold: count() })
    .from(tickets)
    .where(and(eq(tickets.eventId, id), ne(tickets.paymentStatus, 'annule')));

  const soldCount = Number(soldRow?.sold ?? 0);
  const initialPayload = {
    eventId: id,
    capacity: ev.capacity,
    soldCount,
    remainingSeats: Math.max(0, ev.capacity - soldCount)
  };

  return createSseResponse((controller) => {
    const unregister = registerSseClient(`event:${id}`, controller);
    try {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: seats\ndata: ${JSON.stringify(initialPayload)}\n\n`)
      );
    } catch {
      unregister();
    }
    return unregister;
  });
};
