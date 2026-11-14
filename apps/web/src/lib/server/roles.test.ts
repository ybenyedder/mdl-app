import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'pglite://memory';
});

import {
  computeRoleFlags,
  getRoleLabel,
  hasPermission,
  isBureauRole,
  isElevatedRole,
  slugifyRoleLabel
} from '$shared/permissions';
import { closeDb, db, ensureMigrated, roles, users } from './db';
import { seedDatabase } from './db/seed';
import { findRoleBySlug, loadRolesCatalog, loadRolesWithCounts } from './roles';

describe('dynamic roles & permissions (pglite://memory)', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await seedDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('seeds all 7 system roles via migration and computes role flags accurately', async () => {
    const catalog = await loadRolesWithCounts();
    const slugs = catalog.map((r) => r.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        'president',
        'tresorier',
        'secretaire',
        'bureau',
        'prof_referent',
        'adherent',
        'invite'
      ])
    );

    expect(slugifyRoleLabel('Responsable Cafétéria & Radio !')).toBe(
      'responsable_cafeteria_radio'
    );
    expect(computeRoleFlags('club_photo', ['projects:read', 'polls:read'])).toEqual({
      isElevated: false,
      isBureau: false
    });
    expect(computeRoleFlags('resp_scan', ['tickets:scan', 'tickets:read_admin'])).toEqual({
      isElevated: false,
      isBureau: true
    });
    expect(computeRoleFlags('co_treasurer', ['budget:write'])).toEqual({
      isElevated: true,
      isBureau: true
    });
  });

  it('supports creating, assigning, reading permissions and deleting custom roles with reassignment', async () => {
    const customSlug = 'resp_cafet_test';
    const perms = ['projects:read', 'tickets:scan', 'tickets:read_admin'] as const;
    const flags = computeRoleFlags(customSlug, [...perms]);

    await db.insert(roles).values({
      slug: customSlug,
      label: 'Responsable Cafétéria',
      description: 'Gère la cafétéria et scanne les billets',
      permissionsJson: [...perms],
      isSystem: false,
      isElevated: flags.isElevated,
      isBureau: flags.isBureau
    });

    await loadRolesCatalog();

    expect(getRoleLabel(customSlug)).toBe('Responsable Cafétéria');
    expect(hasPermission(customSlug, 'tickets:scan')).toBe(true);
    expect(hasPermission(customSlug, 'admin:settings')).toBe(false);
    expect(isBureauRole(customSlug)).toBe(true);
    expect(isElevatedRole(customSlug)).toBe(false);

    const [sampleUser] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.role, 'adherent'))
      .limit(1);
    expect(sampleUser).toBeDefined();

    await db.update(users).set({ role: customSlug }).where(eq(users.id, sampleUser.id));

    const fetched = await findRoleBySlug(customSlug);
    expect(fetched?.label).toBe('Responsable Cafétéria');

    // Reassign back and delete custom role inside transaction
    await db.transaction(async (tx) => {
      await tx.update(users).set({ role: 'adherent' }).where(eq(users.role, customSlug));
      await tx.delete(roles).where(eq(roles.slug, customSlug));
    });

    await loadRolesCatalog();
    const deleted = await findRoleBySlug(customSlug);
    expect(deleted).toBeNull();
    expect(hasPermission(customSlug, 'tickets:scan')).toBe(false);
  });
});
