import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { merchItems } from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import type { RequestHandler } from './$types';

const merchItemPatchSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    priceCents: z.number().int().min(0).max(500_000).optional(),
    supplierCostCents: z.number().int().min(0).max(500_000).optional(),
    supplierName: z.string().trim().max(120).optional(),
    supplierEmail: z.string().trim().max(160).optional(),
    supplierUrl: z.string().trim().max(300).optional(),
    supplierReference: z.string().trim().max(100).optional(),
    sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(16).optional(),
    isActive: z.boolean().optional(),
    zeroAdvanceMode: z.boolean().optional(),
    closesAt: z.string().trim().nullable().optional()
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Aucune modification fournie.' });

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'merch:manage');
  const id = parsePositiveIntId(event.params.id, 'Article');
  const patch = await parseJsonBody(event.request, merchItemPatchSchema);

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.priceCents !== undefined) updates.priceCents = patch.priceCents;
  if (patch.supplierCostCents !== undefined) updates.supplierCostCents = patch.supplierCostCents;
  if (patch.supplierName !== undefined) updates.supplierName = patch.supplierName;
  if (patch.supplierEmail !== undefined) updates.supplierEmail = patch.supplierEmail;
  if (patch.supplierUrl !== undefined) updates.supplierUrl = patch.supplierUrl;
  if (patch.supplierReference !== undefined) updates.supplierReference = patch.supplierReference;
  if (patch.sizes !== undefined) updates.sizesJson = patch.sizes;
  if (patch.isActive !== undefined) updates.isActive = patch.isActive;
  if (patch.zeroAdvanceMode !== undefined) updates.zeroAdvanceMode = patch.zeroAdvanceMode;
  if (patch.closesAt !== undefined) {
    updates.closesAt = patch.closesAt ? new Date(patch.closesAt).toISOString() : null;
  }

  const [updated] = await db
    .update(merchItems)
    .set(updates)
    .where(eq(merchItems.id, id))
    .returning();

  if (!updated) {
    throw error(404, 'Article introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'merch:item_updated',
    targetType: 'merch_item',
    targetId: id,
    details: updates
  });

  return json({ item: { ...updated, sizes: updated.sizesJson } });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event, 'merch:manage');
  const id = parsePositiveIntId(event.params.id, 'Article');

  const [deleted] = await db
    .delete(merchItems)
    .where(eq(merchItems.id, id))
    .returning({ id: merchItems.id, title: merchItems.title });

  if (!deleted) {
    throw error(404, 'Article introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'merch:item_deleted',
    targetType: 'merch_item',
    targetId: id,
    details: { title: deleted.title }
  });

  return json({ ok: true });
};
