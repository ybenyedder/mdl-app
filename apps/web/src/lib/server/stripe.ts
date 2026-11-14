import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { appendAuditLog } from './audit';
import { decryptText } from './crypto';
import {
  budgetEntries,
  db,
  merchOrders,
  schoolSettings,
  tickets,
  users
} from './db';

export interface ResolvedStripeConfig {
  enabled: boolean;
  publishableKey: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
  currency: string;
}

export async function getStripeConfig(): Promise<ResolvedStripeConfig> {
  const [row] = await db.select().from(schoolSettings).limit(1);

  let secretKey: string | null = process.env.STRIPE_SECRET_KEY?.trim() || null;
  if (row?.stripeSecretKeyEncrypted) {
    try {
      secretKey = decryptText(row.stripeSecretKeyEncrypted);
    } catch {
      secretKey = process.env.STRIPE_SECRET_KEY?.trim() || null;
    }
  }

  let webhookSecret: string | null = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  if (row?.stripeWebhookSecretEncrypted) {
    try {
      webhookSecret = decryptText(row.stripeWebhookSecretEncrypted);
    } catch {
      webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
    }
  }

  const publishableKey =
    row?.stripePublishableKey?.trim() ||
    process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    null;

  const enabled = row
    ? Boolean(row.stripeEnabled && secretKey)
    : Boolean(secretKey);

  return {
    enabled,
    publishableKey,
    secretKey,
    webhookSecret,
    currency: (row?.stripeCurrency || 'eur').toLowerCase()
  };
}

export function maskSecretHint(secret: string | null): string | null {
  if (!secret) return null;
  if (secret.length <= 12) return `${secret.slice(0, 4)}••••`;
  return `${secret.slice(0, 8)}••••${secret.slice(-4)}`;
}

export interface CreateCheckoutInput {
  secretKey: string;
  currency?: string;
  productName: string;
  description?: string;
  unitAmountCents: number;
  quantity?: number;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface StripeCheckoutSessionResponse {
  id: string;
  url: string;
  payment_status?: string;
  status?: string;
  amount_total?: number;
  metadata?: Record<string, string>;
}

export async function createStripeCheckoutSession(
  input: CreateCheckoutInput
): Promise<StripeCheckoutSessionResponse> {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', input.successUrl);
  params.set('cancel_url', input.cancelUrl);
  params.set('line_items[0][quantity]', String(input.quantity ?? 1));
  params.set('line_items[0][price_data][currency]', (input.currency || 'eur').toLowerCase());
  params.set('line_items[0][price_data][unit_amount]', String(input.unitAmountCents));
  params.set('line_items[0][price_data][product_data][name]', input.productName);
  if (input.description) {
    params.set('line_items[0][price_data][product_data][description]', input.description.slice(0, 200));
  }
  if (input.customerEmail) {
    params.set('customer_email', input.customerEmail);
  }
  for (const [k, v] of Object.entries(input.metadata)) {
    params.set(`metadata[${k}]`, v);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = (await res.json().catch(() => ({}))) as StripeCheckoutSessionResponse & {
    error?: { message?: string };
  };

  if (!res.ok || !data.id || !data.url) {
    throw new Error(
      data.error?.message || `Erreur Stripe Checkout (HTTP ${res.status}).`
    );
  }

  return data;
}

export async function fetchStripeCheckoutSession(
  secretKey: string,
  sessionId: string
): Promise<StripeCheckoutSessionResponse> {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    }
  );
  const data = (await res.json().catch(() => ({}))) as StripeCheckoutSessionResponse & {
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Session Stripe introuvable (HTTP ${res.status}).`);
  }
  return data;
}

export async function testStripeSecretKey(secretKey: string): Promise<{
  ok: boolean;
  livemode?: boolean;
  currency?: string;
  error?: string;
}> {
  const res = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${secretKey}` }
  });
  const data = (await res.json().catch(() => ({}))) as {
    livemode?: boolean;
    available?: Array<{ currency?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error?.message || `Clé Stripe refusée (HTTP ${res.status}).`
    };
  }
  return {
    ok: true,
    livemode: Boolean(data.livemode),
    currency: data.available?.[0]?.currency || 'eur'
  };
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(',').map((p) => p.trim());
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

  if (!timestampPart || signatures.length === 0) return false;
  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expectedHex = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  return signatures.some((sig) => {
    if (sig.length !== expectedHex.length) return false;
    try {
      return timingSafeEqual(Buffer.from(sig, 'hex'), expectedBuf);
    } catch {
      return false;
    }
  });
}

export interface FulfillResult {
  fulfilled: boolean;
  kind: string | null;
  referenceId: string | null;
}

export async function fulfillStripeCheckoutSession(
  session: StripeCheckoutSessionResponse
): Promise<FulfillResult> {
  if (session.payment_status !== 'paid') {
    return { fulfilled: false, kind: session.metadata?.kind ?? null, referenceId: null };
  }

  const meta = session.metadata ?? {};
  const kind = meta.kind ?? null;
  const nowIso = new Date().toISOString();

  if (kind === 'ticket' && meta.ticketId) {
    const ticketId = Number.parseInt(meta.ticketId, 10);
    if (Number.isInteger(ticketId) && ticketId > 0) {
      const [existing] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .limit(1);
      if (!existing || existing.paymentStatus === 'paye') {
        return { fulfilled: false, kind, referenceId: String(ticketId) };
      }
      await db
        .update(tickets)
        .set({ paymentStatus: 'paye', stripeSessionId: session.id })
        .where(eq(tickets.id, ticketId));

      await appendAuditLog({
        actorUserId: existing.buyerUserId,
        actorRole: existing.buyerUserId ? 'member' : 'guest',
        action: 'ticket:stripe_paid',
        targetType: 'ticket',
        targetId: ticketId,
        details: { stripeSessionId: session.id, priceCents: existing.priceCents }
      });
      return { fulfilled: true, kind, referenceId: String(ticketId) };
    }
  }

  if (kind === 'merch_order' && meta.orderId) {
    const orderId = Number.parseInt(meta.orderId, 10);
    if (Number.isInteger(orderId) && orderId > 0) {
      const [existing] = await db
        .select()
        .from(merchOrders)
        .where(eq(merchOrders.id, orderId))
        .limit(1);
      if (!existing || existing.paymentStatus === 'paye') {
        return { fulfilled: false, kind, referenceId: String(orderId) };
      }
      await db
        .update(merchOrders)
        .set({
          paymentStatus: 'paye',
          orderStatus: existing.orderStatus === 'precommande' ? 'payee' : existing.orderStatus,
          stripeSessionId: session.id,
          updatedAt: nowIso
        })
        .where(eq(merchOrders.id, orderId));

      await appendAuditLog({
        actorUserId: existing.buyerUserId,
        actorRole: existing.buyerUserId ? 'member' : 'guest',
        action: 'merch:stripe_paid',
        targetType: 'merch_order',
        targetId: orderId,
        details: { stripeSessionId: session.id, totalCents: existing.totalCents }
      });
      return { fulfilled: true, kind, referenceId: String(orderId) };
    }
  }

  if (kind === 'adhesion' && meta.userId) {
    const userId = Number.parseInt(meta.userId, 10);
    if (Number.isInteger(userId) && userId > 0) {
      const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!existing || existing.isAdherent) {
        return { fulfilled: false, kind, referenceId: String(userId) };
      }
      const nextRole = existing.role === 'invite' ? 'adherent' : existing.role;
      await db
        .update(users)
        .set({
          isAdherent: true,
          role: nextRole,
          adhesionMethod: 'stripe',
          adhesionPaidAt: nowIso,
          updatedAt: nowIso
        })
        .where(eq(users.id, userId));

      const [settings] = await db.select().from(schoolSettings).limit(1);
      const amountCents = session.amount_total || settings?.membershipFeeCents || 500;
      if (amountCents > 0) {
        await db.insert(budgetEntries).values({
          type: 'recette',
          category: 'Adhésions',
          label: `Cotisation adhésion Stripe (${existing.firstName} ${existing.lastName})`,
          amountCents,
          entryDate: nowIso.slice(0, 10),
          fiscalYear: settings?.schoolYear || '2026-2027',
          createdBy: userId,
          validatedBy: userId
        });
      }

      await appendAuditLog({
        actorUserId: userId,
        actorRole: nextRole,
        action: 'members.adhesion_stripe_paid',
        targetType: 'user',
        targetId: userId,
        details: { stripeSessionId: session.id, amountCents }
      });
      return { fulfilled: true, kind, referenceId: String(userId) };
    }
  }

  return { fulfilled: false, kind, referenceId: null };
}
