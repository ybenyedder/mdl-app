import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  invalidateAllUserSessions,
  invalidateSessionByRawToken
} from '$lib/server/auth';
import type { RequestHandler } from './$types';

const logoutSchema = z.object({
  allDevices: z.boolean().optional().default(false)
});

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  let allDevices = false;

  const contentLength = request.headers.get('content-length');
  if (contentLength !== '0') {
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        const parsed = logoutSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          return json({ error: 'Requête invalide.' }, { status: 400 });
        }
        allDevices = parsed.data.allDevices;
      }
    } catch {
      return json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }
  }

  const rawToken = cookies.get(SESSION_COOKIE_NAME);

  if (allDevices && locals.user) {
    await invalidateAllUserSessions(locals.user.id);
  } else if (rawToken) {
    await invalidateSessionByRawToken(rawToken);
  }

  clearSessionCookie(cookies);

  if (locals.user) {
    await appendAuditLog({
      actorUserId: locals.user.id,
      actorRole: locals.user.role,
      action: 'auth.logout',
      targetType: 'user',
      targetId: locals.user.id,
      details: { allDevices }
    });
  }

  return json({ ok: true });
};
