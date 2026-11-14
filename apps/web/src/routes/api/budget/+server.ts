import { error, json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { budgetEntries, projects } from '$lib/server/db/schema';
import { parseJsonBody, validateWithSchema } from '$lib/server/http';
import { saveEncryptedUpload } from '$lib/server/uploads';
import { budgetEntrySchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

function serializeBudgetEntry(row: typeof budgetEntries.$inferSelect) {
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

  const rawYear = event.url.searchParams.get('fiscalYear')?.trim();
  const fiscalYear =
    rawYear && rawYear.length > 0 ? rawYear : event.locals.settings.schoolYear;

  const rows =
    fiscalYear === 'all'
      ? await db
          .select()
          .from(budgetEntries)
          .orderBy(desc(budgetEntries.entryDate), desc(budgetEntries.id))
      : await db
          .select()
          .from(budgetEntries)
          .where(eq(budgetEntries.fiscalYear, fiscalYear))
          .orderBy(desc(budgetEntries.entryDate), desc(budgetEntries.id));

  let totalRecettesCents = 0;
  let totalDepensesCents = 0;

  for (const row of rows) {
    if (row.type === 'recette') {
      totalRecettesCents += row.amountCents;
    } else {
      totalDepensesCents += row.amountCents;
    }
  }

  return json({
    fiscalYear,
    entries: rows.map(serializeBudgetEntry),
    totals: {
      totalRecettesCents,
      totalDepensesCents,
      soldeCents: totalRecettesCents - totalDepensesCents
    }
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'budget:write');
  const contentType = event.request.headers.get('content-type') || '';

  let payload: z.output<typeof budgetEntrySchema>;
  let receiptFile: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await event.request.formData();
    const rawProjectId = formData.get('projectId');
    const rawAmountCents = formData.get('amountCents');
    const rawFiscalYear = formData.get('fiscalYear');
    const fileField = formData.get('receipt');

    const projectId =
      typeof rawProjectId === 'string' && rawProjectId.trim().length > 0
        ? Number(rawProjectId)
        : null;
    const amountCents =
      typeof rawAmountCents === 'string' ? Number(rawAmountCents) : Number.NaN;

    payload = validateWithSchema(
      {
        projectId: Number.isNaN(projectId) ? null : projectId,
        type: formData.get('type'),
        category: formData.get('category'),
        label: formData.get('label'),
        amountCents,
        entryDate: formData.get('entryDate'),
        fiscalYear:
          typeof rawFiscalYear === 'string' && rawFiscalYear.trim().length > 0
            ? rawFiscalYear
            : event.locals.settings.schoolYear
      },
      budgetEntrySchema
    );

    if (fileField instanceof File && fileField.size > 0) {
      receiptFile = fileField;
    }
  } else {
    payload = await parseJsonBody(event.request, budgetEntrySchema);
  }

  if (payload.projectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, payload.projectId))
      .limit(1);
    if (!proj) {
      throw error(400, 'Projet associé introuvable.');
    }
  }

  let receiptPath: string | null = null;
  let receiptMime: string | null = null;

  if (receiptFile) {
    try {
      const bytes = new Uint8Array(await receiptFile.arrayBuffer());
      const saved = await saveEncryptedUpload('receipts', bytes, receiptFile.type);
      receiptPath = saved.relativePath;
      receiptMime = saved.mimeType;
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'Justificatif invalide.');
    }
  }

  const [created] = await db
    .insert(budgetEntries)
    .values({
      projectId: payload.projectId ?? null,
      type: payload.type,
      category: payload.category,
      label: payload.label,
      amountCents: payload.amountCents,
      entryDate: payload.entryDate,
      receiptPath,
      receiptMime,
      createdBy: user.id,
      fiscalYear: payload.fiscalYear || event.locals.settings.schoolYear
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'budget:create',
    targetType: 'budget_entry',
    targetId: created.id,
    details: {
      type: created.type,
      amountCents: created.amountCents,
      hasReceipt: Boolean(created.receiptPath)
    }
  });

  return json({ entry: serializeBudgetEntry(created) }, { status: 201 });
};
