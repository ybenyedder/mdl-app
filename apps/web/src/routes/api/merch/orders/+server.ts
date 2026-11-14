import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { decryptText, encryptText, hmacLookup } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { merchItems, merchOrders } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { dispatchGelatoOrderForPaidMerch } from '$lib/server/pod';
import { createStripeCheckoutSession, getStripeConfig } from '$lib/server/stripe';
import { hasPermission } from '$shared/permissions';
import { merchOrderCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const lookup = event.url.searchParams.get('lookup')?.trim();
  if (lookup) {
    const [row] = await db
      .select({
        id: merchOrders.id,
        itemId: merchOrders.itemId,
        itemTitle: merchItems.title,
        itemCategory: merchItems.category,
        buyerName: merchOrders.buyerName,
        buyerClasse: merchOrders.buyerClasse,
        size: merchOrders.size,
        quantity: merchOrders.quantity,
        unitPriceCents: merchOrders.unitPriceCents,
        totalCents: merchOrders.totalCents,
        paymentMethod: merchOrders.paymentMethod,
        paymentStatus: merchOrders.paymentStatus,
        orderStatus: merchOrders.orderStatus,
        lookupCode: merchOrders.lookupCode,
        createdAt: merchOrders.createdAt
      })
      .from(merchOrders)
      .innerJoin(merchItems, eq(merchOrders.itemId, merchItems.id))
      .where(eq(merchOrders.lookupCode, lookup))
      .limit(1);

    if (!row) {
      throw error(404, 'Précommande introuvable.');
    }
    return json({ order: row });
  }

  const user = requireAuth(event);
  const scope = event.url.searchParams.get('scope');
  const wantAll = scope === 'all';
  if (wantAll && !hasPermission(user.role, 'merch:manage')) {
    throw error(403, 'Permission merch:manage requise.');
  }

  const base = db
    .select({
      id: merchOrders.id,
      itemId: merchOrders.itemId,
      itemTitle: merchItems.title,
      itemCategory: merchItems.category,
      buyerUserId: merchOrders.buyerUserId,
      buyerName: merchOrders.buyerName,
      buyerEmailEncrypted: merchOrders.buyerEmailEncrypted,
      buyerClasse: merchOrders.buyerClasse,
      size: merchOrders.size,
      quantity: merchOrders.quantity,
      unitPriceCents: merchOrders.unitPriceCents,
      totalCents: merchOrders.totalCents,
      paymentMethod: merchOrders.paymentMethod,
      paymentStatus: merchOrders.paymentStatus,
      orderStatus: merchOrders.orderStatus,
      lookupCode: merchOrders.lookupCode,
      createdAt: merchOrders.createdAt
    })
    .from(merchOrders)
    .innerJoin(merchItems, eq(merchOrders.itemId, merchItems.id));

  const rows = wantAll
    ? await base.orderBy(desc(merchOrders.createdAt))
    : await base
        .where(eq(merchOrders.buyerUserId, user.id))
        .orderBy(desc(merchOrders.createdAt));

  return json({
    orders: rows.map((r) => {
      let buyerEmail: string | undefined;
      if (wantAll || r.buyerUserId === user.id) {
        try {
          buyerEmail = decryptText(r.buyerEmailEncrypted);
        } catch {
          buyerEmail = undefined;
        }
      }
      return {
        id: r.id,
        itemId: r.itemId,
        itemTitle: r.itemTitle,
        itemCategory: r.itemCategory,
        buyerUserId: r.buyerUserId,
        buyerName: r.buyerName,
        ...(buyerEmail ? { buyerEmail } : {}),
        buyerClasse: r.buyerClasse,
        size: r.size,
        quantity: r.quantity,
        unitPriceCents: r.unitPriceCents,
        totalCents: r.totalCents,
        paymentMethod: r.paymentMethod,
        paymentStatus: r.paymentStatus,
        orderStatus: r.orderStatus,
        lookupCode: r.lookupCode,
        createdAt: r.createdAt
      };
    })
  });
};

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user;
  if (user && !hasPermission(user.role, 'merch:buy')) {
    throw error(403, 'Votre rôle ne permet pas de commander.');
  }

  const body = await parseJsonBody(event.request, merchOrderCreateSchema);
  const [item] = await db
    .select()
    .from(merchItems)
    .where(eq(merchItems.id, body.itemId))
    .limit(1);

  if (!item) {
    throw error(404, 'Article introuvable.');
  }
  if (!item.isActive) {
    throw error(400, 'Les précommandes pour cet article sont fermées.');
  }
  if (item.closesAt && new Date(item.closesAt).getTime() < Date.now()) {
    throw error(400, 'La campagne de précommande est clôturée.');
  }
  if (!item.sizesJson.includes(body.size)) {
    throw error(400, `Taille invalide (${body.size}). Tailles disponibles : ${item.sizesJson.join(', ')}.`);
  }

  const totalCents = item.priceCents * body.quantity;
  if (body.paymentMethod === 'gratuit' && totalCents > 0) {
    throw error(400, 'Le mode gratuit n’est autorisé que pour un article à 0 EUR.');
  }

  const stripeConfig = await getStripeConfig();
  if (body.paymentMethod === 'stripe' && totalCents > 0 && (!stripeConfig.enabled || !stripeConfig.secretKey)) {
    throw error(
      400,
      'Le paiement CB Stripe n’est pas encore activé par l’administrateur.'
    );
  }

  const normalizedEmail = body.buyerEmail.trim().toLowerCase();
  const effectiveMethod = totalCents === 0 ? 'gratuit' : body.paymentMethod;
  const paymentStatus = totalCents === 0 ? 'paye' : 'en_attente';
  const orderStatus = totalCents === 0 ? 'payee' : 'precommande';
  const lookupCode = `MDL-CMD-${randomUUID().slice(0, 8).toUpperCase()}`;

  const [created] = await db
    .insert(merchOrders)
    .values({
      itemId: item.id,
      buyerUserId: user?.id ?? null,
      buyerName: body.buyerName,
      buyerEmailEncrypted: encryptText(normalizedEmail),
      buyerEmailHash: hmacLookup(normalizedEmail),
      buyerClasse: body.buyerClasse,
      size: body.size,
      quantity: body.quantity,
      unitPriceCents: item.priceCents,
      totalCents,
      paymentMethod: effectiveMethod,
      paymentStatus,
      orderStatus,
      lookupCode
    })
    .returning();

  let checkoutUrl: string | null = null;
  if (effectiveMethod === 'stripe' && totalCents > 0 && stripeConfig.secretKey) {
    try {
      const origin = event.url.origin;
      const session = await createStripeCheckoutSession({
        secretKey: stripeConfig.secretKey,
        currency: stripeConfig.currency,
        productName: `${item.title} (Taille ${body.size})`,
        description: `Précommande MDL · ${body.buyerName} (${body.buyerClasse})`,
        unitAmountCents: item.priceCents,
        quantity: body.quantity,
        customerEmail: normalizedEmail,
        successUrl: `${origin}/boutique?stripe_status=success&session_id={CHECKOUT_SESSION_ID}&lookup=${encodeURIComponent(lookupCode)}`,
        cancelUrl: `${origin}/boutique?stripe_status=cancel&lookup=${encodeURIComponent(lookupCode)}`,
        metadata: {
          kind: 'merch_order',
          orderId: String(created.id),
          itemId: String(item.id)
        }
      });
      await db
        .update(merchOrders)
        .set({ stripeSessionId: session.id })
        .where(eq(merchOrders.id, created.id));
      checkoutUrl = session.url;
    } catch (err) {
      await db
        .update(merchOrders)
        .set({ paymentStatus: 'annule', orderStatus: 'annulee' })
        .where(eq(merchOrders.id, created.id));
      throw error(
        502,
        err instanceof Error ? err.message : 'Erreur lors de la création du paiement Stripe.'
      );
    }
  }

  await appendAuditLog({
    actorUserId: user?.id ?? null,
    actorRole: user?.role ?? 'guest',
    action: 'merch:order_created',
    targetType: 'merch_order',
    targetId: created.id,
    details: {
      itemId: item.id,
      size: created.size,
      quantity: created.quantity,
      totalCents: created.totalCents,
      paymentMethod: created.paymentMethod
    }
  });

  if (created.paymentStatus === 'paye') {
    await dispatchGelatoOrderForPaidMerch(created.id).catch(() => null);
  }

  return json(
    {
      order: {
        id: created.id,
        itemId: created.itemId,
        itemTitle: item.title,
        buyerName: created.buyerName,
        buyerClasse: created.buyerClasse,
        size: created.size,
        quantity: created.quantity,
        unitPriceCents: created.unitPriceCents,
        totalCents: created.totalCents,
        paymentMethod: created.paymentMethod,
        paymentStatus: created.paymentStatus,
        orderStatus: created.orderStatus,
        lookupCode: created.lookupCode,
        createdAt: created.createdAt
      },
      checkoutUrl
    },
    { status: 201 }
  );
};
