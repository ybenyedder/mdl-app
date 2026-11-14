import { redirect } from '@sveltejs/kit';
import { and, asc, count, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { hmacLookup } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	assemblies,
	budgetEntries,
	events,
	pollVotes,
	polls,
	projects,
	projectTasks,
	tickets,
	users
} from '$lib/server/db/schema';
import { canAccessPollScope } from '$lib/server/polls';
import { daysUntil } from '$shared/format';
import { hasAnyPermission, hasPermission } from '$shared/permissions';
import type { PageServerLoad } from './$types';

export interface DashboardAlert {
	id: string;
	severity: 'info' | 'warning' | 'danger';
	title: string;
	description: string;
	href: string;
	ctaLabel: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(302, '/connexion');
	}

	const settings = locals.settings;
	const nowIso = new Date().toISOString();
	const recentCutoffIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

	const canReadProjects = hasPermission(user.role, 'projects:read');
	const canValidateProjects = hasPermission(user.role, 'projects:validate');
	const canReadBudget = hasPermission(user.role, 'budget:read');
	const canReadAg = hasPermission(user.role, 'ag:read');
	const canReadPolls = hasPermission(user.role, 'polls:read');
	const canReadAllEvents = hasAnyPermission(user.role, ['tickets:manage', 'tickets:read_admin']);
	const canManageMembers = hasAnyPermission(user.role, ['members:read', 'members:manage']);

	const [
		activeProjectsRows,
		pendingTasksRows,
		budgetRows,
		assemblyRows,
		pollRows,
		upcomingEventRows,
		nonAdherentCountRows
	] = await Promise.all([
		canReadProjects
			? db
					.select({
						id: projects.id,
						title: projects.title,
						category: projects.category,
						eventDate: projects.eventDate,
						budgetPlannedCents: projects.budgetPlannedCents,
						status: projects.status,
						profValidatedAt: projects.profValidatedAt
					})
					.from(projects)
					.where(inArray(projects.status, ['brouillon', 'en_cours', 'valide']))
					.orderBy(asc(projects.eventDate), desc(projects.id))
			: Promise.resolve([]),
		canReadProjects
			? db
					.select({
						id: projectTasks.id,
						projectId: projectTasks.projectId,
						title: projectTasks.title,
						status: projectTasks.status,
						dueDate: projectTasks.dueDate,
						assigneeId: projectTasks.assigneeId,
						projectTitle: projects.title
					})
					.from(projectTasks)
					.innerJoin(projects, eq(projectTasks.projectId, projects.id))
					.where(ne(projectTasks.status, 'done'))
					.orderBy(asc(projectTasks.dueDate), asc(projectTasks.id))
			: Promise.resolve([]),
		canReadBudget
			? db
					.select({
						id: budgetEntries.id,
						type: budgetEntries.type,
						amountCents: budgetEntries.amountCents,
						validatedBy: budgetEntries.validatedBy,
						receiptPath: budgetEntries.receiptPath
					})
					.from(budgetEntries)
					.where(eq(budgetEntries.fiscalYear, settings.schoolYear))
			: Promise.resolve([]),
		canReadAg
			? db
					.select({
						id: assemblies.id,
						title: assemblies.title,
						scheduledAt: assemblies.scheduledAt,
						location: assemblies.location,
						status: assemblies.status,
						quorumRequired: assemblies.quorumRequired
					})
					.from(assemblies)
					.where(ne(assemblies.status, 'cloturee'))
					.orderBy(asc(assemblies.scheduledAt))
			: Promise.resolve([]),
		canReadPolls
			? db
					.select({
						id: polls.id,
						title: polls.title,
						scope: polls.scope,
						closesAt: polls.closesAt
					})
					.from(polls)
					.where(eq(polls.isOpen, true))
					.orderBy(desc(polls.createdAt))
			: Promise.resolve([]),
		db
			.select({
				id: events.id,
				title: events.title,
				eventDate: events.eventDate,
				location: events.location,
				capacity: events.capacity,
				isPublic: events.isPublic
			})
			.from(events)
			.where(
				canReadAllEvents
					? gte(events.eventDate, recentCutoffIso)
					: and(eq(events.isPublic, true), gte(events.eventDate, recentCutoffIso))
			)
			.orderBy(asc(events.eventDate))
			.limit(5),
		canManageMembers
			? db
					.select({ total: count() })
					.from(users)
					.where(and(eq(users.isAdherent, false), isNull(users.deletedAt)))
			: Promise.resolve([])
	]);

	// Budget summary
	let totalRecettesCents = 0;
	let totalDepensesCents = 0;
	let unvalidatedBudgetCount = 0;
	for (const row of budgetRows) {
		if (row.type === 'recette') totalRecettesCents += row.amountCents;
		else totalDepensesCents += row.amountCents;
		if (row.validatedBy === null) unvalidatedBudgetCount += 1;
	}
	const soldeCents = totalRecettesCents - totalDepensesCents;

	// Polls accessible + vote status for user
	const nowMs = Date.now();
	const accessiblePolls = pollRows.filter(
		(p) =>
			canAccessPollScope(user, p.scope) &&
			(!p.closesAt || new Date(p.closesAt).getTime() > nowMs)
	);

	const pollIds = accessiblePolls.map((p) => p.id);
	const votedPollIds = new Set<number>();
	if (pollIds.length > 0) {
		const userHashByPoll = new Map<number, string>(
			pollIds.map((id) => [id, hmacLookup(`poll:${id}:user:${user.id}`)])
		);
		const voteRows = await db
			.select({ pollId: pollVotes.pollId, voterKeyHash: pollVotes.voterKeyHash })
			.from(pollVotes)
			.where(inArray(pollVotes.pollId, pollIds));

		for (const vr of voteRows) {
			if (vr.voterKeyHash === userHashByPoll.get(vr.pollId)) {
				votedPollIds.add(vr.pollId);
			}
		}
	}

	const openPolls = accessiblePolls.slice(0, 4).map((p) => ({
		...p,
		hasVoted: votedPollIds.has(p.id)
	}));

	// Sold ticket counts for upcoming events
	const eventIds = upcomingEventRows.map((e) => e.id);
	const soldMap = new Map<number, number>();
	if (eventIds.length > 0) {
		const soldRows = await db
			.select({ eventId: tickets.eventId, sold: count() })
			.from(tickets)
			.where(and(inArray(tickets.eventId, eventIds), ne(tickets.paymentStatus, 'annule')))
			.groupBy(tickets.eventId);

		for (const sr of soldRows) {
			soldMap.set(sr.eventId, Number(sr.sold));
		}
	}

	const upcomingEvents = upcomingEventRows.map((ev) => ({
		...ev,
		remainingSeats: Math.max(0, ev.capacity - (soldMap.get(ev.id) ?? 0))
	}));

	// Urgent tasks (due within 7 days or overdue)
	const dueTasks = pendingTasksRows
		.filter((t) => {
			if (!t.dueDate) return false;
			const d = daysUntil(t.dueDate);
			return d !== null && d <= 7;
		})
		.slice(0, 6);

	const pendingAdhesionsCount = Number(nonAdherentCountRows[0]?.total ?? 0);
	const pendingValidationProjects = activeProjectsRows.filter(
		(p) => p.status !== 'valide' && !p.profValidatedAt
	);

	// Automatic alerts & reminders
	const alerts: DashboardAlert[] = [];

	if (!user.isAdherent) {
		alerts.push({
			id: 'adhesion-self',
			severity: 'warning',
			title: 'Adhésion MDL en attente de validation',
			description:
				'Réglez votre cotisation auprès du bureau de la MDL pour accéder aux votes en AG et aux tarifs adhérents.',
			href: '/billetterie',
			ctaLabel: 'Voir les événements'
		});
	}

	if (canManageMembers && pendingAdhesionsCount > 0) {
		alerts.push({
			id: 'adhesions-pending',
			severity: 'info',
			title: `${pendingAdhesionsCount} adhésion${pendingAdhesionsCount > 1 ? 's' : ''} en attente`,
			description:
				'Des élèves inscrits n’ont pas encore leur cotisation validée dans l’annuaire.',
			href: '/membres',
			ctaLabel: 'Gérer les membres'
		});
	}

	for (const ag of assemblyRows) {
		const days = daysUntil(ag.scheduledAt);
		if (ag.status === 'vote_ouvert') {
			alerts.push({
				id: `ag-vote-${ag.id}`,
				severity: 'danger',
				title: `Scrutin ouvert : ${ag.title}`,
				description: `Le vote en Assemblée Générale est actuellement ouvert (${ag.location}).`,
				href: '/ag',
				ctaLabel: 'Voter maintenant'
			});
		} else if (days !== null && days >= 0 && days <= 7) {
			alerts.push({
				id: `ag-j7-${ag.id}`,
				severity: days <= 2 ? 'danger' : 'warning',
				title: `AG à ${days === 0 ? 'Jour J' : `J-${days}`} : ${ag.title}`,
				description: `Séance prévue à ${ag.location}. Pensez à vérifier le quorum et les candidatures.`,
				href: '/ag',
				ctaLabel: 'Ouvrir l’espace AG'
			});
		}
	}

	for (const task of dueTasks.slice(0, 3)) {
		const d = daysUntil(task.dueDate);
		const isLate = d !== null && d < 0;
		alerts.push({
			id: `task-due-${task.id}`,
			severity: isLate ? 'danger' : 'warning',
			title: isLate
				? `Tâche en retard : ${task.title}`
				: `Échéance proche (${d === 0 ? "aujourd'hui" : `J-${d}`}) : ${task.title}`,
			description: `Projet « ${task.projectTitle} »`,
			href: `/projets/${task.projectId}`,
			ctaLabel: 'Voir le Kanban'
		});
	}

	if (canValidateProjects && pendingValidationProjects.length > 0) {
		alerts.push({
			id: 'prof-validation',
			severity: 'info',
			title: `${pendingValidationProjects.length} projet${pendingValidationProjects.length > 1 ? 's' : ''} à valider`,
			description:
				'En tant que référent, vérifiez la checklist sécurité avant de valider les projets.',
			href: `/projets/${pendingValidationProjects[0].id}`,
			ctaLabel: 'Examiner'
		});
	}

	if (canReadBudget && unvalidatedBudgetCount > 0 && hasPermission(user.role, 'budget:write')) {
		alerts.push({
			id: 'budget-unvalidated',
			severity: 'info',
			title: `${unvalidatedBudgetCount} écriture${unvalidatedBudgetCount > 1 ? 's' : ''} comptable${unvalidatedBudgetCount > 1 ? 's' : ''} à valider`,
			description: 'Vérifiez les justificatifs puis validez les écritures de l’exercice.',
			href: '/budget',
			ctaLabel: 'Ouvrir la trésorerie'
		});
	}

	return {
		generatedAt: nowIso,
		permissions: {
			canReadProjects,
			canCreateProjects: hasPermission(user.role, 'projects:create'),
			canValidateProjects,
			canReadBudget,
			canWriteBudget: hasPermission(user.role, 'budget:write'),
			canReadAg,
			canVoteAg: hasPermission(user.role, 'ag:vote'),
			canReadPolls,
			canReadPassation: hasPermission(user.role, 'passation:read'),
			canScanTickets: hasPermission(user.role, 'tickets:scan'),
			canManageMembers
		},
		kpis: {
			activeProjectsCount: activeProjectsRows.length,
			pendingTasksCount: pendingTasksRows.length,
			budget: canReadBudget
				? {
						totalRecettesCents,
						totalDepensesCents,
						soldeCents,
						unvalidatedCount: unvalidatedBudgetCount
					}
				: null,
			openPollsCount: accessiblePolls.length,
			unvotedPollsCount: accessiblePolls.filter((p) => !votedPollIds.has(p.id)).length,
			upcomingEventsCount: upcomingEvents.length,
			openAssembliesCount: assemblyRows.length,
			pendingAdhesionsCount: canManageMembers ? pendingAdhesionsCount : null,
			pendingValidationCount: canValidateProjects ? pendingValidationProjects.length : null
		},
		activeProjects: activeProjectsRows.slice(0, 5),
		dueTasks,
		assemblies: assemblyRows.slice(0, 3),
		openPolls,
		upcomingEvents,
		alerts
	};
};
