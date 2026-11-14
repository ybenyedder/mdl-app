import { and, asc, count, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, pollVotes, polls, projects, tickets, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export interface PublicEventSummary {
	id: number;
	title: string;
	description: string;
	eventDate: string;
	location: string;
	capacity: number;
	remainingSeats: number;
	priceFullCents: number;
	priceReducedCents: number;
	pricePresaleCents: number;
	hasAccessCode: boolean;
}

export interface PublicPollSummary {
	id: number;
	title: string;
	description: string;
	options: string[];
	multipleChoice: boolean;
	closesAt: string | null;
	votesCount: number;
}

function parsePollOptions(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is string => typeof item === 'string');
		}
		return [];
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async () => {
	const cutoffIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

	const [rawEvents, rawPolls, adherentsRows, activeProjectsRows] = await Promise.all([
		db
			.select({
				id: events.id,
				title: events.title,
				description: events.description,
				eventDate: events.eventDate,
				location: events.location,
				capacity: events.capacity,
				priceFullCents: events.priceFullCents,
				priceReducedCents: events.priceReducedCents,
				pricePresaleCents: events.pricePresaleCents,
				accessCode: events.accessCode
			})
			.from(events)
			.where(and(eq(events.isPublic, true), gte(events.eventDate, cutoffIso)))
			.orderBy(asc(events.eventDate))
			.limit(6),
		db
			.select({
				id: polls.id,
				title: polls.title,
				description: polls.description,
				optionsJson: polls.optionsJson,
				multipleChoice: polls.multipleChoice,
				closesAt: polls.closesAt
			})
			.from(polls)
			.where(and(eq(polls.isOpen, true), eq(polls.scope, 'lycee')))
			.orderBy(desc(polls.createdAt))
			.limit(4),
		db
			.select({ value: count() })
			.from(users)
			.where(and(eq(users.isAdherent, true), isNull(users.deletedAt))),
		db
			.select({ value: count() })
			.from(projects)
			.where(inArray(projects.status, ['en_cours', 'valide']))
	]);

	const eventIds = rawEvents.map((e) => e.id);
	const soldMap = new Map<number, number>();
	if (eventIds.length > 0) {
		const soldRows = await db
			.select({
				eventId: tickets.eventId,
				soldCount: count()
			})
			.from(tickets)
			.where(and(inArray(tickets.eventId, eventIds), ne(tickets.paymentStatus, 'annule')))
			.groupBy(tickets.eventId);

		for (const row of soldRows) {
			soldMap.set(row.eventId, Number(row.soldCount));
		}
	}

	const pollIds = rawPolls.map((p) => p.id);
	const pollVotesMap = new Map<number, number>();
	if (pollIds.length > 0) {
		const voteRows = await db
			.select({
				pollId: pollVotes.pollId,
				total: count()
			})
			.from(pollVotes)
			.where(inArray(pollVotes.pollId, pollIds))
			.groupBy(pollVotes.pollId);

		for (const row of voteRows) {
			pollVotesMap.set(row.pollId, Number(row.total));
		}
	}

	const upcomingEvents: PublicEventSummary[] = rawEvents.map((ev) => {
		const reserved = soldMap.get(ev.id) ?? 0;
		return {
			id: ev.id,
			title: ev.title,
			description: ev.description,
			eventDate: ev.eventDate,
			location: ev.location,
			capacity: ev.capacity,
			remainingSeats: Math.max(0, ev.capacity - reserved),
			priceFullCents: ev.priceFullCents,
			priceReducedCents: ev.priceReducedCents,
			pricePresaleCents: ev.pricePresaleCents,
			hasAccessCode: Boolean(ev.accessCode)
		};
	});

	const nowMs = Date.now();
	const openPolls: PublicPollSummary[] = rawPolls
		.filter((p) => !p.closesAt || new Date(p.closesAt).getTime() > nowMs)
		.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			options: parsePollOptions(p.optionsJson),
			multipleChoice: p.multipleChoice,
			closesAt: p.closesAt,
			votesCount: pollVotesMap.get(p.id) ?? 0
		}));

	return {
		upcomingEvents,
		openPolls,
		stats: {
			adherentsCount: Number(adherentsRows[0]?.value ?? 0),
			activeProjectsCount: Number(activeProjectsRows[0]?.value ?? 0)
		}
	};
};
