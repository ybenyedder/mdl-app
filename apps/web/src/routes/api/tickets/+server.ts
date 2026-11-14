import { randomUUID, timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { and, count, desc, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { decryptText, encryptText, generateRandomToken, hmacLookup } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { events, PAYMENT_STATUSES, tickets, type TicketTier } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { broadcastSse } from '$lib/server/sse';
import { createStripeCheckoutSession, getStripeConfig } from '$lib/server/stripe';
import {
  generateQrSvg,
  signTicketEd25519Qr,
  signTicketJwt
} from '$lib/server/tickets';
import { hasPermission } from '$shared/permissions';
import { ticketPurchaseSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const ticketPatchSchema = z.object({
  ticketId: z.number().int().positive(),
  paymentStatus: z.enum(PAYMENT_STATUSES)
});

function resolveTierPriceCents(
  ev: typeof events.$inferSelect,
  tier: TicketTier
): number {
  if (tier === 'plein') return ev.priceFullCents;
  if (tier === 'reduit') return ev.priceReducedCents;
  return ev.pricePresaleCents;
}

function safeCompareSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const scope = event.url.searchParams.get('scope');
  const wantAll = scope === 'all';

  if (wantAll && !hasPermission(user.role, 'tickets:read_admin')) {
    throw error(403, 'Permission tickets:read_admin requise pour lister tous les billets.');
  }

  const baseQuery = db
    .select({
      id: tickets.id,
      eventId: tickets.eventId,
      buyerUserId: tickets.buyerUserId,
      buyerName: tickets.buyerName,
      buyerEmailEncrypted: tickets.buyerEmailEncrypted,
      buyerClasse: tickets.buyerClasse,
      tier: tickets.tier,
      priceCents: tickets.priceCents,
      paymentMethod: tickets.paymentMethod,
      paymentStatus: tickets.paymentStatus,
      ed25519Token: tickets.ed25519Token,
      qrCodeId: tickets.qrCodeId,
      scannedAt: tickets.scannedAt,
      scannedBy: tickets.scannedBy,
      createdAt: tickets.createdAt,
      eventTitle: events.title,
      eventDate: events.eventDate,
      eventLocation: events.location
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id));

  const rows = wantAll
    ? await baseQuery.orderBy(desc(tickets.createdAt), desc(tickets.id))
    : await baseQuery
        .where(eq(tickets.buyerUserId, user.id))
        .orderBy(desc(tickets.createdAt), desc(tickets.id));

  const serialized = await Promise.all(
    rows.map(async (row) => {
      let buyerEmail = '';
      try {
        buyerEmail = decryptText(row.buyerEmailEncrypted);
      } catch {
        buyerEmail = '';
      }

      const qrPayload = row.ed25519Token || row.qrCodeId;
      const qrSvg = await generateQrSvg(qrPayload);

      return {
        id: row.id,
        eventId: row.eventId,
        eventTitle: row.eventTitle,
        eventDate: row.eventDate,
        eventLocation: row.eventLocation,
        buyerUserId: row.buyerUserId,
        buyerName: row.buyerName,
        buyerEmail,
        buyerClasse: row.buyerClasse,
        tier: row.tier,
        priceCents: row.priceCents,
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        qrCodeId: row.qrCodeId,
        ed25519Token: row.ed25519Token,
        qrSvg,
        scannedAt: row.scannedAt,
        scannedBy: row.scannedBy,
        createdAt: row.createdAt
      };
    })
  );

  return json({ tickets: serialized });
};

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user;
  if (user && !hasPermission(user.role, 'tickets:buy')) {
    throw error(403, 'Accès refusé pour acheter un billet avec ce rôle.');
  }

  const body = await parseJsonBody(event.request, ticketPurchaseSchema);
  const normalizedEmail = body.buyerEmail.trim().toLowerCase();
  const buyerEmailHash = hmacLookup(normalizedEmail);
  const stripeConfig = await getStripeConfig();

  if (body.paymentMethod === 'stripe' && (!stripeConfig.enabled || !stripeConfig.secretKey)) {
    throw error(
      400,
      'Le paiement par carte Stripe n’est pas encore activé par l’administrateur.'
    );
  }

  const txResult = await db.transaction(async (tx) => {
    const [ev] = await tx
      .select()
      .from(events)
      .where(eq(events.id, body.eventId))
      .for('update')
      .limit(1);

    if (!ev) {
      throw error(404, 'Événement introuvable.');
    }

    if (!ev.isPublic && (!user || !hasPermission(user.role, 'tickets:manage'))) {
      throw error(403, 'Cet événement est privé ou réservé aux comptes autorisés.');
    }

    if (ev.accessCode) {
      if (!body.accessCode || !safeCompareSecret(body.accessCode, ev.accessCode)) {
        throw error(403, 'Code d’accès requis ou invalide pour cet événement.');
      }
    }

    const duplicateCondition = user
      ? or(eq(tickets.buyerUserId, user.id), eq(tickets.buyerEmailHash, buyerEmailHash))
      : eq(tickets.buyerEmailHash, buyerEmailHash);

    const [existingTicket] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.eventId, ev.id),
          duplicateCondition,
          ne(tickets.paymentStatus, 'annule')
        )
      )
      .limit(1);

    if (existingTicket) {
      throw error(409, 'Un billet actif existe déjà pour cet événement avec ce compte ou cet email.');
    }

    const [soldRow] = await tx
      .select({ sold: count() })
      .from(tickets)
      .where(and(eq(tickets.eventId, ev.id), ne(tickets.paymentStatus, 'annule')));

    const soldCount = Number(soldRow?.sold ?? 0);
    if (soldCount >= ev.capacity) {
      throw error(409, 'Cet événement est complet.');
    }

    const priceCents = resolveTierPriceCents(ev, body.tier);
    if (body.paymentMethod === 'gratuit' && priceCents > 0) {
      throw error(400, 'Le mode gratuit n’est autorisé que pour un tarif à 0 EUR.');
    }

    const effectiveMethod = priceCents === 0 ? 'gratuit' : body.paymentMethod;
    const paymentStatus =
      priceCents === 0 || effectiveMethod === 'gratuit' ? 'paye' : 'en_attente';
    const qrCodeId = `MDL-${randomUUID().slice(0, 8).toUpperCase()}`;
    const lookupToken = generateRandomToken(24);

    const [inserted] = await tx
      .insert(tickets)
      .values({
        eventId: ev.id,
        buyerUserId: user?.id ?? null,
        buyerName: body.buyerName,
        buyerEmailEncrypted: encryptText(normalizedEmail),
        buyerEmailHash,
        buyerClasse: body.buyerClasse,
        tier: body.tier,
        priceCents,
        paymentMethod: effectiveMethod,
        paymentStatus,
        ed25519Token: '',
        jwtToken: '',
        qrCodeId,
        lookupToken
      })
      .returning();

    const ed25519Token = signTicketEd25519Qr({
      tid: inserted.id,
      eid: ev.id,
      qrid: qrCodeId,
      tier: body.tier
    });
    const jwtToken = signTicketJwt({
      tid: inserted.id,
      eid: ev.id,
      qrid: qrCodeId,
      tier: body.tier
    });

    const [signedTicket] = await tx
      .update(tickets)
      .set({ ed25519Token, jwtToken })
      .where(eq(tickets.id, inserted.id))
      .returning();

    const newSoldCount = soldCount + 1;
    const remainingSeats = Math.max(0, ev.capacity - newSoldCount);

    return {
      event: ev,
      ticket: signedTicket,
      soldCount: newSoldCount,
      remainingSeats,
      lookupToken
    };
  });

  let checkoutUrl: string | null = null;
  if (
    body.paymentMethod === 'stripe' &&
    txResult.ticket.priceCents > 0 &&
    stripeConfig.secretKey
  ) {
    try {
      const origin = event.url.origin;
      const session = await createStripeCheckoutSession({
        secretKey: stripeConfig.secretKey,
        currency: stripeConfig.currency,
        productName: `Billet — ${txResult.event.title}`,
        description: `Tarif ${txResult.ticket.tier} · ${txResult.ticket.buyerName} (${txResult.ticket.buyerClasse || 'Lycée'})`,
        unitAmountCents: txResult.ticket.priceCents,
        quantity: 1,
        customerEmail: normalizedEmail,
        successUrl: `${origin}/billetterie?stripe_status=success&session_id={CHECKOUT_SESSION_ID}&lookup=${encodeURIComponent(txResult.lookupToken)}`,
        cancelUrl: `${origin}/billetterie?stripe_status=cancel&lookup=${encodeURIComponent(txResult.lookupToken)}`,
        metadata: {
          kind: 'ticket',
          ticketId: String(txResult.ticket.id),
          eventId: String(txResult.event.id)
        }
      });
      await db
        .update(tickets)
        .set({ stripeSessionId: session.id })
        .where(eq(tickets.id, txResult.ticket.id));
      checkoutUrl = session.url;
    } catch (err) {
      // Cancel pending reservation if Stripe session creation fails so seat isn't locked
      await db
        .update(tickets)
        .set({ paymentStatus: 'annule' })
        .where(eq(tickets.id, txResult.ticket.id));
      throw error(
        502,
        err instanceof Error ? err.message : 'Impossible d’ouvrir le paiement Stripe.'
      );
    }
  }

  broadcastSse(`event:${txResult.event.id}`, 'seats', {
    eventId: txResult.event.id,
    capacity: txResult.event.capacity,
    soldCount: txResult.soldCount,
    remainingSeats: txResult.remainingSeats
  });

  await appendAuditLog({
    actorUserId: user?.id ?? null,
    actorRole: user?.role ?? 'guest',
    action: 'ticket:create',
    targetType: 'ticket',
    targetId: txResult.ticket.id,
    details: {
      eventId: txResult.event.id,
      tier: txResult.ticket.tier,
      paymentMethod: txResult.ticket.paymentMethod,
      paymentStatus: txResult.ticket.paymentStatus,
      guestPurchase: !user
    }
  });

  const qrSvg = await generateQrSvg(txResult.ticket.ed25519Token);

  return json(
    {
      ticket: {
        id: txResult.ticket.id,
        eventId: txResult.ticket.eventId,
        buyerName: txResult.ticket.buyerName,
        buyerClasse: txResult.ticket.buyerClasse,
        tier: txResult.ticket.tier,
        priceCents: txResult.ticket.priceCents,
        paymentMethod: txResult.ticket.paymentMethod,
        paymentStatus: txResult.ticket.paymentStatus,
        qrCodeId: txResult.ticket.qrCodeId,
        ed25519Token: txResult.ticket.ed25519Token,
        jwtToken: txResult.ticket.jwtToken,
        lookupToken: txResult.lookupToken,
        qrSvg,
        createdAt: txResult.ticket.createdAt
      },
      checkoutUrl,
      remainingSeats: txResult.remainingSeats
    },
    { status: 201 }
  );
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'tickets:manage');
  const body = await parseJsonBody(event.request, ticketPatchSchema);

  const [updated] = await db
    .update(tickets)
    .set({ paymentStatus: body.paymentStatus })
    .where(eq(tickets.id, body.ticketId))
    .returning();

  if (!updated) {
    throw error(404, 'Billet introuvable.');
  }

  const [[ev], [soldRow]] = await Promise.all([
    db.select().from(events).where(eq(events.id, updated.eventId)).limit(1),
    db
      .select({ sold: count() })
      .from(tickets)
      .where(and(eq(tickets.eventId, updated.eventId), ne(tickets.paymentStatus, 'annule')))
  ]);

  if (ev) {
    const soldCount = Number(soldRow?.sold ?? 0);
    broadcastSse(`event:${ev.id}`, 'seats', {
      eventId: ev.id,
      capacity: ev.capacity,
      soldCount,
      remainingSeats: Math.max(0, ev.capacity - soldCount)
    });
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ticket:payment_update',
    targetType: 'ticket',
    targetId: updated.id,
    details: { paymentStatus: updated.paymentStatus }
  });

  return json({
    ticket: {
      id: updated.id,
      eventId: updated.eventId,
      paymentStatus: updated.paymentStatus,
      qrCodeId: updated.qrCodeId
    }
  });
};
