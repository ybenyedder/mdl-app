import { eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { db } from '$lib/server/db';
import { merchItems, merchOrders } from '$lib/server/db/schema';

export interface GelatoShippingAddress {
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  postCode: string;
  country: string;
  email: string;
  phone: string;
}

export interface GelatoConfig {
  enabled: boolean;
  apiKey: string;
  orderType: 'draft' | 'order';
  shippingAddress: GelatoShippingAddress;
}

export interface GelatoOrderPayload {
  orderType: 'draft' | 'order';
  orderReferenceId: string;
  customerReferenceId: string;
  currency: 'EUR';
  items: Array<{
    itemReferenceId: string;
    productUid: string;
    quantity: number;
    files: Array<{ type: 'default'; url: string }>;
  }>;
  shippingAddress: GelatoShippingAddress;
}

export interface PodDispatchResult {
  status: 'disabled' | 'skipped' | 'dispatched' | 'failed';
  reason?: string;
  gelatoOrderId?: string;
}

const GELATO_ORDERS_URL = 'https://order.gelatoapis.com/v4/orders';

/**
 * Reads optional Gelato API v4 print-on-demand configuration from environment variables.
 */
export function getGelatoConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): GelatoConfig {
  const apiKey = env.GELATO_API_KEY?.trim() || '';
  const rawType = env.GELATO_ORDER_TYPE?.trim().toLowerCase();
  const orderType: 'draft' | 'order' = rawType === 'order' ? 'order' : 'draft';

  return {
    enabled: apiKey.length > 0,
    apiKey,
    orderType,
    shippingAddress: {
      firstName: env.GELATO_SHIP_FIRST_NAME?.trim() || 'Bureau',
      lastName: env.GELATO_SHIP_LAST_NAME?.trim() || 'MDL',
      addressLine1: env.GELATO_SHIP_ADDRESS_LINE1?.trim() || '',
      city: env.GELATO_SHIP_CITY?.trim() || '',
      postCode: env.GELATO_SHIP_POSTAL_CODE?.trim() || '',
      country: (env.GELATO_SHIP_COUNTRY?.trim() || 'FR').toUpperCase(),
      email: env.GELATO_SHIP_EMAIL?.trim() || '',
      phone: env.GELATO_SHIP_PHONE?.trim() || '+33600000000'
    }
  };
}

function isHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Builds a Gelato v4 `/v4/orders` JSON payload for a paid merch pre-order,
 * or returns a clear skip reason if catalog UID / print file / shipping config is incomplete.
 */
export function buildGelatoOrderPayload(
  order: {
    id: number;
    lookupCode: string;
    size: string;
    quantity: number;
  },
  item: {
    supplierReference: string;
    supplierUrl: string;
    imageUrl: string | null;
  },
  config: GelatoConfig
): { ok: true; payload: GelatoOrderPayload } | { ok: false; reason: string } {
  if (!config.enabled || !config.apiKey) {
    return { ok: false, reason: 'GELATO_API_KEY non configuré' };
  }

  const rawUid = item.supplierReference.trim();
  if (!rawUid) {
    return { ok: false, reason: 'Référence catalogue Gelato (productUid) absente sur l’article' };
  }

  const productUid = rawUid
    .replaceAll('{SIZE}', order.size.toLowerCase())
    .replaceAll('{size}', order.size.toLowerCase());

  const printUrl = isHttpUrl(item.supplierUrl) || isHttpUrl(item.imageUrl);
  if (!printUrl) {
    return {
      ok: false,
      reason: 'URL https:// du visuel d’impression absente sur l’article'
    };
  }

  const addr = config.shippingAddress;
  if (!addr.addressLine1 || !addr.city || !addr.postCode || !addr.email) {
    return {
      ok: false,
      reason:
        'Adresse de livraison établissement incomplète (GELATO_SHIP_ADDRESS_LINE1 / CITY / POSTAL_CODE / EMAIL)'
    };
  }

  return {
    ok: true,
    payload: {
      orderType: config.orderType,
      orderReferenceId: order.lookupCode,
      customerReferenceId: `mdl-order-${order.id}`,
      currency: 'EUR',
      items: [
        {
          itemReferenceId: `${order.lookupCode}-1`,
          productUid,
          quantity: order.quantity,
          files: [{ type: 'default', url: printUrl }]
        }
      ],
      shippingAddress: addr
    }
  };
}

/**
 * Best-effort automatic dispatch to Gelato API v4 when an order is confirmed paid.
 * Never throws so local / manual / Stripe order persistence cannot fail because of external API issues.
 */
export async function dispatchGelatoOrderForPaidMerch(
  orderId: number,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<PodDispatchResult> {
  const config = getGelatoConfigFromEnv(options.env ?? process.env);
  if (!config.enabled) {
    return { status: 'disabled' };
  }

  const [row] = await db
    .select({
      orderId: merchOrders.id,
      lookupCode: merchOrders.lookupCode,
      size: merchOrders.size,
      quantity: merchOrders.quantity,
      buyerUserId: merchOrders.buyerUserId,
      supplierReference: merchItems.supplierReference,
      supplierUrl: merchItems.supplierUrl,
      imageUrl: merchItems.imageUrl
    })
    .from(merchOrders)
    .innerJoin(merchItems, eq(merchOrders.itemId, merchItems.id))
    .where(eq(merchOrders.id, orderId))
    .limit(1);

  if (!row) {
    return { status: 'skipped', reason: 'Commande introuvable' };
  }

  const built = buildGelatoOrderPayload(
    {
      id: row.orderId,
      lookupCode: row.lookupCode,
      size: row.size,
      quantity: row.quantity
    },
    {
      supplierReference: row.supplierReference,
      supplierUrl: row.supplierUrl,
      imageUrl: row.imageUrl
    },
    config
  );

  if (!built.ok) {
    await appendAuditLog({
      actorUserId: row.buyerUserId,
      actorRole: 'system',
      action: 'merch:pod_skipped',
      targetType: 'merch_order',
      targetId: row.orderId,
      details: { provider: 'gelato', reason: built.reason }
    });
    return { status: 'skipped', reason: built.reason };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(GELATO_ORDERS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': config.apiKey
      },
      body: JSON.stringify(built.payload)
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const reason = data.message || `HTTP ${res.status}`;
      await appendAuditLog({
        actorUserId: row.buyerUserId,
        actorRole: 'system',
        action: 'merch:pod_failed',
        targetType: 'merch_order',
        targetId: row.orderId,
        details: { provider: 'gelato', status: res.status, reason }
      });
      return { status: 'failed', reason };
    }

    await appendAuditLog({
      actorUserId: row.buyerUserId,
      actorRole: 'system',
      action: 'merch:pod_dispatched',
      targetType: 'merch_order',
      targetId: row.orderId,
      details: {
        provider: 'gelato',
        orderType: config.orderType,
        gelatoOrderId: data.id ?? null,
        lookupCode: row.lookupCode
      }
    });
    return { status: 'dispatched', gelatoOrderId: data.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Erreur réseau Gelato';
    await appendAuditLog({
      actorUserId: row.buyerUserId,
      actorRole: 'system',
      action: 'merch:pod_failed',
      targetType: 'merch_order',
      targetId: row.orderId,
      details: { provider: 'gelato', reason }
    });
    return { status: 'failed', reason };
  }
}
