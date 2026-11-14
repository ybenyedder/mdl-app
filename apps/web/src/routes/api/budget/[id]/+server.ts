import fs from 'node:fs/promises';
import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { BUDGET_ENTRY_TYPES, budgetEntries, projects } from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { readEncryptedUpload } from '$lib/server/uploads';
import { hasAnyPermission, hasPermission } from '$shared/permissions';
import type { RequestHandler } from './$types';

const budgetPatchSchema = z.object({
  validate: z.boolean().optional(),
  projectId: z.number().int().positive().nullable().optional(),
  type: z.enum(BUDGET_ENTRY_TYPES).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  label: z.string().trim().min(2).max(160).optional(),
  amountCents: z.number().int().positive().max(50_000_000).optional(),
  entryDate: z.string().trim().min(8).max(32).optional(),
  fiscalYear: z.string().trim().min(4).max(16).optional()
});

function serializeEntry(row: typeof budgetEntries.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    category: row.category,
    label: row.label,
    amountCents: row.amountCents,
    entryDate: row.entryDate,
    hasReceipt: Boolean(row.receiptPath),
    receiptMime: row.receiptMime,
    receiptUrl: row.receiptPath ? `/api/budget/${row.id}?receipt=1` : null,
    createdBy: row.createdBy,
    validatedBy: row.validatedBy,
    fiscalYear: row.fiscalYear,
    createdAt: row.createdAt
  };
}

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'budget:read');
  const id = parsePositiveIntId(event.params.id, 'Écriture budget');

  const [entry] = await db.select().from(budgetEntries).where(eq(budgetEntries.id, id)).limit(1);
  if (!entry) {
    throw error(404, 'Écriture comptable introuvable.');
  }

  if (event.url.searchParams.get('receipt') === '1') {
    if (!entry.receiptPath) {
      throw error(404, 'Aucun justificatif attaché à cette écriture.');
    }
    let decrypted: Buffer;
    try {
      decrypted = await readEncryptedUpload(entry.receiptPath);
    } catch {
      throw error(404, 'Justificatif introuvable ou impossible à déchiffrer.');
    }

    return new Response(new Uint8Array(decrypted), {
      status: 200,
      headers: {
        'Content-Type': entry.receiptMime || 'application/octet-stream',
        'Content-Disposition': `inline; filename="justificatif-${entry.id}"`,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  return json({ entry: serializeEntry(entry) });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const id = parsePositiveIntId(event.params.id, 'Écriture budget');
  const body = await parseJsonBody(event.request, budgetPatchSchema);

  const [existing] = await db.select().from(budgetEntries).where(eq(budgetEntries.id, id)).limit(1);
  if (!existing) {
    throw error(404, 'Écriture comptable introuvable.');
  }

  const hasFieldEdits =
    body.projectId !== undefined ||
    body.type !== undefined ||
    body.category !== undefined ||
    body.label !== undefined ||
    body.amountCents !== undefined ||
    body.entryDate !== undefined ||
    body.fiscalYear !== undefined;

  if (body.validate !== undefined) {
    const canValidate = hasAnyPermission(user.role, [
      'budget:write',
      'budget:close_year',
      'projects:validate'
    ]);
    if (!canValidate) {
      throw error(403, 'Seuls le trésorier, le président ou le professeur référent peuvent valider.');
    }
  }

  if (hasFieldEdits && !hasPermission(user.role, 'budget:write')) {
    throw error(403, 'Permission budget:write requise pour modifier une écriture.');
  }

  if (body.validate === undefined && !hasFieldEdits) {
    throw error(400, 'Aucune modification fournie.');
  }

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

  const updates: Partial<typeof budgetEntries.$inferInsert> = {};
  if (body.projectId !== undefined) updates.projectId = body.projectId;
  if (body.type !== undefined) updates.type = body.type;
  if (body.category !== undefined) updates.category = body.category;
  if (body.label !== undefined) updates.label = body.label;
  if (body.amountCents !== undefined) updates.amountCents = body.amountCents;
  if (body.entryDate !== undefined) updates.entryDate = body.entryDate;
  if (body.fiscalYear !== undefined) updates.fiscalYear = body.fiscalYear;
  if (body.validate === true) {
    updates.validatedBy = user.id;
  } else if (body.validate === false) {
    updates.validatedBy = null;
  }

  const [updated] = await db
    .update(budgetEntries)
    .set(updates)
    .where(eq(budgetEntries.id, id))
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: body.validate !== undefined && !hasFieldEdits ? 'budget:validate' : 'budget:update',
    targetType: 'budget_entry',
    targetId: id,
    details: { validatedBy: updated.validatedBy, amountCents: updated.amountCents }
  });

  return json({ entry: serializeEntry(updated) });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event, 'budget:write');
  const id = parsePositiveIntId(event.params.id, 'Écriture budget');

  const [deleted] = await db
    .delete(budgetEntries)
    .where(eq(budgetEntries.id, id))
    .returning();

  if (!deleted) {
    throw error(404, 'Écriture comptable introuvable.');
  }

  if (deleted.receiptPath) {
    const root = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
    const resolved = path.resolve(root, deleted.receiptPath);
    if (resolved.startsWith(root + path.sep)) {
      await fs.unlink(resolved).catch(() => undefined);
    }
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'budget:delete',
    targetType: 'budget_entry',
    targetId: id,
    details: { label: deleted.label, amountCents: deleted.amountCents }
  });

  return json({ deleted: true, id });
};
