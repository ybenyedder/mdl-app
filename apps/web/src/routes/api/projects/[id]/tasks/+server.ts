import { error, json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { projectTasks, projects, TASK_STATUSES, users } from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { hasPermission } from '$shared/permissions';
import { taskCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const taskPostSchema = taskCreateSchema.extend({
  assigneeId: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional()
});

const taskPatchSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().trim().min(2).max(160).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().trim().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional()
});

const taskDeleteSchema = z.object({
  taskId: z.number().int().positive()
});

async function assertProjectTaskAccess(
  projectId: number,
  user: NonNullable<App.Locals['user']>
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id, leadUserId: projects.leadUserId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw error(404, 'Projet introuvable.');
  }

  const canEdit =
    hasPermission(user.role, 'projects:edit') ||
    (project.leadUserId === user.id && hasPermission(user.role, 'projects:create'));

  if (!canEdit) {
    throw error(403, 'Accès refusé pour gérer les tâches de ce projet.');
  }
}

async function ensureActiveUserExists(userId: number): Promise<void> {
  const [found] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!found) {
    throw error(400, 'Membre assigné introuvable.');
  }
}

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const projectId = parsePositiveIntId(event.params.id, 'Projet');
  await assertProjectTaskAccess(projectId, user);

  const body = await parseJsonBody(event.request, taskPostSchema);
  if (body.assigneeId) {
    await ensureActiveUserExists(body.assigneeId);
  }

  let position = body.position;
  if (position === undefined) {
    const [last] = await db
      .select({ position: projectTasks.position })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId))
      .orderBy(desc(projectTasks.position))
      .limit(1);
    position = (last?.position ?? -1) + 1;
  }

  const [task] = await db
    .insert(projectTasks)
    .values({
      projectId,
      title: body.title,
      status: body.status,
      dueDate: body.dueDate ?? null,
      assigneeId: body.assigneeId ?? null,
      position
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'project:task_create',
    targetType: 'project_task',
    targetId: task.id,
    details: { projectId, title: task.title }
  });

  return json({ task }, { status: 201 });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const projectId = parsePositiveIntId(event.params.id, 'Projet');
  await assertProjectTaskAccess(projectId, user);

  const body = await parseJsonBody(event.request, taskPatchSchema);
  if (body.assigneeId) {
    await ensureActiveUserExists(body.assigneeId);
  }

  const updates: Partial<typeof projectTasks.$inferInsert> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.status !== undefined) updates.status = body.status;
  if (body.dueDate !== undefined) updates.dueDate = body.dueDate;
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
  if (body.position !== undefined) updates.position = body.position;

  if (Object.keys(updates).length === 0) {
    throw error(400, 'Aucune modification fournie.');
  }

  const [updated] = await db
    .update(projectTasks)
    .set(updates)
    .where(and(eq(projectTasks.id, body.taskId), eq(projectTasks.projectId, projectId)))
    .returning();

  if (!updated) {
    throw error(404, 'Tâche introuvable dans ce projet.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'project:task_update',
    targetType: 'project_task',
    targetId: updated.id,
    details: { projectId, status: updated.status, position: updated.position }
  });

  return json({ task: updated });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event);
  const projectId = parsePositiveIntId(event.params.id, 'Projet');
  await assertProjectTaskAccess(projectId, user);

  const queryTaskId = event.url.searchParams.get('taskId');
  const taskId = queryTaskId
    ? parsePositiveIntId(queryTaskId, 'Tâche')
    : (await parseJsonBody(event.request, taskDeleteSchema)).taskId;

  const [deleted] = await db
    .delete(projectTasks)
    .where(and(eq(projectTasks.id, taskId), eq(projectTasks.projectId, projectId)))
    .returning();

  if (!deleted) {
    throw error(404, 'Tâche introuvable dans ce projet.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'project:task_delete',
    targetType: 'project_task',
    targetId: deleted.id,
    details: { projectId, title: deleted.title }
  });

  return json({ deleted: true, taskId: deleted.id });
};
