<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	type PollScope = 'bureau' | 'adherents' | 'lycee';

	interface PollItem {
		id: number;
		title: string;
		description: string;
		scope: PollScope;
		options: string[];
		isOpen: boolean;
		multipleChoice: boolean;
		closesAt: string | null;
		createdAt: string;
		counts: number[];
		totalVotes: number;
		hasVoted: boolean;
	}

	interface PollTallyEvent {
		pollId: number;
		counts: number[];
		totalVotes: number;
	}

	let { data }: { data: PageData } = $props();

	const canReadPolls = $derived(
		data.user ? hasPermission(data.user.role, 'polls:read') : false
	);
	const canVotePolls = $derived(
		data.user ? hasPermission(data.user.role, 'polls:vote') : false
	);
	const canCreatePolls = $derived(
		data.user ? hasPermission(data.user.role, 'polls:create') : false
	);

	let loading = $state(true);
	let loadError = $state('');
	let pollsList = $state<PollItem[]>([]);
	let scopeFilter = $state<'all' | PollScope>('all');
	let statusFilter = $state<'all' | 'open' | 'closed'>('all');

	// Sélection d'options par sondage (pour voter)
	let selections = $state<Record<number, number[]>>({});
	let votingPollId = $state<number | null>(null);

	// Création rapide en 30s
	let createOpen = $state(false);
	let creating = $state(false);
	let createError = $state('');
	let newTitle = $state('');
	let newDescription = $state('');
	let newScope = $state<PollScope>('lycee');
	let newMultipleChoice = $state(false);
	let newClosesAt = $state('');
	let newOptions = $state<string[]>(['', '']);

	// Partage + QR SVG
	let shareModalOpen = $state(false);
	let sharePoll = $state<PollItem | null>(null);
	let shareQrSvg = $state('');
	let shareQrLoading = $state(false);
	let copiedShareUrl = $state(false);

	// Flux temps réel SSE
	let liveConnectedCount = $state(0);

	const highlightedPollId = $derived.by(() => {
		const raw = page.url.searchParams.get('poll');
		const n = raw ? Number.parseInt(raw, 10) : NaN;
		return Number.isFinite(n) && n > 0 ? n : null;
	});

	const scopeLabels: Record<PollScope, string> = {
		lycee: 'Tout le lycée',
		adherents: 'Adhérents MDL',
		bureau: 'Bureau uniquement'
	};

	const scopeBadgeVariant: Record<PollScope, 'brand' | 'success' | 'warning'> = {
		lycee: 'brand',
		adherents: 'success',
		bureau: 'warning'
	};

	function isPollClosed(poll: PollItem): boolean {
		if (!poll.isOpen) return true;
		if (poll.closesAt && new Date(poll.closesAt).getTime() < Date.now()) return true;
		return false;
	}

	const filteredPolls = $derived.by(() => {
		return pollsList.filter((poll) => {
			if (scopeFilter !== 'all' && poll.scope !== scopeFilter) return false;
			const closed = isPollClosed(poll);
			if (statusFilter === 'open' && closed) return false;
			if (statusFilter === 'closed' && !closed) return false;
			return true;
		});
	});

	const shareUrl = $derived.by(() => {
		if (!sharePoll || typeof window === 'undefined') return '';
		return `${window.location.origin}/sondages?poll=${sharePoll.id}`;
	});

	async function fetchPolls() {
		if (!data.user || !canReadPolls) {
			loading = false;
			return;
		}
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/polls');
			const payload = (await res.json().catch(() => ({}))) as {
				polls?: PollItem[];
				error?: string;
				message?: string;
			};
			if (!res.ok) {
				loadError = payload.error || payload.message || 'Impossible de charger les sondages.';
				return;
			}
			pollsList = payload.polls ?? [];
		} catch {
			loadError = 'Erreur réseau lors du chargement des sondages.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchPolls();
	});

	const openPollIdsKey = $derived(
		pollsList
			.filter((p) => !isPollClosed(p))
			.map((p) => p.id)
			.join(',')
	);

	// Abonnement EventSource temps réel pour tous les sondages ouverts visibles
	$effect(() => {
		if (typeof window === 'undefined' || !canReadPolls || !openPollIdsKey) {
			liveConnectedCount = 0;
			return;
		}

		const openIds = openPollIdsKey
			.split(',')
			.map((s) => Number.parseInt(s, 10))
			.filter((n) => Number.isFinite(n) && n > 0);

		const sources: EventSource[] = [];
		const openSet = new Set<number>();

		for (const pollId of openIds) {
			const es = new EventSource(`/api/polls/${pollId}/stream`);
			es.addEventListener('open', () => {
				openSet.add(pollId);
				liveConnectedCount = openSet.size;
			});
			es.addEventListener('results', (ev: MessageEvent) => {
				try {
					const tally = JSON.parse(ev.data) as PollTallyEvent;
					pollsList = pollsList.map((p) =>
						p.id === tally.pollId
							? { ...p, counts: tally.counts, totalVotes: tally.totalVotes }
							: p
					);
				} catch {
					// Ignorer trame malformée
				}
			});
			es.addEventListener('error', () => {
				if (es.readyState === EventSource.CLOSED) {
					openSet.delete(pollId);
					liveConnectedCount = openSet.size;
				}
			});
			sources.push(es);
		}

		return () => {
			for (const es of sources) {
				es.close();
			}
			liveConnectedCount = 0;
		};
	});

	function toggleOption(poll: PollItem, index: number) {
		if (poll.hasVoted || isPollClosed(poll) || !canVotePolls) return;
		const current = selections[poll.id] ?? [];
		if (poll.multipleChoice) {
			const next = current.includes(index)
				? current.filter((i) => i !== index)
				: [...current, index];
			selections = { ...selections, [poll.id]: next };
		} else {
			selections = { ...selections, [poll.id]: [index] };
		}
	}

	async function submitVote(poll: PollItem) {
		const chosen = selections[poll.id] ?? [];
		if (chosen.length === 0) {
			toast.warning('Sélection requise', 'Choisis au moins une option avant de voter.');
			return;
		}
		if (votingPollId !== null) return;

		// État optimiste
		const prevSnapshot = pollsList;
		votingPollId = poll.id;
		pollsList = pollsList.map((p) => {
			if (p.id !== poll.id) return p;
			const nextCounts = [...p.counts];
			for (const idx of chosen) {
				if (idx >= 0 && idx < nextCounts.length) {
					nextCounts[idx] = (nextCounts[idx] ?? 0) + 1;
				}
			}
			return {
				...p,
				hasVoted: true,
				counts: nextCounts,
				totalVotes: p.totalVotes + 1
			};
		});

		try {
			const res = await fetch(`/api/polls/${poll.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ optionIndexes: chosen })
			});
			const payload = (await res.json().catch(() => ({}))) as {
				recorded?: boolean;
				tally?: PollTallyEvent;
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				pollsList = prevSnapshot;
				toast.error('Vote non enregistré', payload.error || payload.message || 'Une erreur est survenue.');
				return;
			}

			if (payload.tally) {
				const tally = payload.tally;
				pollsList = pollsList.map((p) =>
					p.id === poll.id
						? { ...p, hasVoted: true, counts: tally.counts, totalVotes: tally.totalVotes }
						: p
				);
			}
			toast.success('Vote enregistré !', 'Merci pour ta participation.');
		} catch {
			pollsList = prevSnapshot;
			toast.error('Erreur réseau', 'Impossible d’envoyer ton vote pour le moment.');
		} finally {
			votingPollId = null;
		}
	}

	function resetCreateForm() {
		newTitle = '';
		newDescription = '';
		newScope = 'lycee';
		newMultipleChoice = false;
		newClosesAt = '';
		newOptions = ['', ''];
		createError = '';
	}

	function addOptionField() {
		if (newOptions.length >= 10) return;
		newOptions = [...newOptions, ''];
	}

	function removeOptionField(idx: number) {
		if (newOptions.length <= 2) return;
		newOptions = newOptions.filter((_, i) => i !== idx);
	}

	async function handleCreatePoll(event: SubmitEvent) {
		event.preventDefault();
		createError = '';

		const cleanTitle = newTitle.trim();
		const cleanOptions = newOptions.map((o) => o.trim()).filter(Boolean);

		if (cleanTitle.length < 3) {
			createError = 'Le titre doit contenir au moins 3 caractères.';
			return;
		}
		if (cleanOptions.length < 2) {
			createError = 'Ajoute au moins 2 options de réponse non vides.';
			return;
		}

		creating = true;
		try {
			const res = await fetch('/api/polls', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: cleanTitle,
					description: newDescription.trim(),
					scope: newScope,
					options: cleanOptions,
					multipleChoice: newMultipleChoice,
					closesAt: newClosesAt ? new Date(newClosesAt).toISOString() : undefined
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				poll?: PollItem;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.poll) {
				createError = payload.error || payload.message || 'Impossible de créer le sondage.';
				return;
			}

			pollsList = [payload.poll, ...pollsList];
			createOpen = false;
			resetCreateForm();
			toast.success('Sondage publié', 'Il est immédiatement accessible aux électeurs ciblés.');
		} catch {
			createError = 'Impossible de joindre le serveur.';
		} finally {
			creating = false;
		}
	}

	async function openShareModal(poll: PollItem) {
		sharePoll = poll;
		shareModalOpen = true;
		copiedShareUrl = false;
		shareQrSvg = '';
		shareQrLoading = true;

		try {
			const url = `${window.location.origin}/sondages?poll=${poll.id}`;
			const { default: QRCode } = await import('qrcode');
			shareQrSvg = await QRCode.toString(url, {
				type: 'svg',
				margin: 1,
				width: 220,
				color: { dark: '#0f172a', light: '#ffffff' }
			});
		} catch {
			shareQrSvg = '';
		} finally {
			shareQrLoading = false;
		}
	}

	async function copyShareLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			copiedShareUrl = true;
			toast.success('Lien copié', 'Tu peux le coller sur Pronote, Instagram ou Discord.');
		} catch {
			toast.error('Copie impossible', 'Copie manuellement le lien affiché.');
		}
	}

	function downloadShareQr() {
		if (!shareQrSvg || !sharePoll) return;
		const blob = new Blob([shareQrSvg], { type: 'image/svg+xml;charset=utf-8' });
		const objectUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = objectUrl;
		a.download = `sondage-${sharePoll.id}-qr.svg`;
		a.click();
		URL.revokeObjectURL(objectUrl);
	}

	function optionPercent(poll: PollItem, index: number): number {
		const count = poll.counts[index] ?? 0;
		const sum = poll.counts.reduce((acc, c) => acc + c, 0);
		if (sum <= 0) return 0;
		return Math.round((count / sum) * 100);
	}
</script>

<svelte:head>
	<title>Sondages · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
					Sondages & consultations
				</h1>
				{#if liveConnectedCount > 0}
					<Badge variant="success" dot>
						Temps réel actif
					</Badge>
				{/if}
			</div>
			<p class="mt-1.5 text-sm text-muted">
				Votes anonymisés (empreinte HMAC), résultats mis à jour en direct sans recharger la page.
			</p>
		</div>

		{#if canCreatePolls}
			<Button
				variant="primary"
				onclick={() => {
					resetCreateForm();
					createOpen = true;
				}}
			>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" d="M12 5v14M5 12h14" />
				</svg>
				Créer en 30 s
			</Button>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connecte-toi pour voter aux sondages</h2>
			<p class="mx-auto max-w-md text-sm text-muted">
				Pour garantir un vote unique et anonymisé par élève, la connexion à ton compte {data.settings.mdlName} est requise.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<Button href="/connexion?redirect=/sondages" variant="primary">Se connecter</Button>
				<Button href="/inscription" variant="secondary">Créer un compte</Button>
			</div>
		</Card>
	{:else if !canReadPolls}
		<Card padding="lg" class="text-center">
			<p class="text-base font-semibold text-ink">Accès aux sondages non autorisé pour ce rôle.</p>
		</Card>
	{:else}
		<!-- Filtres rapides façon contrôles segmentés Apple -->
		<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
			<div
				class="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-2 p-0.5 sm:inline-flex"
				role="group"
				aria-label="Filtrer par portée"
			>
				{#each [
					{ value: 'all', label: 'Toutes' },
					{ value: 'lycee', label: 'Lycée' },
					{ value: 'adherents', label: 'Adhérents' },
					{ value: 'bureau', label: 'Bureau' }
				] as item (item.value)}
					<button
						type="button"
						onclick={() => (scopeFilter = item.value as typeof scopeFilter)}
						aria-pressed={scopeFilter === item.value}
						class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-3.5 py-1.5 text-xs font-semibold transition ${
							scopeFilter === item.value
								? 'bg-card text-ink apple-shadow-card'
								: 'text-muted hover:text-ink'
						}`}
					>
						{item.label}
					</button>
				{/each}
			</div>

			<div
				class="inline-flex self-start rounded-[10px] bg-surface-2 p-0.5"
				role="group"
				aria-label="Filtrer par statut"
			>
				{#each [
					{ value: 'all', label: 'Tous' },
					{ value: 'open', label: 'Ouverts' },
					{ value: 'closed', label: 'Clos' }
				] as st (st.value)}
					<button
						type="button"
						onclick={() => (statusFilter = st.value as typeof statusFilter)}
						aria-pressed={statusFilter === st.value}
						class={`gpu-press min-h-9 cursor-pointer rounded-[8px] px-3.5 py-1.5 text-xs font-semibold transition ${
							statusFilter === st.value
								? 'bg-card text-ink apple-shadow-card'
								: 'text-muted hover:text-ink'
						}`}
					>
						{st.label}
					</button>
				{/each}
			</div>
		</div>

		{#if loading}
			<div class="grid gap-4 md:grid-cols-2">
				<Skeleton variant="card" height="220px" />
				<Skeleton variant="card" height="220px" />
			</div>
		{:else if loadError}
			<Card class="border-red-500/30 bg-red-500/5 space-y-3">
				<p class="text-sm font-semibold text-red-700 dark:text-red-300">{loadError}</p>
				<Button size="sm" variant="secondary" onclick={fetchPolls}>Réessayer</Button>
			</Card>
		{:else if filteredPolls.length === 0}
			<Card padding="lg" class="text-center space-y-2">
				<p class="text-base font-bold text-ink">Aucun sondage à afficher</p>
				<p class="text-sm text-muted">
					Modifie les filtres ou reviens dès qu'une nouvelle consultation est publiée.
				</p>
			</Card>
		{:else}
			<div class="grid gap-5 md:grid-cols-2">
				{#each filteredPolls as poll (poll.id)}
					{@const closed = isPollClosed(poll)}
					{@const selected = selections[poll.id] ?? []}
					{@const showResults = poll.hasVoted || closed}
					{@const isHighlighted = highlightedPollId === poll.id}

					<Card
						as="article"
						class={`flex flex-col justify-between gap-4 ${
							isHighlighted ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''
						}`}
					>
						<div class="space-y-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="flex flex-wrap items-center gap-1.5">
									<Badge variant={scopeBadgeVariant[poll.scope]}>
										{scopeLabels[poll.scope]}
									</Badge>
									{#if closed}
										<Badge variant="neutral">Clos</Badge>
									{:else}
										<Badge variant="success" dot>Ouvert</Badge>
									{/if}
									{#if poll.multipleChoice}
										<Badge variant="neutral">Choix multiple</Badge>
									{/if}
								</div>

								<button
									type="button"
									onclick={() => openShareModal(poll)}
									class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-brand/40"
									aria-label={`Partager le sondage ${poll.title}`}
								>
									<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4m4-4v13" />
									</svg>
									Partager
								</button>
							</div>

							<div>
								<h2 class="text-lg font-bold leading-snug text-ink">{poll.title}</h2>
								{#if poll.description}
									<p class="mt-1 text-sm leading-relaxed text-muted">{poll.description}</p>
								{/if}
							</div>

							<!-- Options de vote / Résultats temps réel -->
							<div class="space-y-2.5" aria-live="polite">
								{#each poll.options as optionLabel, idx (idx)}
									{@const pct = optionPercent(poll, idx)}
									{@const votes = poll.counts[idx] ?? 0}
									{@const isChecked = selected.includes(idx)}

									{#if showResults || !canVotePolls}
										<div class="space-y-1.5 rounded-2xl bg-surface p-3.5">
											<div class="flex items-center justify-between gap-2 text-sm">
												<span class="font-semibold text-ink">{optionLabel}</span>
												<span class="tabular-nums shrink-0 text-xs font-bold text-ink">
													{pct}% ({votes})
												</span>
											</div>
											<div
												class="h-2 w-full overflow-hidden rounded-full bg-surface-2"
												role="progressbar"
												aria-valuenow={pct}
												aria-valuemin={0}
												aria-valuemax={100}
												aria-label={`${optionLabel} : ${pct}%`}
											>
												<div
													class="h-full origin-left rounded-full bg-brand transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
													style={`transform: scaleX(${pct / 100});`}
												></div>
											</div>
										</div>
									{:else}
										<button
											type="button"
											onclick={() => toggleOption(poll, idx)}
											aria-pressed={isChecked}
											class={`gpu-press flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left text-sm font-medium transition ${
												isChecked
													? 'border-brand/40 bg-brand-soft text-ink ring-1 ring-brand/40'
													: 'border-border bg-surface text-ink hover:bg-surface-2'
											}`}
										>
											<span class="flex items-center gap-2.5">
												<span
													class={`flex size-5 shrink-0 items-center justify-center border ${
														poll.multipleChoice ? 'rounded-md' : 'rounded-full'
													} ${
														isChecked
															? 'border-brand bg-brand text-white'
															: 'border-muted/50 bg-card'
													}`}
													aria-hidden="true"
												>
													{#if isChecked}
														<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
															<path stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5L20 7" />
														</svg>
													{/if}
												</span>
												<span>{optionLabel}</span>
											</span>
										</button>
									{/if}
								{/each}
							</div>
						</div>

						<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
							<div class="text-xs text-muted">
								<span class="font-semibold text-ink">{poll.totalVotes}</span>
								{poll.totalVotes <= 1 ? 'vote' : 'votes'}
								{#if poll.closesAt}
									· Clôture {formatDateTimeFr(poll.closesAt)}
								{/if}
							</div>

							{#if !closed && !poll.hasVoted && canVotePolls}
								<Button
									size="sm"
									variant="primary"
									loading={votingPollId === poll.id}
									disabled={selected.length === 0}
									onclick={() => submitVote(poll)}
								>
									Valider mon vote
								</Button>
							{:else if poll.hasVoted}
								<Badge variant="success">A voté</Badge>
							{/if}
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Modal création rapide en 30s -->
<Modal
	bind:open={createOpen}
	title="Nouveau sondage rapide"
	description="Crée une consultation en moins de 30 secondes pour le lycée, les adhérents ou le bureau."
	size="md"
>
	<form id="create-poll-form" onsubmit={handleCreatePoll} class="space-y-4">
		{#if createError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{createError}
			</div>
		{/if}

		<div class="space-y-1.5">
			<label for="poll-title" class="block text-sm font-semibold text-ink">
				Question / Titre
			</label>
			<input
				id="poll-title"
				type="text"
				bind:value={newTitle}
				required
				maxlength={160}
				placeholder="Ex : Quel thème pour le bal de promo ?"
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</div>

		<div class="space-y-1.5">
			<label for="poll-desc" class="block text-sm font-semibold text-ink">
				Précisions (optionnel)
			</label>
			<textarea
				id="poll-desc"
				bind:value={newDescription}
				rows={2}
				maxlength={1000}
				placeholder="Contexte, budget disponible, date limite..."
				class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none"
			></textarea>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="poll-scope" class="block text-sm font-semibold text-ink">
					Portée du vote
				</label>
				<select
					id="poll-scope"
					bind:value={newScope}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				>
					<option value="lycee">Tout le lycée</option>
					<option value="adherents">Adhérents MDL</option>
					<option value="bureau">Bureau uniquement</option>
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="poll-closes" class="block text-sm font-semibold text-ink">
					Clôture auto (optionnel)
				</label>
				<input
					id="poll-closes"
					type="datetime-local"
					bind:value={newClosesAt}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>

		<label class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink">
			<input
				type="checkbox"
				bind:checked={newMultipleChoice}
				class="size-4 accent-brand"
			/>
			Autoriser plusieurs choix par votant
		</label>

		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-sm font-semibold text-ink">Options (2 à 10)</span>
				{#if newOptions.length < 10}
					<button
						type="button"
						onclick={addOptionField}
						class="text-xs font-semibold text-brand hover:underline text-brand-ink cursor-pointer"
					>
						+ Ajouter une option
					</button>
				{/if}
			</div>

			<div class="space-y-2">
				{#each newOptions as _, idx (idx)}
					<div class="flex items-center gap-2">
						<label for={`poll-opt-${idx}`} class="sr-only">Option {idx + 1}</label>
						<input
							id={`poll-opt-${idx}`}
							type="text"
							bind:value={newOptions[idx]}
							required={idx < 2}
							maxlength={120}
							placeholder={`Option ${idx + 1}`}
							class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
						/>
						{#if newOptions.length > 2}
							<button
								type="button"
								onclick={() => removeOptionField(idx)}
								aria-label={`Supprimer l'option ${idx + 1}`}
								class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-surface text-muted hover:text-red-600"
							>
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
								</svg>
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-poll-form" variant="primary" loading={creating}>
			Publier le sondage
		</Button>
	{/snippet}
</Modal>

<!-- Modal partage lien + QR code SVG -->
<Modal
	bind:open={shareModalOpen}
	title="Partager le sondage"
	description={sharePoll?.title}
	size="sm"
>
	<div class="space-y-4 text-center">
		{#if shareQrLoading}
			<div class="mx-auto flex size-52 items-center justify-center">
				<Skeleton variant="rect" width="208px" height="208px" />
			</div>
		{:else if shareQrSvg}
			<div class="mx-auto inline-block rounded-2xl border border-border bg-white p-3 shadow-xs">
				{@html shareQrSvg}
			</div>
		{/if}

		<div class="space-y-1.5 text-left">
			<label for="share-poll-url" class="block text-xs font-semibold text-muted">
				Lien direct
			</label>
			<div class="flex gap-2">
				<input
					id="share-poll-url"
					type="text"
					readonly
					value={shareUrl}
					class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-xs text-ink"
				/>
				<Button size="sm" variant="primary" onclick={copyShareLink}>
					{copiedShareUrl ? 'Copié' : 'Copier'}
				</Button>
			</div>
		</div>

		{#if shareQrSvg}
			<Button variant="secondary" fullWidth onclick={downloadShareQr}>
				Télécharger le QR code (SVG)
			</Button>
		{/if}
	</div>
</Modal>
