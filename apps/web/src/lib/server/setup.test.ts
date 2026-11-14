import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'pglite://memory';
});

import { hasAnyUsers, loadSchoolSettings } from './auth';
import { hmacLookup } from './crypto';
import { closeDb, db, ensureMigrated, merchItems, roles, schoolSettings, users } from './db';

describe('setup didacticiel, localisation & fournisseur réel (pglite://memory)', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await db
      .insert(roles)
      .values({
        slug: 'president',
        label: 'Président·e MDL',
        description: 'Administration complète',
        permissionsJson: ['admin:settings'],
        isSystem: true,
        isElevated: true,
        isBureau: true
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('hasAnyUsers returns false on fresh DB then true after first admin user is created', async () => {
    expect(await hasAnyUsers()).toBe(false);

    await db.insert(users).values({
      emailEncrypted: 'enc-email',
      emailHash: hmacLookup('admin@lycee-renoir.fr'),
      firstName: 'Claire',
      lastName: 'Moreau',
      classe: 'Terminale',
      role: 'president',
      passwordHash: 'scrypt$salt$hash',
      isAdherent: true
    });

    expect(await hasAnyUsers()).toBe(true);
  });

  it('persists school location, merch supplier & setupCompleted on schoolSettings and loads them', async () => {
    await db.insert(schoolSettings).values({
      schoolName: 'Lycée Auguste Renoir',
      schoolCity: 'Cagnes-sur-Mer',
      schoolPostalCode: '06800',
      schoolDepartment: 'Alpes-Maritimes',
      schoolUai: '0060013T',
      mdlName: 'MDL Renoir',
      schoolYear: '2026-2027',
      legalRepresentative: 'Mme Claire Moreau (Proviseure)',
      primaryColor: '#104e84',
      accentColor: '#d97706',
      merchSupplierName: 'Atelier Côte d’Azur Textile',
      merchSupplierEmail: 'commandes@atelier-caz.fr',
      merchSupplierUrl: 'https://atelier-caz.example',
      setupCompleted: true
    });

    const loaded = await loadSchoolSettings();
    expect(loaded.schoolName).toBe('Lycée Auguste Renoir');
    expect(loaded.schoolCity).toBe('Cagnes-sur-Mer');
    expect(loaded.schoolPostalCode).toBe('06800');
    expect(loaded.schoolDepartment).toBe('Alpes-Maritimes');
    expect(loaded.schoolUai).toBe('0060013T');
    expect(loaded.merchSupplierName).toBe('Atelier Côte d’Azur Textile');
    expect(loaded.merchSupplierEmail).toBe('commandes@atelier-caz.fr');
    expect(loaded.merchSupplierUrl).toBe('https://atelier-caz.example');
    expect(loaded.setupCompleted).toBe(true);
  });

  it('stores per-item real supplier metadata on merchItems', async () => {
    const [created] = await db
      .insert(merchItems)
      .values({
        title: 'Pull Promo 2026',
        description: 'Coton bio brodé dos + poitrine',
        category: 'pull',
        priceCents: 2800,
        sizesJson: ['S', 'M', 'L', 'XL'],
        supplierName: 'Sérigraphie du Var',
        supplierEmail: 'devis@serigraphie-var.fr',
        supplierUrl: 'https://serigraphie-var.example',
        supplierReference: 'HOODIE-BIO-320G'
      })
      .returning();

    expect(created).toBeDefined();
    const [found] = await db.select().from(merchItems).where(eq(merchItems.id, created.id));
    expect(found.supplierName).toBe('Sérigraphie du Var');
    expect(found.supplierEmail).toBe('devis@serigraphie-var.fr');
    expect(found.supplierReference).toBe('HOODIE-BIO-320G');
  });
});
