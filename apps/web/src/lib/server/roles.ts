import { asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  computeRoleFlags,
  syncDynamicRoles,
  type Permission,
  type RoleDefinition
} from '$shared/permissions';
import { db, roles, users } from './db';

const VALID_PERMISSIONS = new Set<string>(PERMISSIONS);

function sanitizePermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Permission>();
  for (const item of raw) {
    if (typeof item === 'string' && VALID_PERMISSIONS.has(item)) {
      seen.add(item as Permission);
    }
  }
  return Array.from(seen);
}

function mapRoleRow(row: typeof roles.$inferSelect, memberCount?: number): RoleDefinition {
  const permissions = sanitizePermissions(row.permissionsJson);
  const flags = computeRoleFlags(row.slug, permissions);
  return {
    slug: row.slug,
    label: row.label,
    description: row.description,
    permissions,
    isSystem: row.isSystem,
    isElevated: row.isElevated || flags.isElevated,
    isBureau: row.isBureau || flags.isBureau,
    ...(memberCount !== undefined ? { memberCount } : {})
  };
}

export async function ensureSystemRolesSeeded(): Promise<void> {
  const existing = await db.select({ slug: roles.slug }).from(roles);
  if (existing.length >= SYSTEM_ROLE_DEFINITIONS.length) return;

  const existingSlugs = new Set(existing.map((r) => r.slug));
  const missing = SYSTEM_ROLE_DEFINITIONS.filter((def) => !existingSlugs.has(def.slug));
  if (missing.length === 0) return;

  await db
    .insert(roles)
    .values(
      missing.map((def) => ({
        slug: def.slug,
        label: def.label,
        description: def.description,
        permissionsJson: def.permissions,
        isSystem: true,
        isElevated: def.isElevated,
        isBureau: def.isBureau
      }))
    )
    .onConflictDoNothing();
}

export async function loadRolesCatalog(): Promise<RoleDefinition[]> {
  await ensureSystemRolesSeeded();
  const rows = await db
    .select()
    .from(roles)
    .orderBy(desc(roles.isSystem), asc(roles.label));

  const catalog = rows.map((row) => mapRoleRow(row));
  syncDynamicRoles(catalog);
  return catalog;
}

export async function loadRolesWithCounts(): Promise<RoleDefinition[]> {
  await ensureSystemRolesSeeded();
  const [roleRows, countRows] = await Promise.all([
    db.select().from(roles).orderBy(desc(roles.isSystem), asc(roles.label)),
    db
      .select({
        role: users.role,
        total: sql<number>`count(*)::int`
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .groupBy(users.role)
  ]);

  const countMap = new Map<string, number>(countRows.map((r) => [r.role, Number(r.total)]));
  const catalog = roleRows.map((row) => mapRoleRow(row, countMap.get(row.slug) ?? 0));
  syncDynamicRoles(catalog);
  return catalog;
}

export async function findRoleBySlug(slug: string): Promise<RoleDefinition | null> {
  await ensureSystemRolesSeeded();
  const [row] = await db.select().from(roles).where(eq(roles.slug, slug)).limit(1);
  return row ? mapRoleRow(row) : null;
}
