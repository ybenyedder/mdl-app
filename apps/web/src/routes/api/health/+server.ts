import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { getTicketPublicKeyHex } from '$lib/server/tickets';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const timestamp = new Date().toISOString();

  try {
    await db.execute(sql`SELECT 1`);
    return json({
      ok: true,
      status: 'healthy',
      timestamp,
      ticketPublicKeyHex: getTicketPublicKeyHex()
    });
  } catch {
    return json(
      {
        ok: false,
        status: 'unhealthy',
        timestamp
      },
      { status: 503 }
    );
  }
};
