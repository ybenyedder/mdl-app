import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  computeRoleFlags,
  syncDynamicRoles,
  type Permission,
  type RoleDefinition
} from '$shared/permissions';
import { db, invitations, roles, users } from './db';

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
  // Seed default roles only on an empty table so deleted system roles stay deleted.
  if (existing.length > 0) return;

  await db
    .insert(roles)
    .values(
      SYSTEM_ROLE_DEFINITIONS.map((def) => ({
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

export class RoleDeletionError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface DeleteRoleResult {
  deletedSlug: string;
  deletedLabel: string;
  reassignTo: string;
  reassignedUsers: number;
}

/**
 * Deletes a role (system or custom) after reassigning all users and invitations
 * to an existing fallback role inside a single transaction.
 */
export async function deleteRoleWithReassignment(
  slug: string,
  actorRole: string,
  requestedReassignTo?: string
): Promise<DeleteRoleResult> {
  if (slug === 'president') {
    throw new RoleDeletionError(
      400,
      'Le rôle Président / Admin principal ne peut pas être supprimé.'
    );
  }
  if (slug === actorRole) {
    throw new RoleDeletionError(400, 'Impossible de supprimer ton propre rôle actif.');
  }

  const catalog = await loadRolesCatalog();
  const existing = catalog.find((r) => r.slug === slug);
  if (!existing) {
    throw new RoleDeletionError(404, 'Rôle introuvable.');
  }

  const remainingRoles = catalog.filter((r) => r.slug !== slug);
  if (remainingRoles.length === 0) {
    throw new RoleDeletionError(400, 'Au moins un rôle doit rester actif.');
  }

  if (
    existing.permissions.includes('admin:roles') &&
    !remainingRoles.some((r) => r.permissions.includes('admin:roles'))
  ) {
    throw new RoleDeletionError(
      400,
      'Un autre rôle doit conserver la permission admin:roles avant suppression.'
    );
  }

  const trimmedTarget = requestedReassignTo?.trim();
  let reassignTo = trimmedTarget || '';
  if (!reassignTo) {
    const preferred =
      remainingRoles.find((r) => r.slug === 'adherent') ??
      remainingRoles.find((r) => r.slug === 'invite') ??
      remainingRoles[0];
    reassignTo = preferred.slug;
  }

  if (reassignTo === slug) {
    throw new RoleDeletionError(
      400,
      'Le rôle de réaffectation doit être différent du rôle supprimé.'
    );
  }

  const fallbackRole = remainingRoles.find((r) => r.slug === reassignTo);
  if (!fallbackRole) {
    throw new RoleDeletionError(400, `Rôle de réaffectation introuvable : ${reassignTo}.`);
  }

  const result = await db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, slug), isNull(users.deletedAt)));

    await tx
      .update(users)
      .set({ role: reassignTo, updatedAt: new Date().toISOString() })
      .where(eq(users.role, slug));

    await tx.update(invitations).set({ role: reassignTo }).where(eq(invitations.role, slug));

    await tx.delete(roles).where(eq(roles.slug, slug));

    return { reassignedUsers: Number(total) };
  });

  await loadRolesCatalog();

  return {
    deletedSlug: slug,
    deletedLabel: existing.label,
    reassignTo,
    reassignedUsers: result.reassignedUsers
  };
}
