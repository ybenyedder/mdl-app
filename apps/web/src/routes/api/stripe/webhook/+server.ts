import { json } from '@sveltejs/kit';
import {
  fulfillStripeCheckoutSession,
  getStripeConfig,
  verifyStripeWebhookSignature,
  type StripeCheckoutSessionResponse
} from '$lib/server/stripe';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  const config = await getStripeConfig();

  if (!config.webhookSecret) {
    return json({ error: 'Webhook Stripe non configuré.' }, { status: 400 });
  }

  const valid = verifyStripeWebhookSignature(rawBody, signature, config.webhookSecret);
  if (!valid) {
    return json({ error: 'Signature Stripe invalide.' }, { status: 400 });
  }

  let payload: { type?: string; data?: { object?: StripeCheckoutSessionResponse } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Payload JSON invalide.' }, { status: 400 });
  }

  if (payload.type === 'checkout.session.completed' && payload.data?.object) {
    await fulfillStripeCheckoutSession(payload.data.object);
  }

  return json({ received: true });
};
