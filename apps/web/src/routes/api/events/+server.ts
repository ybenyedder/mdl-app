import { error, json } from '@sveltejs/kit';
import { asc, count, eq, ne } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { events, projects, tickets } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { getStripeConfig } from '$lib/server/stripe';
import { hasAnyPermission, hasPermission } from '$shared/permissions';
import { eventCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user;
  const canManage = user ? hasAnyPermission(user.role, ['tickets:manage', 'tickets:read_admin']) : false;

  const [eventRows, soldCounts, stripeConfig] = await Promise.all([
    canManage
      ? db.select().from(events).orderBy(asc(events.eventDate), asc(events.id))
      : db
          .select()
          .from(events)
          .where(eq(events.isPublic, true))
          .orderBy(asc(events.eventDate), asc(events.id)),
    db
      .select({ eventId: tickets.eventId, sold: count() })
      .from(tickets)
      .where(ne(tickets.paymentStatus, 'annule'))
      .groupBy(tickets.eventId),
    getStripeConfig()
  ]);

  const soldMap = new Map(soldCounts.map((r) => [r.eventId, Number(r.sold)]));
  const canSeeAccessCode = user ? hasPermission(user.role, 'tickets:manage') : false;

  return json({
    events: eventRows.map((ev) => {
      const soldCount = soldMap.get(ev.id) ?? 0;
      return {
        id: ev.id,
        projectId: ev.projectId,
        title: ev.title,
        description: ev.description,
        eventDate: ev.eventDate,
        location: ev.location,
        capacity: ev.capacity,
        soldCount,
        remainingSeats: Math.max(0, ev.capacity - soldCount),
        priceFullCents: ev.priceFullCents,
        priceReducedCents: ev.priceReducedCents,
        pricePresaleCents: ev.pricePresaleCents,
        requiresAccessCode: Boolean(ev.accessCode),
        ...(canSeeAccessCode ? { accessCode: ev.accessCode } : {}),
        isPublic: ev.isPublic,
        stripeEnabled: stripeConfig.enabled,
        createdAt: ev.createdAt
      };
    })
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'tickets:manage');
  const body = await parseJsonBody(event.request, eventCreateSchema);

  const eventDate = new Date(body.eventDate);
  if (Number.isNaN(eventDate.getTime())) {
    throw error(400, 'Date d’événement invalide.');
  }

  if (body.projectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);
    if (!proj) {
      throw error(400, 'Projet associé introuvable.');
    }
  }

  const stripeConfig = await getStripeConfig();
  const [created] = await db
    .insert(events)
    .values({
      projectId: body.projectId ?? null,
      title: body.title,
      description: body.description,
      eventDate: eventDate.toISOString(),
      location: body.location,
      capacity: body.capacity,
      priceFullCents: body.priceFullCents,
      priceReducedCents: body.priceReducedCents,
      pricePresaleCents: body.pricePresaleCents,
      accessCode: body.accessCode && body.accessCode.length > 0 ? body.accessCode : null,
      isPublic: body.isPublic,
      stripeEnabled: stripeConfig.enabled
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'event:create',
    targetType: 'event',
    targetId: created.id,
    details: { title: created.title, capacity: created.capacity }
  });

  return json(
    {
      event: {
        ...created,
        soldCount: 0,
        remainingSeats: created.capacity,
        requiresAccessCode: Boolean(created.accessCode)
      }
    },
    { status: 201 }
  );
};
