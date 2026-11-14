import { eq } from 'drizzle-orm';
import { safeDecrypt } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import {
  db,
  events,
  parcoursupDrafts,
  projectMembers,
  projects,
  projectTasks,
  tickets,
  users
} from '$lib/server/db';
import { safeJsonParse } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const actor = requireAuth(event);

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!userRow) {
    return new Response(JSON.stringify({ error: 'Utilisateur introuvable.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const [ledProjects, memberships, assignedTasks, userTickets, drafts] = await Promise.all([
    db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        category: projects.category,
        eventDate: projects.eventDate,
        budgetPlannedCents: projects.budgetPlannedCents,
        status: projects.status,
        createdAt: projects.createdAt
      })
      .from(projects)
      .where(eq(projects.leadUserId, actor.id)),
    db
      .select({
        projectId: projects.id,
        projectTitle: projects.title,
        projectStatus: projects.status,
        hoursLogged: projectMembers.hoursLogged,
        roleInProject: projectMembers.roleInProject
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, actor.id)),
    db
      .select({
        id: projectTasks.id,
        projectId: projectTasks.projectId,
        title: projectTasks.title,
        status: projectTasks.status,
        dueDate: projectTasks.dueDate,
        createdAt: projectTasks.createdAt
      })
      .from(projectTasks)
      .where(eq(projectTasks.assigneeId, actor.id)),
    db
      .select({
        id: tickets.id,
        eventId: tickets.eventId,
        eventTitle: events.title,
        eventDate: events.eventDate,
        eventLocation: events.location,
        buyerName: tickets.buyerName,
        buyerEmailEncrypted: tickets.buyerEmailEncrypted,
        buyerClasse: tickets.buyerClasse,
        tier: tickets.tier,
        priceCents: tickets.priceCents,
        paymentMethod: tickets.paymentMethod,
        paymentStatus: tickets.paymentStatus,
        qrCodeId: tickets.qrCodeId,
        scannedAt: tickets.scannedAt,
        createdAt: tickets.createdAt
      })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .where(eq(tickets.buyerUserId, actor.id)),
    db
      .select({
        id: parcoursupDrafts.id,
        schoolYear: parcoursupDrafts.schoolYear,
        summaryText: parcoursupDrafts.summaryText,
        skillsJson: parcoursupDrafts.skillsJson,
        hoursTotal: parcoursupDrafts.hoursTotal,
        updatedAt: parcoursupDrafts.updatedAt
      })
      .from(parcoursupDrafts)
      .where(eq(parcoursupDrafts.userId, actor.id))
  ]);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    gdprBasis: 'Article 15 & Article 20 RGPD — Droit d’accès et de portabilité',
    profile: {
      id: userRow.id,
      email: safeDecrypt(userRow.emailEncrypted),
      legalGuardianEmail: userRow.legalGuardianEmailEncrypted
        ? safeDecrypt(userRow.legalGuardianEmailEncrypted)
        : null,
      firstName: userRow.firstName,
      lastName: userRow.lastName,
      classe: userRow.classe,
      role: userRow.role,
      customTitle: userRow.customTitle,
      isAdherent: userRow.isAdherent,
      adhesionPaidAt: userRow.adhesionPaidAt,
      adhesionMethod: userRow.adhesionMethod,
      totpEnabled: userRow.totpEnabled,
      deletionRequestedAt: userRow.deletionRequestedAt,
      createdAt: userRow.createdAt,
      updatedAt: userRow.updatedAt
    },
    projects: {
      led: ledProjects,
      participations: memberships,
      assignedTasks
    },
    tickets: userTickets.map((t) => ({
      id: t.id,
      eventId: t.eventId,
      eventTitle: t.eventTitle,
      eventDate: t.eventDate,
      eventLocation: t.eventLocation,
      buyerName: t.buyerName,
      buyerEmail: safeDecrypt(t.buyerEmailEncrypted),
      buyerClasse: t.buyerClasse,
      tier: t.tier,
      priceCents: t.priceCents,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      qrCodeId: t.qrCodeId,
      scannedAt: t.scannedAt,
      createdAt: t.createdAt
    })),
    parcoursupDrafts: drafts.map((d) => ({
      id: d.id,
      schoolYear: d.schoolYear,
      summaryText: d.summaryText,
      skills: safeJsonParse<unknown[]>(d.skillsJson, []),
      hoursTotal: d.hoursTotal,
      updatedAt: d.updatedAt
    }))
  };

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'rgpd.export',
    targetType: 'user',
    targetId: actor.id
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="mdl-rgpd-export-${actor.id}-${dateStamp}.json"`
    }
  });
};
