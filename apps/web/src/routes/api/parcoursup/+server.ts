import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
  parcoursupDrafts,
  projectMembers,
  projects,
  users
} from '$lib/server/db/schema';
import {
  parseJsonBody,
  parsePositiveIntId,
  pdfResponse,
  safeJsonParse
} from '$lib/server/http';
import { generateParcoursupPdf } from '$lib/server/pdf';
import { getRoleLabel, hasPermission } from '$shared/permissions';
import type { RequestHandler } from './$types';

const parcoursupPutSchema = z.object({
  schoolYear: z.string().trim().min(4).max(20).optional(),
  summaryText: z.string().trim().max(3000),
  skills: z.array(z.string().trim().min(1).max(80)).max(20),
  hoursTotal: z.number().min(0).max(2000)
});

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'parcoursup:read_own');

  const rawTargetUserId = event.url.searchParams.get('userId');
  const targetUserId = rawTargetUserId
    ? parsePositiveIntId(rawTargetUserId, 'Utilisateur')
    : user.id;

  if (targetUserId !== user.id && !hasPermission(user.role, 'parcoursup:export_all')) {
    throw error(403, 'Vous ne pouvez consulter que votre propre dossier Parcoursup.');
  }

  const schoolYear =
    event.url.searchParams.get('schoolYear')?.trim() || event.locals.settings.schoolYear;

  const [[targetUser], memberships, [draft]] = await Promise.all([
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        classe: users.classe,
        role: users.role,
        customTitle: users.customTitle
      })
      .from(users)
      .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
      .limit(1),
    db
      .select({
        projectId: projects.id,
        title: projects.title,
        category: projects.category,
        status: projects.status,
        roleInProject: projectMembers.roleInProject,
        hoursLogged: projectMembers.hoursLogged
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, targetUserId)),
    db
      .select()
      .from(parcoursupDrafts)
      .where(
        and(
          eq(parcoursupDrafts.userId, targetUserId),
          eq(parcoursupDrafts.schoolYear, schoolYear)
        )
      )
      .limit(1)
  ]);

  if (!targetUser) {
    throw error(404, 'Membre introuvable.');
  }

  const loggedHours = memberships.reduce((sum, m) => sum + (m.hoursLogged || 0), 0);
  const hoursTotal = draft && draft.hoursTotal > 0 ? draft.hoursTotal : loggedHours;
  const skills = draft
    ? safeJsonParse<string[]>(draft.skillsJson, [])
    : ['Travail en équipe', 'Engagement associatif', 'Organisation d’événements'];
  const summaryText = draft?.summaryText ?? '';
  const roleLabel = getRoleLabel(targetUser.role, targetUser.customTitle);

  if (event.url.searchParams.get('format') === 'pdf') {
    const projectsList = memberships.map(
      (m) => `${m.title} (${m.roleInProject} — ${m.hoursLogged}h)`
    );

    const bytes = await generateParcoursupPdf({
      schoolName: event.locals.settings.schoolName,
      mdlName: event.locals.settings.mdlName,
      studentName: `${targetUser.firstName} ${targetUser.lastName}`,
      classe: targetUser.classe || 'Lycéen(ne)',
      roleLabel,
      schoolYear,
      hoursTotal,
      projectsList,
      skills,
      summaryText
    });

    await appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'parcoursup:export_pdf',
      targetType: 'user',
      targetId: targetUser.id,
      details: { schoolYear }
    });

    return pdfResponse(bytes, `attestation-parcoursup-${targetUser.id}.pdf`);
  }

  return json({
    student: {
      id: targetUser.id,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      classe: targetUser.classe,
      role: targetUser.role,
      roleLabel
    },
    schoolYear,
    loggedHours,
    projects: memberships,
    draft: {
      summaryText,
      skills,
      hoursTotal,
      updatedAt: draft?.updatedAt ?? null
    }
  });
};

export const PUT: RequestHandler = async (event) => {
  const user = requireAuth(event, 'parcoursup:read_own');
  const body = await parseJsonBody(event.request, parcoursupPutSchema);
  const schoolYear = body.schoolYear || event.locals.settings.schoolYear;
  const nowIso = new Date().toISOString();

  const [saved] = await db
    .insert(parcoursupDrafts)
    .values({
      userId: user.id,
      schoolYear,
      summaryText: body.summaryText,
      skillsJson: JSON.stringify(body.skills),
      hoursTotal: body.hoursTotal,
      updatedAt: nowIso
    })
    .onConflictDoUpdate({
      target: [parcoursupDrafts.userId, parcoursupDrafts.schoolYear],
      set: {
        summaryText: body.summaryText,
        skillsJson: JSON.stringify(body.skills),
        hoursTotal: body.hoursTotal,
        updatedAt: nowIso
      }
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'parcoursup:draft_save',
    targetType: 'parcoursup_draft',
    targetId: saved.id,
    details: { schoolYear, hoursTotal: saved.hoursTotal }
  });

  return json({
    draft: {
      id: saved.id,
      schoolYear: saved.schoolYear,
      summaryText: saved.summaryText,
      skills: safeJsonParse<string[]>(saved.skillsJson, []),
      hoursTotal: saved.hoursTotal,
      updatedAt: saved.updatedAt
    }
  });
};
