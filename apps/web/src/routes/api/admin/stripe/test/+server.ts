import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAuth } from '$lib/server/auth';
import { parseJsonBody } from '$lib/server/http';
import { getStripeConfig, testStripeSecretKey } from '$lib/server/stripe';
import type { RequestHandler } from './$types';

const stripeTestSchema = z.object({
  secretKey: z.string().trim().max(250).optional()
});

export const POST: RequestHandler = async (event) => {
  requireAuth(event, 'admin:settings');
  const body = await parseJsonBody(event.request, stripeTestSchema).catch(() => ({
    secretKey: undefined
  }));

  const config = await getStripeConfig();
  const keyToTest = body.secretKey?.trim() || config.secretKey;

  if (!keyToTest) {
    return json(
      { ok: false, error: 'Aucune clé secrète Stripe renseignée.' },
      { status: 400 }
    );
  }

  const result = await testStripeSecretKey(keyToTest);
  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }

  return json({
    ok: true,
    livemode: result.livemode,
    currency: result.currency,
    modeLabel: result.livemode ? 'Production (Live)' : 'Mode Test'
  });
};
