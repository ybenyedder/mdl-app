import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, tickets } from '$lib/server/db/schema';
import { generateQrSvg } from '$lib/server/tickets';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const token = url.searchParams.get('token')?.trim();
  if (!token || token.length < 16) {
    throw error(400, 'Jeton de billet invalide.');
  }

  const [row] = await db
    .select({
      id: tickets.id,
      eventId: tickets.eventId,
      buyerName: tickets.buyerName,
      buyerClasse: tickets.buyerClasse,
      tier: tickets.tier,
      priceCents: tickets.priceCents,
      paymentMethod: tickets.paymentMethod,
      paymentStatus: tickets.paymentStatus,
      qrCodeId: tickets.qrCodeId,
      ed25519Token: tickets.ed25519Token,
      jwtToken: tickets.jwtToken,
      scannedAt: tickets.scannedAt,
      createdAt: tickets.createdAt,
      eventTitle: events.title,
      eventDate: events.eventDate,
      eventLocation: events.location
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.lookupToken, token))
    .limit(1);

  if (!row) {
    throw error(404, 'Billet introuvable.');
  }

  const qrSvg = row.ed25519Token ? await generateQrSvg(row.ed25519Token) : '';

  return json({
    ticket: {
      ...row,
      qrSvg
    }
  });
};
