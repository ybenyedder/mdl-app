import { error, json } from '@sveltejs/kit';
import {
  fetchStripeCheckoutSession,
  fulfillStripeCheckoutSession,
  getStripeConfig
} from '$lib/server/stripe';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id')?.trim();
  if (!sessionId || !sessionId.startsWith('cs_')) {
    throw error(400, 'Identifiant de session Stripe invalide.');
  }

  const config = await getStripeConfig();
  if (!config.secretKey) {
    throw error(400, 'Stripe n’est pas configuré.');
  }

  const session = await fetchStripeCheckoutSession(config.secretKey, sessionId);
  const result = await fulfillStripeCheckoutSession(session);

  return json({
    ok: true,
    paymentStatus: session.payment_status ?? null,
    fulfilled: result.fulfilled,
    kind: result.kind,
    referenceId: result.referenceId
  });
};
