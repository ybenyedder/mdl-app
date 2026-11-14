import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '$lib/server/auth';
import { db, pushSubscriptions } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { getVapidPublicKey } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

const pushEndpointSchema = z
  .string()
  .trim()
  .url('Endpoint push invalide')
  .max(1000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:') return true;
      return process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Protocole endpoint push invalide');

const pushSubscribeSchema = z.union([
  z.object({
    endpoint: pushEndpointSchema,
    keys: z.object({
      p256dh: z.string().trim().min(10).max(500),
      auth: z.string().trim().min(6).max(200)
    })
  }),
  z.object({
    endpoint: pushEndpointSchema,
    p256dh: z.string().trim().min(10).max(500),
    auth: z.string().trim().min(6).max(200)
  })
]);

const pushUnsubscribeSchema = z.object({
  endpoint: pushEndpointSchema
});

export const GET: RequestHandler = async () => {
  const publicKey = getVapidPublicKey();
  return json({
    ok: true,
    publicKey,
    configured: Boolean(publicKey)
  });
};

export const POST: RequestHandler = async (event) => {
  const actor = requireAuth(event);
  const data = await parseJsonBody(event.request, pushSubscribeSchema);

  const endpoint = data.endpoint;
  const p256dh = 'keys' in data ? data.keys.p256dh : data.p256dh;
  const auth = 'keys' in data ? data.keys.auth : data.auth;

  await db
    .insert(pushSubscriptions)
    .values({
      userId: actor.id,
      endpoint,
      p256dh,
      auth
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: actor.id,
        p256dh,
        auth
      }
    });

  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async (event) => {
  const actor = requireAuth(event);
  const data = await parseJsonBody(event.request, pushUnsubscribeSchema);

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, data.endpoint),
        eq(pushSubscriptions.userId, actor.id)
      )
    );

  return json({ ok: true });
};
