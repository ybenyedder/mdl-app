<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { formatDateFr, formatDateTimeFr, formatEuros } from '$shared/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function minPriceLabel(ev: PageData['upcomingEvents'][number]): string {
		const prices = [ev.pricePresaleCents, ev.priceReducedCents, ev.priceFullCents].filter(
			(p) => p >= 0
		);
		const min = prices.length > 0 ? Math.min(...prices) : 0;
		if (min === 0) return 'Gratuit';
		return `Dès ${formatEuros(min)}`;
	}

	function calendarMonthDay(iso: string | Date): { month: string; day: string } {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return { month: '—', day: '—' };
		const month = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
			.format(d)
			.replace('.', '')
			.toUpperCase();
		const day = String(d.getDate());
		return { month, day };
	}

	function soldRatio(ev: PageData['upcomingEvents'][number]): number {
		if (ev.capacity <= 0) return 0;
		const sold = Math.max(0, ev.capacity - ev.remainingSeats);
		return Math.min(1, sold / ev.capacity);
	}
</script>

<svelte:head>
	<title>{data.settings.mdlName} — {data.settings.schoolName}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 space-y-8 sm:space-y-10">
	<!-- Apple Large Title Header -->
	<section class="animate-spring space-y-5">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div class="space-y-1">
				<p class="text-[12px] font-medium text-muted">
					{data.settings.schoolName} · {data.settings.schoolYear}
				</p>
				<h1 class="text-[30px] sm:text-[36px] font-semibold tracking-[-0.03em] leading-[1.08] text-ink">
					{data.settings.mdlName}
				</h1>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button href="/billetterie" variant="primary" size="md">
					Billetterie
				</Button>
				{#if data.user}
					<Button href="/dashboard" variant="secondary" size="md">
						Mon espace
					</Button>
				{:else}
					<Button href="/inscription" variant="secondary" size="md">
						Adhérer
					</Button>
				{/if}
			</div>
		</div>

		<!-- Bandeau métriques unifié 3 colonnes avec séparateurs hairline -->
		<div class="ios-group grid grid-cols-3 divide-x divide-border">
			<div class="px-3.5 py-3.5 sm:px-5 sm:py-4">
				<p class="text-[11px] font-medium text-muted">Cotisation</p>
				<p class="mt-0.5 tabular-nums text-[19px] sm:text-[22px] font-semibold tracking-[-0.02em] text-ink">
					{data.settings.membershipFeeCents === 0
						? 'Gratuit'
						: formatEuros(data.settings.membershipFeeCents)}
				</p>
			</div>
			<div class="px-3.5 py-3.5 sm:px-5 sm:py-4">
				<p class="text-[11px] font-medium text-muted">Adhérents</p>
				<p class="mt-0.5 tabular-nums text-[19px] sm:text-[22px] font-semibold tracking-[-0.02em] text-ink">
					{data.stats.adherentsCount}
				</p>
			</div>
			<div class="px-3.5 py-3.5 sm:px-5 sm:py-4">
				<p class="text-[11px] font-medium text-muted">Projets actifs</p>
				<p class="mt-0.5 tabular-nums text-[19px] sm:text-[22px] font-semibold tracking-[-0.02em] text-ink">
					{data.stats.activeProjectsCount}
				</p>
			</div>
		</div>
	</section>

	<!-- Prochains événements -->
	<section aria-labelledby="events-heading" class="space-y-3">
		<div class="flex items-baseline justify-between gap-3">
			<h2 id="events-heading" class="text-[18px] sm:text-[20px] font-semibold tracking-[-0.02em] text-ink">
				Événements
			</h2>
			<a
				href="/billetterie"
				class="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand-ink hover:underline"
			>
				Tout voir
				<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
				</svg>
			</a>
		</div>

		{#if data.upcomingEvents.length === 0}
			<Card padding="md">
				<p class="text-[14px] font-medium text-ink">Aucun événement programmé</p>
				<p class="mt-0.5 text-[13px] text-muted">
					Les prochains événements du lycée s’afficheront ici dès leur publication.
				</p>
			</Card>
		{:else}
			<div class="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
				{#each data.upcomingEvents as ev, i (ev.id)}
					{@const cal = calendarMonthDay(ev.eventDate)}
					<Card
						hover
						animate
						stagger={i + 1}
						padding="none"
						as="article"
						class="flex w-[84vw] max-w-[330px] shrink-0 snap-start flex-col justify-between p-4 sm:w-auto sm:max-w-none"
					>
						<div class="space-y-3">
							<div class="flex items-start gap-3">
								<div class="flex w-11 shrink-0 flex-col items-center justify-center rounded-[11px] bg-surface-2 py-1.5">
									<span class="text-[10px] font-semibold uppercase tracking-[0.04em] text-brand-ink">
										{cal.month}
									</span>
									<span class="tabular-nums text-[19px] font-semibold leading-tight text-ink">
										{cal.day}
									</span>
								</div>
								<div class="min-w-0 flex-1">
									<h3 class="truncate text-[16px] font-semibold tracking-[-0.015em] text-ink">
										{ev.title}
									</h3>
									<p class="mt-0.5 text-[12px] text-muted">
										{formatDateTimeFr(ev.eventDate)}
									</p>
									<p class="truncate text-[12px] text-muted">{ev.location}</p>
								</div>
							</div>

							{#if ev.description}
								<p class="line-clamp-2 text-[13px] leading-relaxed text-muted">
									{ev.description}
								</p>
							{/if}

							{#if ev.capacity > 0}
								<div class="space-y-1">
									<div class="flex items-center justify-between text-[11px] text-muted">
										<span>
											{#if ev.remainingSeats === 0}
												Complet
											{:else if ev.remainingSeats === 1}
												1 place restante
											{:else}
												{ev.remainingSeats} places restantes
											{/if}
										</span>
										<span class="tabular-nums">{ev.capacity} max</span>
									</div>
									<div class="h-1 w-full overflow-hidden rounded-full bg-surface-2">
										<div
											class={`h-full rounded-full transition-[width] duration-300 ease-out ${
												ev.remainingSeats === 0 ? 'bg-[#dc2626]' : 'bg-ink/80'
											}`}
											style={`width: ${Math.round(soldRatio(ev) * 100)}%`}
										></div>
									</div>
								</div>
							{/if}
						</div>

						<div class="mt-4 flex items-center justify-between border-t border-border pt-3">
							<span class="tabular-nums text-[14px] font-semibold text-ink">
								{minPriceLabel(ev)}
							</span>
							<Button
								href={`/billetterie?event=${ev.id}`}
								size="sm"
								variant={ev.remainingSeats === 0 ? 'secondary' : 'primary'}
							>
								{ev.remainingSeats === 0 ? 'Détails' : 'Réserver'}
							</Button>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Sondages ouverts en liste groupée iOS -->
	<section aria-labelledby="polls-heading" class="space-y-3">
		<div class="flex items-baseline justify-between gap-3">
			<h2 id="polls-heading" class="text-[18px] sm:text-[20px] font-semibold tracking-[-0.02em] text-ink">
				Sondages ouverts
			</h2>
			<a
				href="/sondages"
				class="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand-ink hover:underline"
			>
				Tous
				<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
				</svg>
			</a>
		</div>

		{#if data.openPolls.length === 0}
			<Card padding="md">
				<p class="text-[14px] font-medium text-ink">Aucun sondage ouvert</p>
				<p class="mt-0.5 text-[13px] text-muted">
					Les consultations lycéennes apparaîtront ici dès leur ouverture.
				</p>
			</Card>
		{:else}
			<div class="ios-group divide-y divide-border">
				{#each data.openPolls as poll (poll.id)}
					<a href="/sondages" class="ios-row ios-row-interactive">
						<div class="min-w-0 flex-1 space-y-0.5 py-0.5">
							<div class="flex items-center gap-2">
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34C759]" aria-hidden="true"></span>
								<p class="truncate text-[15px] font-medium text-ink">{poll.title}</p>
							</div>
							<p class="truncate text-[12px] text-muted">
								<span class="tabular-nums">{poll.votesCount} {poll.votesCount <= 1 ? 'vote' : 'votes'}</span>
								{#if poll.closesAt}
									· Clôture {formatDateFr(poll.closesAt)}
								{:else}
									· {poll.multipleChoice ? 'Choix multiple' : 'Choix unique'}
								{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span class="text-[13px] font-medium text-brand-ink">Voter</span>
							<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
							</svg>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Mention confidentialité discrète -->
	<div class="border-t border-border pt-4">
		<a
			href="/confidentialite"
			class="flex items-center justify-between gap-3 rounded-xl py-1 text-[13px] text-muted transition hover:text-ink"
		>
			<span>Protection des données lycéens (RGPD), auto-hébergé sans traceurs</span>
			<svg class="size-4 shrink-0 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
			</svg>
		</a>
	</div>
</div>
