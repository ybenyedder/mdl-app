import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  getRoleDefinition,
  hasPermission,
  type Permission,
  type Role,
  type RoleDefinition,
  type SystemRole
} from '$shared/permissions';
import { decryptText, generateRandomToken, hashToken, hmacLookup } from './crypto';
import { db } from './db';
import { schoolSettings, sessions, users } from './db/schema';

export const SESSION_COOKIE_NAME = 'mdl_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function getClientIpHash(request: Request): string {
  const fwd = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  const ip = fwd.split(',')[0]?.trim() || 'local';
  return hmacLookup(ip);
}

export async function createUserSession(
  userId: number,
  request: Request,
  twoFactorVerified = true
): Promise<{ rawToken: string; expiresAt: string }> {
  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const userAgent = (request.headers.get('user-agent') || 'unknown').slice(0, 240);

  await db.insert(sessions).values({
    id: tokenHash,
    userId,
    userAgent,
    ipHash: getClientIpHash(request),
    twoFactorVerified,
    expiresAt
  });

  return { rawToken, expiresAt };
}

export function setSessionCookie(cookies: Cookies, rawToken: string, expiresAt: string): void {
  cookies.set(SESSION_COOKIE_NAME, rawToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' && (process.env.PUBLIC_APP_URL || '').startsWith('https://'),
    expires: new Date(expiresAt)
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

export async function invalidateSessionByRawToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(rawToken)));
}

export async function invalidateAllUserSessions(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function loadSessionContext(
  rawToken: string | undefined,
  rolesCatalog?: readonly RoleDefinition[]
): Promise<{
  user: App.Locals['user'];
  session: App.Locals['session'];
}> {
  if (!rawToken) return { user: null, session: null };
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const rows = await db
    .select({
      sessionId: sessions.id,
      twoFactorVerified: sessions.twoFactorVerified,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      emailEncrypted: users.emailEncrypted,
      firstName: users.firstName,
      lastName: users.lastName,
      classe: users.classe,
      role: users.role,
      customTitle: users.customTitle,
      isAdherent: users.isAdherent,
      totpEnabled: users.totpEnabled
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, tokenHash), gt(sessions.expiresAt, nowIso), isNull(users.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return { user: null, session: null };

  if (row.totpEnabled && !row.twoFactorVerified) {
    return {
      user: null,
      session: {
        id: row.sessionId,
        twoFactorVerified: false,
        expiresAt: row.expiresAt
      }
    };
  }

  let email = '';
  try {
    email = decryptText(row.emailEncrypted);
  } catch {
    email = 'compte@mdl.local';
  }

  const matchedRole =
    rolesCatalog?.find((r) => r.slug === row.role) ?? getRoleDefinition(row.role);
  const resolvedPermissions: Permission[] = matchedRole
    ? [...matchedRole.permissions]
    : [...(ROLE_PERMISSIONS[row.role as SystemRole] ?? [])];
  const resolvedRoleLabel =
    matchedRole?.label ?? ROLE_LABELS[row.role as SystemRole] ?? row.role;

  return {
    user: {
      id: row.userId,
      email,
      firstName: row.firstName,
      lastName: row.lastName,
      classe: row.classe,
      role: row.role as Role,
      roleLabel: resolvedRoleLabel,
      permissions: resolvedPermissions,
      customTitle: row.customTitle,
      isAdherent: row.isAdherent,
      totpEnabled: row.totpEnabled
    },
    session: {
      id: row.sessionId,
      twoFactorVerified: row.twoFactorVerified,
      expiresAt: row.expiresAt
    }
  };
}

export async function hasAnyUsers(): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}

export async function loadSchoolSettings(): Promise<App.Locals['settings']> {
  const [row] = await db.select().from(schoolSettings).limit(1);
  if (!row) {
    const envSecret = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
    return {
      schoolName: process.env.PUBLIC_SCHOOL_NAME || 'Lycée Jean Moulin',
      schoolCity: '',
      schoolPostalCode: '',
      schoolDepartment: '',
      schoolUai: null,
      mdlName: process.env.PUBLIC_MDL_NAME || 'MDL Connect',
      primaryColor: '#0a66ff',
      accentColor: '#0ea5e9',
      logoUrl: null,
      membershipFeeCents: 500,
      schoolYear: '2026-2027',
      registrationMode: 'open',
      stripeEnabled: envSecret,
      stripePublishableKey: process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
      merchSupplierName: process.env.MERCH_SUPPLIER_NAME?.trim() || 'Good is Merch',
      merchSupplierEmail: process.env.MERCH_SUPPLIER_EMAIL?.trim() || 'contact@goodismerch.com',
      merchSupplierUrl: process.env.MERCH_SUPPLIER_URL?.trim() || 'https://goodismerch.com',
      setupCompleted: false
    };
  }
  const hasSecret = Boolean(
    row.stripeSecretKeyEncrypted || process.env.STRIPE_SECRET_KEY?.trim()
  );
  return {
    schoolName: row.schoolName,
    schoolCity: row.schoolCity || '',
    schoolPostalCode: row.schoolPostalCode || '',
    schoolDepartment: row.schoolDepartment || '',
    schoolUai: row.schoolUai || null,
    mdlName: row.mdlName,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoUrl || null,
    membershipFeeCents: row.membershipFeeCents,
    schoolYear: row.schoolYear,
    registrationMode: row.registrationMode,
    stripeEnabled: (row.stripeEnabled && hasSecret) || (!row.stripeSecretKeyEncrypted && Boolean(process.env.STRIPE_SECRET_KEY?.trim()) && row.stripeEnabled),
    stripePublishableKey: row.stripePublishableKey || process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
    merchSupplierName: row.merchSupplierName?.trim() || process.env.MERCH_SUPPLIER_NAME?.trim() || 'Good is Merch',
    merchSupplierEmail: row.merchSupplierEmail?.trim() || process.env.MERCH_SUPPLIER_EMAIL?.trim() || 'contact@goodismerch.com',
    merchSupplierUrl: row.merchSupplierUrl?.trim() || process.env.MERCH_SUPPLIER_URL?.trim() || 'https://goodismerch.com',
    setupCompleted: Boolean(row.setupCompleted)
  };
}

export function requireAuth(event: RequestEvent, permission?: Permission): NonNullable<App.Locals['user']> {
  const user = event.locals.user;
  if (!user) {
    throw error(401, 'Connexion requise.');
  }
  if (user.totpEnabled && event.locals.session && !event.locals.session.twoFactorVerified) {
    throw error(403, 'Vérification 2FA requise.');
  }
  if (permission && !user.permissions.includes(permission) && !hasPermission(user.role, permission)) {
    throw error(403, 'Accès refusé pour votre rôle.');
  }
  return user;
}
