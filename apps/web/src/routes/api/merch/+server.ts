import { error, json } from '@sveltejs/kit';
import { asc, desc, eq, ne } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { merchItems, merchOrders, projects } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { getStripeConfig } from '$lib/server/stripe';
import { hasPermission } from '$shared/permissions';
import { merchItemCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user;
  const canManage = user ? hasPermission(user.role, 'merch:manage') : false;

  const [items, activeOrders, stripeConfig] = await Promise.all([
    canManage
      ? db.select().from(merchItems).orderBy(desc(merchItems.isActive), asc(merchItems.id))
      : db
          .select()
          .from(merchItems)
          .where(eq(merchItems.isActive, true))
          .orderBy(asc(merchItems.id)),
    db
      .select({
        itemId: merchOrders.itemId,
        size: merchOrders.size,
        quantity: merchOrders.quantity,
        totalCents: merchOrders.totalCents,
        paymentStatus: merchOrders.paymentStatus,
        orderStatus: merchOrders.orderStatus
      })
      .from(merchOrders)
      .where(ne(merchOrders.orderStatus, 'annulee')),
    getStripeConfig()
  ]);

  const statsByItem = new Map<
    number,
    {
      orderedCount: number;
      paidCount: number;
      collectedCents: number;
      sizeCounts: Record<string, number>;
    }
  >();

  for (const ord of activeOrders) {
    if (ord.paymentStatus === 'annule') continue;
    let bucket = statsByItem.get(ord.itemId);
    if (!bucket) {
      bucket = { orderedCount: 0, paidCount: 0, collectedCents: 0, sizeCounts: {} };
      statsByItem.set(ord.itemId, bucket);
    }
    bucket.orderedCount += ord.quantity;
    bucket.sizeCounts[ord.size] = (bucket.sizeCounts[ord.size] ?? 0) + ord.quantity;
    if (ord.paymentStatus === 'paye') {
      bucket.paidCount += ord.quantity;
      bucket.collectedCents += ord.totalCents;
    }
  }

  return json({
    stripeEnabled: stripeConfig.enabled,
    items: items.map((item) => {
      const st = statsByItem.get(item.id) ?? {
        orderedCount: 0,
        paidCount: 0,
        collectedCents: 0,
        sizeCounts: {}
      };
      const estimatedSupplierCostCents = st.orderedCount * item.supplierCostCents;
      const estimatedMarginCents = st.collectedCents - st.paidCount * item.supplierCostCents;
      return {
        id: item.id,
        projectId: item.projectId,
        title: item.title,
        description: item.description,
        category: item.category,
        imageUrl: item.imageUrl,
        priceCents: item.priceCents,
        supplierCostCents: canManage ? item.supplierCostCents : undefined,
        supplierName: canManage ? item.supplierName : undefined,
        supplierEmail: canManage ? item.supplierEmail : undefined,
        supplierUrl: canManage ? item.supplierUrl : undefined,
        supplierReference: canManage ? item.supplierReference : undefined,
        sizes: item.sizesJson,
        isActive: item.isActive,
        zeroAdvanceMode: item.zeroAdvanceMode,
        closesAt: item.closesAt,
        orderedCount: st.orderedCount,
        paidCount: st.paidCount,
        collectedCents: canManage ? st.collectedCents : undefined,
        estimatedSupplierCostCents: canManage ? estimatedSupplierCostCents : undefined,
        estimatedMarginCents: canManage ? estimatedMarginCents : undefined,
        sizeCounts: canManage ? st.sizeCounts : undefined,
        createdAt: item.createdAt
      };
    })
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'merch:manage');
  const body = await parseJsonBody(event.request, merchItemCreateSchema);

  if (body.projectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);
    if (!proj) {
      throw error(400, 'Projet associé introuvable.');
    }
  }

  let closesAtIso: string | null = null;
  if (body.closesAt) {
    const parsed = new Date(body.closesAt);
    if (Number.isNaN(parsed.getTime())) {
      throw error(400, 'Date de clôture invalide.');
    }
    closesAtIso = parsed.toISOString();
  }

  const [created] = await db
    .insert(merchItems)
    .values({
      projectId: body.projectId ?? null,
      title: body.title,
      description: body.description,
      category: body.category,
      imageUrl: body.imageUrl || null,
      priceCents: body.priceCents,
      supplierCostCents: body.supplierCostCents,
      supplierName: body.supplierName,
      supplierEmail: body.supplierEmail,
      supplierUrl: body.supplierUrl,
      supplierReference: body.supplierReference,
      sizesJson: body.sizes,
      isActive: true,
      zeroAdvanceMode: body.zeroAdvanceMode,
      closesAt: closesAtIso,
      createdBy: user.id
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'merch:item_created',
    targetType: 'merch_item',
    targetId: created.id,
    details: { title: created.title, priceCents: created.priceCents }
  });

  return json({ item: { ...created, sizes: created.sizesJson } }, { status: 201 });
};
