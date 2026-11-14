import { asc, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'pglite://memory';
});

import { appendAuditLog, verifyAuditChain } from './audit';
import {
  agCandidates,
  agVotes,
  assemblies,
  auditLogs,
  closeDb,
  db,
  dbDriver,
  ensureMigrated,
  pglite,
  users
} from './db';
import { seedDatabase } from './db/seed';

describe('database migrations, seed, ag_votes constraint & audit chain (pglite://memory)', () => {
  beforeAll(async () => {
    await ensureMigrated();
    const seedResult = await seedDatabase();
    expect(seedResult.skipped).toBe(false);
  });

  afterAll(async () => {
    await closeDb();
  });

  it('uses pglite://memory driver, applies Drizzle migrations and runs idempotent seed', async () => {
    expect(dbDriver).toBe('pglite');
    expect(pglite).not.toBeNull();

    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    expect(userCount).toBe(7);

    // Calling seedDatabase a second time should be idempotent and skip
    const secondRun = await seedDatabase();
    expect(secondRun.skipped).toBe(true);
  });

  it('enforces partial unique index on ag_votes while anonymized=false and allows multiple anonymized ballots', async () => {
    const [assembly] = await db.select().from(assemblies).limit(1);
    const [candidate] = await db
      .select()
      .from(agCandidates)
      .where(eq(agCandidates.assemblyId, assembly.id))
      .limit(1);
    const [adherent] = await db
      .select()
      .from(users)
      .where(eq(users.role, 'adherent'))
      .limit(1);

    expect(assembly).toBeDefined();
    expect(candidate).toBeDefined();
    expect(adherent).toBeDefined();

    // First active vote succeeds
    const [insertedVote] = await db
      .insert(agVotes)
      .values({
        assemblyId: assembly.id,
        voterId: adherent.id,
        candidateId: candidate.id,
        isBlank: false,
        castMode: 'en_ligne',
        anonymized: false
      })
      .returning();
    expect(insertedVote.id).toBeGreaterThan(0);

    // Second active vote (anonymized = false) for the same (assembly_id, voter_id) MUST fail
    await expect(
      db.insert(agVotes).values({
        assemblyId: assembly.id,
        voterId: adherent.id,
        candidateId: candidate.id,
        isBlank: false,
        castMode: 'en_ligne',
        anonymized: false
      })
    ).rejects.toThrow();

    // Anonymize the existing ballot: voter_id = NULL, anonymized = true
    await db
      .update(agVotes)
      .set({ voterId: null, anonymized: true })
      .where(eq(agVotes.id, insertedVote.id));

    // Multiple anonymized ballots (voter_id = NULL, anonymized = true) MUST be allowed
    const [anon2, anon3] = await db
      .insert(agVotes)
      .values([
        {
          assemblyId: assembly.id,
          voterId: null,
          candidateId: candidate.id,
          isBlank: false,
          castMode: 'salle',
          anonymized: true
        },
        {
          assemblyId: assembly.id,
          voterId: null,
          candidateId: null,
          isBlank: true,
          castMode: 'en_ligne',
          anonymized: true
        }
      ])
      .returning();

    expect(anon2.id).toBeGreaterThan(insertedVote.id);
    expect(anon3.id).toBeGreaterThan(anon2.id);
  });

  it('appends SHA-256 chained audit logs, verifies integrity, and detects tampering', async () => {
    const [president] = await db
      .select()
      .from(users)
      .where(eq(users.role, 'president'))
      .limit(1);

    await appendAuditLog({
      actorUserId: president.id,
      actorRole: 'president',
      action: 'project:create',
      targetType: 'project',
      targetId: 42,
      details: { title: 'Club Robotique' }
    });

    await appendAuditLog({
      actorUserId: president.id,
      actorRole: 'president',
      action: 'budget:validate',
      targetType: 'budget_entry',
      targetId: 99,
      details: { amountCents: 15000 }
    });

    const validResult = await verifyAuditChain();
    expect(validResult.valid).toBe(true);
    expect(validResult.total).toBeGreaterThanOrEqual(3);

    // Tamper with the second audit log entry payload
    const allLogs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id));
    const targetLog = allLogs[1];
    expect(targetLog).toBeDefined();

    await db
      .update(auditLogs)
      .set({ detailsJson: JSON.stringify({ amountCents: 999999, tampered: true }) })
      .where(eq(auditLogs.id, targetLog.id));

    const tamperedResult = await verifyAuditChain();
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.brokenAtId).toBe(targetLog.id);
  });
});
