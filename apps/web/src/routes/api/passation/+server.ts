import { error, json } from '@sveltejs/kit';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { invalidateAllUserSessions, requireAuth } from '$lib/server/auth';
import { generateRandomToken, hashPassword } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
  assemblies,
  budgetEntries,
  events,
  passationChecklists,
  projects,
  tickets,
  users,
  vaultDocuments
} from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

const passationPatchSchema = z
  .object({
    id: z.number().int().positive().optional(),
    stepKey: z.string().trim().min(2).max(80).optional(),
    schoolYear: z.string().trim().min(4).max(20).optional(),
    completed: z.boolean(),
    notes: z.string().trim().max(1000).nullable().optional()
  })
  .refine((data) => data.id !== undefined || data.stepKey !== undefined, {
    message: 'Fournissez id ou stepKey.'
  });

const emergencyRecoverySchema = z.object({
  targetUserId: z.number().int().positive(),
  temporaryPassword: z.string().min(12).max(128).optional(),
  resetTotp: z.boolean().default(true)
});

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'passation:read');
  const schoolYear =
    event.url.searchParams.get('schoolYear')?.trim() || event.locals.settings.schoolYear;

  const [
    checklist,
    projectRows,
    budgetRows,
    memberTotalRow,
    adherentTotalRow,
    assemblyTotalRow,
    eventTotalRow,
    ticketTotalRow,
    vaultTotalRow
  ] = await Promise.all([
    db
      .select()
      .from(passationChecklists)
      .where(eq(passationChecklists.schoolYear, schoolYear))
      .orderBy(asc(passationChecklists.id)),
    db.select({ status: projects.status }).from(projects),
    db
      .select({ type: budgetEntries.type, amountCents: budgetEntries.amountCents })
      .from(budgetEntries)
      .where(eq(budgetEntries.fiscalYear, schoolYear)),
    db.select({ total: count() }).from(users).where(isNull(users.deletedAt)),
    db
      .select({ total: count() })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.isAdherent, true))),
    db.select({ total: count() }).from(assemblies),
    db.select({ total: count() }).from(events),
    db.select({ total: count() }).from(tickets),
    db.select({ total: count() }).from(vaultDocuments)
  ]);

  let recettesCents = 0;
  let depensesCents = 0;
  for (const row of budgetRows) {
    if (row.type === 'recette') recettesCents += row.amountCents;
    else depensesCents += row.amountCents;
  }

  return json({
    schoolYear,
    checklist,
    annualSummary: {
      projects: {
        total: projectRows.length,
        validated: projectRows.filter((p) => p.status === 'valide').length,
        completed: projectRows.filter((p) => p.status === 'termine').length
      },
      budget: {
        recettesCents,
        depensesCents,
        soldeCents: recettesCents - depensesCents,
        entriesCount: budgetRows.length
      },
      members: {
        total: Number(memberTotalRow[0]?.total ?? 0),
        adherents: Number(adherentTotalRow[0]?.total ?? 0)
      },
      assembliesCount: Number(assemblyTotalRow[0]?.total ?? 0),
      eventsCount: Number(eventTotalRow[0]?.total ?? 0),
      ticketsCount: Number(ticketTotalRow[0]?.total ?? 0),
      vaultDocumentsCount: Number(vaultTotalRow[0]?.total ?? 0)
    }
  });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'passation:manage');
  const body = await parseJsonBody(event.request, passationPatchSchema);
  const schoolYear = body.schoolYear || event.locals.settings.schoolYear;

  const whereClause = body.id
    ? eq(passationChecklists.id, body.id)
    : and(
        eq(passationChecklists.schoolYear, schoolYear),
        eq(passationChecklists.stepKey, body.stepKey!)
      );

  const updates: Partial<typeof passationChecklists.$inferInsert> = {
    completed: body.completed,
    completedBy: body.completed ? user.id : null,
    completedAt: body.completed ? new Date().toISOString() : null
  };
  if (body.notes !== undefined) {
    updates.notes = body.notes;
  }

  const [updated] = await db
    .update(passationChecklists)
    .set(updates)
    .where(whereClause)
    .returning();

  if (!updated) {
    throw error(404, 'Étape de passation introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'passation:step_update',
    targetType: 'passation_checklist',
    targetId: updated.id,
    details: { stepKey: updated.stepKey, completed: updated.completed }
  });

  return json({ step: updated });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event);
  if (user.role !== 'prof_referent' && user.role !== 'president') {
    throw error(
      403,
      'Procédure de récupération d’urgence réservée au professeur référent ou au président.'
    );
  }

  const body = await parseJsonBody(event.request, emergencyRecoverySchema);

  const [targetUser] = await db
    .select({ id: users.id, role: users.role, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(and(eq(users.id, body.targetUserId), isNull(users.deletedAt)))
    .limit(1);

  if (!targetUser) {
    throw error(404, 'Compte cible introuvable ou supprimé.');
  }

  const temporaryPassword = body.temporaryPassword ?? generateRandomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);

  const updates: Partial<typeof users.$inferInsert> = {
    passwordHash,
    updatedAt: new Date().toISOString()
  };
  if (body.resetTotp) {
    updates.totpEnabled = false;
    updates.totpSecretEncrypted = null;
  }

  await db.update(users).set(updates).where(eq(users.id, targetUser.id));
  await invalidateAllUserSessions(targetUser.id);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'passation:emergency_recovery',
    targetType: 'user',
    targetId: targetUser.id,
    details: { targetRole: targetUser.role, resetTotp: body.resetTotp }
  });

  return json({
    recovered: true,
    targetUserId: targetUser.id,
    temporaryPassword,
    totpReset: body.resetTotp
  });
};
