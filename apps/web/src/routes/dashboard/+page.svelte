<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, daysUntil, formatDateFr, formatDateTimeFr, formatEuros } from '$shared/format';
	import { getRoleLabel } from '$shared/permissions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let pushSupported = $state(false);
	let pushConfigured = $state(true);
	let pushSubscribed = $state(false);
	let pushLoading = $state(false);
	let pushPermission = $state<NotificationPermission>('default');

	const user = $derived(data.user!);
	const roleLabel = $derived(getRoleLabel(user.role, user.customTitle));
	const initials = $derived(
		`${user.firstName.trim().charAt(0)}${user.lastName.trim().charAt(0)}`.toUpperCase() || 'M'
	);

	function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const buffer = new ArrayBuffer(rawData.length);
		const outputArray = new Uint8Array(buffer);
		for (let i = 0; i < rawData.length; i += 1) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	onMount(async () => {
		if (
			typeof window === 'undefined' ||
			!('serviceWorker' in navigator) ||
			!('PushManager' in window) ||
			!('Notification' in window)
		) {
			pushSupported = false;
			return;
		}

		pushSupported = true;
		pushPermission = Notification.permission;

		try {
			const [configRes, reg] = await Promise.all([
				fetch('/api/notifications/push'),
				navigator.serviceWorker.getRegistration()
			]);
			if (configRes.ok) {
				const cfg = (await configRes.json()) as { configured?: boolean };
				pushConfigured = Boolean(cfg.configured);
			}
			if (reg) {
				const sub = await reg.pushManager.getSubscription();
				pushSubscribed = Boolean(sub);
			}
		} catch {
			// Ignorer si hors ligne ou service worker non actif
		}
	});

	async function togglePushNotifications() {
		if (!pushSupported || pushLoading) return;
		pushLoading = true;

		try {
			let registration = await navigator.serviceWorker.getRegistration();
			if (!registration) {
				registration = await navigator.serviceWorker.register('/service-worker.js');
			}
			await navigator.serviceWorker.ready;

			const existingSub = await registration.pushManager.getSubscription();
			if (existingSub) {
				const res = await fetch('/api/notifications/push', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: existingSub.endpoint })
				});
				await existingSub.unsubscribe();
				if (res.ok) {
					pushSubscribed = false;
					toast.info('Notifications désactivées', 'Vous ne recevrez plus d’alertes Push sur cet appareil.');
				} else {
					toast.warning('Désinscription locale', 'L’abonnement local a été supprimé.');
					pushSubscribed = false;
				}
				return;
			}

			const keyRes = await fetch('/api/notifications/push');
			if (!keyRes.ok) {
				throw new Error('Impossible de récupérer la configuration VAPID.');
			}
			const keyJson = (await keyRes.json()) as {
				ok: boolean;
				publicKey: string | null;
				configured: boolean;
			};

			pushConfigured = Boolean(keyJson.configured && keyJson.publicKey);
			if (!keyJson.configured || !keyJson.publicKey) {
				toast.warning(
					'Clés VAPID non configurées',
					'L’administrateur doit définir les clés Web Push sur le serveur.'
				);
				return;
			}

			const permission = await Notification.requestPermission();
			pushPermission = permission;
			if (permission !== 'granted') {
				toast.warning(
					'Permission refusée',
					'Autorisez les notifications dans les réglages de votre navigateur.'
				);
				return;
			}

			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey)
			});

			const subJson = subscription.toJSON();
			if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
				throw new Error('Abonnement Push incomplet renvoyé par le navigateur.');
			}

			const saveRes = await fetch('/api/notifications/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					endpoint: subJson.endpoint,
					keys: {
						p256dh: subJson.keys.p256dh,
						auth: subJson.keys.auth
					}
				})
			});

			if (!saveRes.ok) {
				const errBody = await saveRes.json().catch(() => ({}));
				throw new Error(
					(errBody as { message?: string }).message || 'Échec de l’enregistrement Push.'
				);
			}

			pushSubscribed = true;
			toast.success(
				'Notifications Push activées',
				'Vous recevrez les rappels d’AG, tâches urgentes et ouvertures de votes.'
			);
		} catch (err) {
			toast.error(
				'Activation Push impossible',
				err instanceof Error ? err.message : 'Erreur navigateur ou Service Worker.'
			);
		} finally {
			pushLoading = false;
		}
	}

	const alertDotClass: Record<'info' | 'warning' | 'danger', string> = {
		info: 'bg-brand',
		warning: 'bg-[#FF9F0A]',
		danger: 'bg-[#FF3B30]'
	};

	const projectStatusBadge: Record<string, { label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' }> = {
		brouillon: { label: 'Brouillon', variant: 'neutral' },
		en_cours: { label: 'En cours', variant: 'brand' },
		valide: { label: 'Validé', variant: 'success' },
		termine: { label: 'Terminé', variant: 'success' },
		archive: { label: 'Archivé', variant: 'neutral' }
	};

	const agStatusBadge: Record<string, { label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' }> = {
		brouillon: { label: 'Préparation', variant: 'neutral' },
		candidatures: { label: 'Candidatures', variant: 'warning' },
		vote_ouvert: { label: 'Vote ouvert', variant: 'success' },
		cloturee: { label: 'Clôturée', variant: 'neutral' }
	};
</script>

<svelte:head>
	<title>Mon espace · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 space-y-6 sm:space-y-7">
	<!-- En-tête épuré style Apple Reminders / Linear -->
	<section class="animate-spring flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div class="space-y-1">
			<p class="text-[12px] font-medium text-muted">
				{data.settings.mdlName} · {data.settings.schoolYear}
			</p>
			<h1 class="text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-[1.1] text-ink">
				Bonjour {user.firstName}
			</h1>
			<p class="text-[13px] text-muted">
				{roleLabel}{#if user.classe} · {user.classe}{/if}{#if user.isAdherent} · Adhérent{/if}
			</p>
		</div>

		<div class="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
			{#if pushSupported}
				<Button
					variant={pushSubscribed ? 'secondary' : 'ghost'}
					size="sm"
					loading={pushLoading}
					disabled={!pushConfigured && !pushSubscribed}
					onclick={togglePushNotifications}
					aria-pressed={pushSubscribed}
					class="shrink-0"
				>
					{#if pushSubscribed}
						Alertes activées
					{:else if !pushConfigured}
						Alertes indisponibles
					{:else}
						Activer les alertes
					{/if}
				</Button>
			{/if}
			{#if data.permissions.canCreateProjects}
				<Button href="/projets?new=1" variant="primary" size="sm" class="shrink-0">
					Nouveau projet
				</Button>
			{/if}
			{#if data.permissions.canScanTickets}
				<Button href="/billetterie?tab=scanner" variant="secondary" size="sm" class="shrink-0">
					Scanner billets
				</Button>
			{/if}
		</div>
	</section>

	<!-- Un seul groupe consolidé À suivre (zéro empilement de bannières pastel) -->
	{#if data.alerts.length > 0}
		<section aria-labelledby="alerts-heading" class="space-y-2">
			<div class="flex items-center justify-between px-1">
				<h2 id="alerts-heading" class="text-[13px] font-medium text-muted">
					À suivre
				</h2>
				<span class="tabular-nums text-[12px] text-muted">
					{data.alerts.length}
				</span>
			</div>
			<div class="ios-group divide-y divide-border">
				{#each data.alerts as alert (alert.id)}
					<a href={alert.href} class="ios-row ios-row-interactive">
						<div class="flex min-w-0 flex-1 items-start gap-3 py-0.5">
							<span
								class={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${alertDotClass[alert.severity]}`}
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-[14px] font-medium text-ink">{alert.title}</p>
								<p class="line-clamp-1 text-[12px] text-muted">{alert.description}</p>
							</div>
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							<span class="text-[13px] font-medium text-brand-ink">{alert.ctaLabel}</span>
							<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
							</svg>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- KPIs 2x2 sobres avec séparateurs hairline -->
	<section aria-label="Indicateurs clés" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#if data.permissions.canReadProjects}
			<a href="/projets" class="block">
				<Card hover padding="sm" class="h-full space-y-1.5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-[12px] font-medium text-muted">Projets actifs</span>
						{#if data.kpis.pendingTasksCount > 0}
							<Badge variant="neutral" size="sm">{data.kpis.pendingTasksCount} tâches</Badge>
						{/if}
					</div>
					<p class="tabular-nums text-[26px] font-semibold tracking-[-0.02em] text-ink">
						{data.kpis.activeProjectsCount}
					</p>
					<p class="text-[12px] text-muted">Suivi des tâches</p>
				</Card>
			</a>
		{/if}

		{#if data.kpis.budget}
			<a href="/budget" class="block">
				<Card hover padding="sm" class="h-full space-y-1.5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-[12px] font-medium text-muted">Trésorerie</span>
						{#if data.kpis.budget.unvalidatedCount > 0}
							<Badge variant="warning" size="sm">{data.kpis.budget.unvalidatedCount} à valider</Badge>
						{/if}
					</div>
					<p
						class={`tabular-nums text-[24px] sm:text-[26px] font-semibold tracking-[-0.02em] ${
							data.kpis.budget.soldeCents >= 0 ? 'text-ink' : 'text-[#FF3B30]'
						}`}
					>
						{formatEuros(data.kpis.budget.soldeCents)}
					</p>
					<p class="text-[12px] text-muted">Solde actuel</p>
				</Card>
			</a>
		{/if}

		{#if data.permissions.canReadAg}
			<a href="/ag" class="block">
				<Card hover padding="sm" class="h-full space-y-1.5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-[12px] font-medium text-muted">Votes & AG</span>
						{#if data.kpis.unvotedPollsCount > 0}
							<Badge variant="brand" size="sm">{data.kpis.unvotedPollsCount} à voter</Badge>
						{/if}
					</div>
					<p class="tabular-nums text-[26px] font-semibold tracking-[-0.02em] text-ink">
						{data.kpis.openAssembliesCount + data.kpis.openPollsCount}
					</p>
					<p class="text-[12px] text-muted">
						{data.kpis.openAssembliesCount} AG · {data.kpis.openPollsCount} sondages
					</p>
				</Card>
			</a>
		{:else if data.permissions.canReadPolls}
			<a href="/sondages" class="block">
				<Card hover padding="sm" class="h-full space-y-1.5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-[12px] font-medium text-muted">Sondages</span>
						{#if data.kpis.unvotedPollsCount > 0}
							<Badge variant="brand" size="sm">{data.kpis.unvotedPollsCount} à voter</Badge>
						{/if}
					</div>
					<p class="tabular-nums text-[26px] font-semibold tracking-[-0.02em] text-ink">
						{data.kpis.openPollsCount}
					</p>
					<p class="text-[12px] text-muted">Consultations ouvertes</p>
				</Card>
			</a>
		{/if}

		<a href="/billetterie" class="block">
			<Card hover padding="sm" class="h-full space-y-1.5">
				<span class="text-[12px] font-medium text-muted">Billetterie</span>
				<p class="tabular-nums text-[26px] font-semibold tracking-[-0.02em] text-ink">
					{data.kpis.upcomingEventsCount}
				</p>
				<p class="truncate text-[12px] text-muted">
					{#if data.kpis.pendingAdhesionsCount !== null}
						{data.kpis.pendingAdhesionsCount} adhésions en attente
					{:else}
						Événements à venir
					{/if}
				</p>
			</Card>
		</a>
	</section>

	<!-- Grille principale en listes groupées iOS -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		{#if data.permissions.canReadProjects}
			<section class="space-y-2">
				<div class="flex items-baseline justify-between px-1">
					<h2 class="text-[16px] font-semibold tracking-[-0.015em] text-ink">Projets en cours</h2>
					<a href="/projets" class="text-[13px] font-medium text-brand-ink hover:underline">Tout voir</a>
				</div>
				{#if data.activeProjects.length === 0}
					<Card padding="md">
						<p class="text-[14px] text-muted">Aucun projet actif pour le moment.</p>
						{#if data.permissions.canCreateProjects}
							<Button href="/projets" variant="secondary" size="sm" class="mt-3">
								Créer un projet
							</Button>
						{/if}
					</Card>
				{:else}
					<div class="ios-group divide-y divide-border">
						{#each data.activeProjects as project (project.id)}
							{@const badge = projectStatusBadge[project.status] ?? { label: project.status, variant: 'neutral' }}
							<a href={`/projets/${project.id}`} class="ios-row ios-row-interactive">
								<div class="min-w-0 flex-1 py-0.5">
									<div class="flex items-center gap-2">
										<span class="truncate text-[14px] font-medium text-ink">{project.title}</span>
										<Badge variant={badge.variant} size="sm">{badge.label}</Badge>
									</div>
									<p class="mt-0.5 truncate text-[12px] text-muted">
										{project.category} · {formatEuros(project.budgetPlannedCents)}
										{#if project.eventDate} · {formatDateFr(project.eventDate)}{/if}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-1.5">
									{#if project.eventDate}
										<span class="tabular-nums text-[12px] text-muted">{countdownLabel(project.eventDate)}</span>
									{/if}
									<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
									</svg>
								</div>
							</a>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<!-- Votes AG & Consultations -->
		<section class="space-y-2">
			<div class="flex items-baseline justify-between px-1">
				<h2 class="text-[16px] font-semibold tracking-[-0.015em] text-ink">Votes & Consultations</h2>
				<div class="flex items-center gap-3 text-[13px] font-medium">
					{#if data.permissions.canReadAg}
						<a href="/ag" class="text-brand-ink hover:underline">AG</a>
					{/if}
					{#if data.permissions.canReadPolls}
						<a href="/sondages" class="text-brand-ink hover:underline">Sondages</a>
					{/if}
				</div>
			</div>

			{#if (!data.permissions.canReadAg || data.assemblies.length === 0) && (!data.permissions.canReadPolls || data.openPolls.length === 0)}
				<Card padding="md">
					<p class="text-[14px] text-muted">Aucun scrutin ou sondage ouvert actuellement.</p>
				</Card>
			{:else}
				<div class="ios-group divide-y divide-border">
					{#if data.permissions.canReadAg}
						{#each data.assemblies as ag (ag.id)}
							{@const st = agStatusBadge[ag.status] ?? { label: ag.status, variant: 'neutral' }}
							<a href="/ag" class="ios-row ios-row-interactive">
								<div class="min-w-0 flex-1 py-0.5">
									<div class="flex items-center gap-2">
										<span class="truncate text-[14px] font-medium text-ink">{ag.title}</span>
										<Badge variant={st.variant} size="sm">{st.label}</Badge>
									</div>
									<p class="mt-0.5 truncate text-[12px] text-muted">
										AG · {formatDateTimeFr(ag.scheduledAt)} · {ag.location}
									</p>
								</div>
								<svg class="size-4 shrink-0 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
								</svg>
							</a>
						{/each}
					{/if}

					{#if data.permissions.canReadPolls}
						{#each data.openPolls as poll (poll.id)}
							<a href="/sondages" class="ios-row ios-row-interactive">
								<div class="min-w-0 flex-1 py-0.5">
									<p class="truncate text-[14px] font-medium text-ink">{poll.title}</p>
									<p class="mt-0.5 truncate text-[12px] text-muted">
										{poll.closesAt ? `Clôture ${formatDateFr(poll.closesAt)}` : 'Sondage ouvert'}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-1.5">
									<Badge variant={poll.hasVoted ? 'success' : 'brand'} size="sm">
										{poll.hasVoted ? 'Voté' : 'À voter'}
									</Badge>
									<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
									</svg>
								</div>
							</a>
						{/each}
					{/if}
				</div>
			{/if}
		</section>

		<!-- Événements à venir -->
		<section class="space-y-2">
			<div class="flex items-baseline justify-between px-1">
				<h2 class="text-[16px] font-semibold tracking-[-0.015em] text-ink">Événements à venir</h2>
				<a href="/billetterie" class="text-[13px] font-medium text-brand-ink hover:underline">Billetterie</a>
			</div>

			{#if data.upcomingEvents.length === 0}
				<Card padding="md">
					<p class="text-[14px] text-muted">Aucun événement programmé prochainement.</p>
				</Card>
			{:else}
				<div class="ios-group divide-y divide-border">
					{#each data.upcomingEvents as ev (ev.id)}
						<a href={`/billetterie?event=${ev.id}`} class="ios-row ios-row-interactive">
							<div class="min-w-0 flex-1 py-0.5">
								<p class="truncate text-[14px] font-medium text-ink">{ev.title}</p>
								<p class="mt-0.5 truncate text-[12px] text-muted">
									{formatDateTimeFr(ev.eventDate)} · {ev.location}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-1.5">
								<span class="tabular-nums text-[12px] font-medium text-muted">
									{ev.remainingSeats} place{ev.remainingSeats > 1 ? 's' : ''}
								</span>
								<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
								</svg>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Échéances & Raccourcis -->
		<section class="space-y-2">
			<div class="flex items-baseline justify-between px-1">
				<h2 class="text-[16px] font-semibold tracking-[-0.015em] text-ink">
					{data.dueTasks.length > 0 ? 'Échéances & Raccourcis' : 'Raccourcis'}
				</h2>
			</div>

			{#if data.dueTasks.length > 0}
				<div class="ios-group divide-y divide-border">
					{#each data.dueTasks as task (task.id)}
						{@const d = daysUntil(task.dueDate)}
						<a href={`/projets/${task.projectId}`} class="ios-row ios-row-interactive">
							<div class="min-w-0 flex-1 py-0.5">
								<p class="truncate text-[14px] font-medium text-ink">{task.title}</p>
								<p class="truncate text-[12px] text-muted">{task.projectTitle}</p>
							</div>
							<Badge variant={d !== null && d < 0 ? 'danger' : 'warning'} size="sm">
								{countdownLabel(task.dueDate)}
							</Badge>
						</a>
					{/each}
				</div>
			{/if}

			<div class="ios-group divide-y divide-border">
				{#if data.permissions.canReadProjects}
					<a href="/projets" class="ios-row ios-row-interactive">
						<span class="text-[14px] text-ink">Projets & Tâches</span>
						<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
					</a>
				{/if}
				{#if data.permissions.canReadBudget}
					<a href="/budget" class="ios-row ios-row-interactive">
						<span class="text-[14px] text-ink">Trésorerie & justificatifs</span>
						<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
					</a>
				{/if}
				{#if data.permissions.canReadAg}
					<a href="/ag" class="ios-row ios-row-interactive">
						<span class="text-[14px] text-ink">Assemblée Générale</span>
						<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
					</a>
				{/if}
				{#if data.permissions.canReadPassation}
					<a href="/passation" class="ios-row ios-row-interactive">
						<span class="text-[14px] text-ink">Passation & coffre</span>
						<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
					</a>
				{/if}
				<a href="/parcoursup" class="ios-row ios-row-interactive">
					<span class="text-[14px] text-ink">Attestation Parcoursup</span>
					<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
				</a>
				<a href="/confidentialite" class="ios-row ios-row-interactive">
					<span class="text-[14px] text-ink">Mes données RGPD</span>
					<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
				</a>
			</div>
		</section>
	</div>
</div>
