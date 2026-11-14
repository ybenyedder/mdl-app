import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { merchOrders } from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { merchOrderPatchSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'merch:manage');
  const id = parsePositiveIntId(event.params.id, 'Commande');
  const patch = await parseJsonBody(event.request, merchOrderPatchSchema);

  const [existing] = await db
    .select()
    .from(merchOrders)
    .where(eq(merchOrders.id, id))
    .limit(1);

  if (!existing) {
    throw error(404, 'Commande introuvable.');
  }

  const nextPaymentStatus = patch.paymentStatus ?? existing.paymentStatus;
  let nextOrderStatus = patch.orderStatus ?? existing.orderStatus;
  if (patch.paymentStatus === 'paye' && !patch.orderStatus && existing.orderStatus === 'precommande') {
    nextOrderStatus = 'payee';
  }
  if (patch.paymentStatus === 'annule' && !patch.orderStatus) {
    nextOrderStatus = 'annulee';
  }

  const [updated] = await db
    .update(merchOrders)
    .set({
      paymentStatus: nextPaymentStatus,
      orderStatus: nextOrderStatus,
      updatedAt: new Date().toISOString()
    })
    .where(eq(merchOrders.id, id))
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'merch:order_updated',
    targetType: 'merch_order',
    targetId: id,
    details: { paymentStatus: updated.paymentStatus, orderStatus: updated.orderStatus }
  });

  return json({ order: updated });
};
