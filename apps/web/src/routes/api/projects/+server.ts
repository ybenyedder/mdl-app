import { error, json } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { projectMembers, projects, projectTasks, users } from '$lib/server/db/schema';
import { parseJsonBody, safeJsonParse } from '$lib/server/http';
import { PROJECT_TEMPLATES } from '$shared/project-templates';
import { projectCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export interface SafetyChecklistItem {
  label: string;
  checked: boolean;
}

const projectPostSchema = projectCreateSchema.extend({
  category: z.string().trim().min(2).max(60).optional(),
  safetyChecklist: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(160),
        status: z.enum(['todo', 'doing', 'done']).default('todo'),
        dueDate: z.string().trim().optional()
      })
    )
    .max(40)
    .optional()
});

function computeDueDate(eventDateIso: string | null, daysBeforeEvent: number): string | null {
  if (!eventDateIso) return null;
  const dt = new Date(eventDateIso);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() - daysBeforeEvent);
  return dt.toISOString().slice(0, 10);
}

export const GET: RequestHandler = async (event) => {
  requireAuth(event, 'projects:read');

  const [projectRows, taskRows, memberRows] = await Promise.all([
    db.select().from(projects).orderBy(desc(projects.createdAt), desc(projects.id)),
    db
      .select()
      .from(projectTasks)
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
  ]);

  const tasksByProject = new Map<number, typeof taskRows>();
  for (const task of taskRows) {
    const list = tasksByProject.get(task.projectId) ?? [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  }

  const membersByProject = new Map<number, typeof memberRows>();
  for (const member of memberRows) {
    const list = membersByProject.get(member.projectId) ?? [];
    list.push(member);
    membersByProject.set(member.projectId, list);
  }

  const enriched = projectRows.map((p) => ({
    ...p,
    safetyChecklist: safeJsonParse<SafetyChecklistItem[]>(p.safetyChecklistJson, []),
    tasks: tasksByProject.get(p.id) ?? [],
    members: membersByProject.get(p.id) ?? []
  }));

  return json({ projects: enriched, templates: PROJECT_TEMPLATES });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'projects:create');
  const body = await parseJsonBody(event.request, projectPostSchema);

  const template = body.templateId
    ? PROJECT_TEMPLATES.find((t) => t.id === body.templateId)
    : undefined;
  if (body.templateId && !template) {
    throw error(400, 'Modèle de projet introuvable.');
  }
  if (!body.category && !template) {
    throw error(400, 'La catégorie est requise pour un projet personnalisé.');
  }

  let eventDateIso: string | null = null;
  if (body.eventDate) {
    const parsedDate = new Date(body.eventDate);
    if (Number.isNaN(parsedDate.getTime())) {
      throw error(400, 'Date d’événement invalide.');
    }
    eventDateIso = parsedDate.toISOString();
  }

  const checklistSource =
    body.safetyChecklist && body.safetyChecklist.length > 0
      ? body.safetyChecklist
      : (template?.safetyChecklist ?? []);

  const safetyChecklist: SafetyChecklistItem[] = checklistSource.map((label) => ({
    label,
    checked: false
  }));

  const tasksToInsert =
    body.tasks && body.tasks.length > 0
      ? body.tasks.map((t, idx) => ({
          title: t.title,
          status: t.status,
          dueDate: t.dueDate ?? null,
          position: idx
        }))
      : (template?.defaultTasks ?? []).map((t, idx) => ({
          title: t.title,
          status: t.status,
          dueDate: computeDueDate(eventDateIso, t.daysBeforeEvent),
          position: idx
        }));

  const created = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        templateId: template?.id ?? null,
        title: body.title,
        description: body.description || template?.description || '',
        category: body.category || template?.category || 'Vie lycéenne',
        eventDate: eventDateIso,
        budgetPlannedCents: body.budgetPlannedCents || template?.estimatedBudgetCents || 0,
        status: 'brouillon',
        leadUserId: user.id,
        safetyChecklistJson: JSON.stringify(safetyChecklist)
      })
      .returning();

    const [leadMember] = await tx
      .insert(projectMembers)
      .values({
        projectId: project.id,
        userId: user.id,
        hoursLogged: 0,
        roleInProject: 'Porteur de projet'
      })
      .returning();

    const insertedTasks =
      tasksToInsert.length > 0
        ? await tx
            .insert(projectTasks)
            .values(
              tasksToInsert.map((t) => ({
                projectId: project.id,
                title: t.title,
                status: t.status,
                dueDate: t.dueDate,
                assigneeId: user.id,
                position: t.position
              }))
            )
            .returning()
        : [];

    return { project, tasks: insertedTasks, members: [leadMember] };
  });

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'project:create',
    targetType: 'project',
    targetId: created.project.id,
    details: { title: created.project.title, templateId: created.project.templateId }
  });

  return json(
    {
      project: {
        ...created.project,
        safetyChecklist,
        tasks: created.tasks,
        members: created.members.map((m) => ({
          ...m,
          firstName: user.firstName,
          lastName: user.lastName,
          classe: user.classe,
          role: user.role
        }))
      }
    },
    { status: 201 }
  );
};
