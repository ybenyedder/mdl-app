import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
  PROJECT_STATUSES,
  projectMembers,
  projects,
  projectTasks,
  users
} from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId, safeJsonParse } from '$lib/server/http';
import { hasPermission } from '$shared/permissions';
import type { RequestHandler } from './$types';

const projectPatchSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  eventDate: z.string().trim().nullable().optional(),
  budgetPlannedCents: z.number().int().min(0).max(50_000_000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  safetyChecklist: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        checked: z.boolean()
      })
    )
    .max(30)
    .optional(),
  validateProf: z.boolean().optional()
});

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'projects:read');
  const id = parsePositiveIntId(event.params.id, 'Projet');

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) {
    throw error(404, 'Projet introuvable.');
  }

  const [tasks, members] = await Promise.all([
    db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, id))
      .orderBy(asc(projectTasks.position), asc(projectTasks.id)),
    db
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        hoursLogged: projectMembers.hoursLogged,
        roleInProject: projectMembers.roleInProject,
        firstName: users.firstName,
        lastName: users.lastName,
        classe: users.classe,
        role: users.role
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, id))
  ]);

  return json({
    project: {
      ...project,
      safetyChecklist: safeJsonParse(project.safetyChecklistJson, []),
      tasks,
      members
    }
  });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const id = parsePositiveIntId(event.params.id, 'Projet');
  const body = await parseJsonBody(event.request, projectPatchSchema);

  const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) {
    throw error(404, 'Projet introuvable.');
  }

  const isValidationAction = body.validateProf === true || body.status === 'valide';
  const hasContentEdits =
    body.title !== undefined ||
    body.description !== undefined ||
    body.category !== undefined ||
    body.eventDate !== undefined ||
    body.budgetPlannedCents !== undefined ||
    body.safetyChecklist !== undefined ||
    (body.status !== undefined && body.status !== 'valide');

  if (isValidationAction && !hasPermission(user.role, 'projects:validate')) {
    throw error(403, 'Seul un professeur référent ou président peut valider un projet.');
  }

  const canEdit =
    hasPermission(user.role, 'projects:edit') ||
    (existing.leadUserId === user.id && hasPermission(user.role, 'projects:create'));

  if (hasContentEdits && !canEdit) {
    throw error(403, 'Permission insuffisante pour modifier ce projet.');
  }

  if (!isValidationAction && !hasContentEdits) {
    throw error(400, 'Aucune modification fournie.');
  }

  const updates: Partial<typeof projects.$inferInsert> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.budgetPlannedCents !== undefined) updates.budgetPlannedCents = body.budgetPlannedCents;
  if (body.safetyChecklist !== undefined) {
    updates.safetyChecklistJson = JSON.stringify(body.safetyChecklist);
  }
  if (body.eventDate !== undefined) {
    if (body.eventDate === null || body.eventDate === '') {
      updates.eventDate = null;
    } else {
      const dt = new Date(body.eventDate);
      if (Number.isNaN(dt.getTime())) {
        throw error(400, 'Date d’événement invalide.');
      }
      updates.eventDate = dt.toISOString();
    }
  }
  if (body.status !== undefined) {
    updates.status = body.status;
  }
  if (isValidationAction) {
    updates.profValidatedBy = user.id;
    updates.profValidatedAt = new Date().toISOString();
    if (!body.status) {
      updates.status = 'valide';
    }
  }

  const [updated] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, id))
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: isValidationAction ? 'project:validate' : 'project:update',
    targetType: 'project',
    targetId: id,
    details: { status: updated.status, validated: isValidationAction }
  });

  return json({
    project: {
      ...updated,
      safetyChecklist: safeJsonParse(updated.safetyChecklistJson, [])
    }
  });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event, 'projects:edit');
  const id = parsePositiveIntId(event.params.id, 'Projet');

  const [deleted] = await db.delete(projects).where(eq(projects.id, id)).returning();
  if (!deleted) {
    throw error(404, 'Projet introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'project:delete',
    targetType: 'project',
    targetId: id,
    details: { title: deleted.title }
  });

  return json({ deleted: true, id });
};
