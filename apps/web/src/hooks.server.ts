import type { Handle } from '@sveltejs/kit';
import {
  SESSION_COOKIE_NAME,
  hasAnyUsers,
  loadSchoolSettings,
  loadSessionContext
} from '$lib/server/auth';
import { ensureMigrated } from '$lib/server/db';
import { loadRolesCatalog } from '$lib/server/roles';

export const handle: Handle = async ({ event, resolve }) => {
  await ensureMigrated();

  const rawSessionToken = event.cookies.get(SESSION_COOKIE_NAME);
  const [rolesCatalog, settings, usersExist] = await Promise.all([
    loadRolesCatalog(),
    loadSchoolSettings(),
    hasAnyUsers()
  ]);
  const { user, session } = await loadSessionContext(rawSessionToken, rolesCatalog);

  event.locals.roles = rolesCatalog;
  event.locals.user = user;
  event.locals.session = session;
  event.locals.settings = settings;
  event.locals.needsAdminBootstrap = !usersExist;

  const response = await resolve(event);

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(self)'
  );
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
  }

  return response;
};
