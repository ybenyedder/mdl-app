import { z } from 'zod';
import { requireAuth } from '$lib/server/auth';
import { parseJsonBody, pdfResponse } from '$lib/server/http';
import { generateEstablishmentAccordPdf } from '$lib/server/pdf';
import { db, schoolSettings } from '$lib/server/db';
import type { RequestHandler } from './$types';

const accordSchema = z.object({
  legalRepresentative: z.string().trim().max(120).optional(),
  presidentName: z.string().trim().max(120).optional(),
  bodyText: z.string().trim().min(20).max(8000)
});

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'passation:read');
  const body = await parseJsonBody(event.request, accordSchema);
  const [settingsRow] = await db.select().from(schoolSettings).limit(1);

  const bytes = await generateEstablishmentAccordPdf({
    schoolName: settingsRow?.schoolName || event.locals.settings.schoolName,
    mdlName: settingsRow?.mdlName || event.locals.settings.mdlName,
    schoolYear: settingsRow?.schoolYear || event.locals.settings.schoolYear,
    legalRepresentative:
      body.legalRepresentative || settingsRow?.legalRepresentative || 'Direction du lycée',
    presidentName: body.presidentName || `${user.firstName} ${user.lastName}`,
    bodyText: body.bodyText
  });

  return pdfResponse(bytes, `demande-accord-etablissement-${event.locals.settings.schoolYear}.pdf`);
};
