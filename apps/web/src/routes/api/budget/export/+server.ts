import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { budgetEntries } from '$lib/server/db/schema';
import { pdfResponse, sanitizeFilename } from '$lib/server/http';
import { generateBudgetReportPdf } from '$lib/server/pdf';
import type { RequestHandler } from './$types';

function escapeCsvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'budget:read');

  const format = (event.url.searchParams.get('format') || 'pdf').toLowerCase();
  const rawYear = event.url.searchParams.get('fiscalYear')?.trim();
  const fiscalYear =
    rawYear && rawYear.length > 0 ? rawYear : event.locals.settings.schoolYear;

  const entries =
    fiscalYear === 'all'
      ? await db
          .select()
          .from(budgetEntries)
          .orderBy(asc(budgetEntries.entryDate), asc(budgetEntries.id))
      : await db
          .select()
          .from(budgetEntries)
          .where(eq(budgetEntries.fiscalYear, fiscalYear))
          .orderBy(asc(budgetEntries.entryDate), asc(budgetEntries.id));

  let totalRecettesCents = 0;
  let totalDepensesCents = 0;
  for (const entry of entries) {
    if (entry.type === 'recette') totalRecettesCents += entry.amountCents;
    else totalDepensesCents += entry.amountCents;
  }

  if (format === 'csv') {
    const header = [
      'Date',
      'Type',
      'Catégorie',
      'Libellé',
      'Montant (EUR)',
      'Exercice',
      'Validé',
      'Justificatif'
    ].join(';');

    const lines = entries.map((e) => {
      const signedAmount = ((e.type === 'recette' ? e.amountCents : -e.amountCents) / 100).toFixed(2);
      return [
        escapeCsvCell(e.entryDate),
        escapeCsvCell(e.type),
        escapeCsvCell(e.category),
        escapeCsvCell(e.label),
        escapeCsvCell(signedAmount.replace('.', ',')),
        escapeCsvCell(e.fiscalYear),
        escapeCsvCell(e.validatedBy ? 'Oui' : 'Non'),
        escapeCsvCell(e.receiptPath ? 'Oui' : 'Non')
      ].join(';');
    });

    const csvContent = `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
    const safeYear = sanitizeFilename(fiscalYear);

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tresorerie-mdl-${safeYear}.csv"`,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  if (format === 'pdf') {
    const pdfBytes = await generateBudgetReportPdf({
      schoolName: event.locals.settings.schoolName,
      mdlName: event.locals.settings.mdlName,
      fiscalYear,
      totalRecettesCents,
      totalDepensesCents,
      entries: entries.map((e) => ({
        entryDate: e.entryDate,
        type: e.type,
        category: e.category,
        label: e.label,
        amountCents: e.amountCents
      }))
    });

    return pdfResponse(pdfBytes, `bilan-tresorerie-${fiscalYear}.pdf`);
  }

  throw error(400, 'Format d’export invalide (pdf ou csv).');
};
