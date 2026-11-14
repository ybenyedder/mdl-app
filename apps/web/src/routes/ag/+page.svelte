<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import QRCode from 'qrcode';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, formatDateTimeFr } from '$shared/format';
	import { hasAnyPermission, hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	type AssemblyStatus = 'brouillon' | 'candidatures' | 'vote_ouvert' | 'cloturee';
	type CastMode = 'en_ligne' | 'salle';

	interface AssemblySummary {
		id: number;
		title: string;
		description: string;
		scheduledAt: string;
		location: string;
		status: AssemblyStatus;
		voteOpensAt: string | null;
		voteClosesAt: string | null;
		quorumRequired: number;
		pvGeneratedAt: string | null;
		createdBy: number;
		createdAt: string;
		candidatesCount: number;
		attendancesCount: number;
	}

	interface CandidateItem {
		id: number;
		assemblyId: number;
		userId: number | null;
		fullName: string;
		classe: string;
		positionTitle: string;
		professionOfFaith: string;
		votesCount: number;
		approved: boolean;
		createdAt: string;
	}

	interface AttendanceItem {
		id: number;
		userId: number;
		present: boolean;
		signedAt: string;
		firstName: string;
		lastName: string;
		classe: string | null;
		role: string;
	}

	interface AssemblyDetailPayload {
		assembly: Omit<AssemblySummary, 'candidatesCount' | 'attendancesCount'>;
		candidates: CandidateItem[];
		attendances: AttendanceItem[];
		tally: {
			totalVotes: number;
			blankVotes: number;
			presentCount: number;
			quorumReached: boolean;
		};
		hasVoted: boolean;
		hasSignedAttendance: boolean;
	}

	interface MemberLite {
		id: number;
		firstName: string;
		lastName: string;
		classe: string | null;
		isAdherent: boolean;
	}

	let { data }: { data: PageData } = $props();

	let loadingList = $state(true);
	let loadingDetail = $state(false);
	let loadError = $state<string | null>(null);

	let assemblies = $state<AssemblySummary[]>([]);
	let selectedId = $state<number | null>(null);
	let detail = $state<AssemblyDetailPayload | null>(null);

	// Création nouvelle AG
	let createModalOpen = $state(false);
	let agTitle = $state('');
	let agDescription = $state('');
	let agScheduledAt = $state('');
	let agLocation = $state('Amphithéâtre / Foyer');
	let agQuorum = $state('30');
	let creatingAg = $state(false);

	// Candidature
	let candidateModalOpen = $state(false);
	let candFullName = $state('');
	let candClasse = $state('');
	let candPosition = $state('Président(e)');
	let candFaith = $state('');
	let submittingCand = $state(false);

	// QR code candidature
	let qrModalOpen = $state(false);
	let qrDataUrl = $state<string | null>(null);
	let qrShareUrl = $state('');

	// Émargement
	let signingSelf = $state(false);
	let membersList = $state<MemberLite[]>([]);
	let selectedAttendeeId = $state('');
	let signingMember = $state(false);

	// Vote
	let castMode = $state<CastMode>('en_ligne');
	let selectedVoteTarget = $state<'blank' | number | null>(null);
	let submittingVote = $state(false);

	// Clôture & anonymisation
	let closeConfirmOpen = $state(false);
	let updatingStatus = $state(false);

	const canReadAg = $derived(data.user ? hasPermission(data.user.role, 'ag:read') : false);
	const canManageAg = $derived(data.user ? hasPermission(data.user.role, 'ag:manage') : false);
	const canVoteAg = $derived(data.user ? hasPermission(data.user.role, 'ag:vote') : false);
	const canDownloadEmargement = $derived(
		data.user
			? hasAnyPermission(data.user.role, ['ag:manage', 'ag:generate_pv', 'members:read'])
			: false
	);
	const canGeneratePv = $derived(
		data.user ? hasAnyPermission(data.user.role, ['ag:generate_pv', 'ag:manage']) : false
	);
	const canReadMembers = $derived(
		data.user ? hasPermission(data.user.role, 'members:read') : false
	);

	const statusBadgeMap: Record<
		AssemblyStatus,
		{ label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' }
	> = {
		brouillon: { label: 'Préparation', variant: 'neutral' },
		candidatures: { label: 'Candidatures ouvertes', variant: 'warning' },
		vote_ouvert: { label: 'Scrutin en cours', variant: 'success' },
		cloturee: { label: 'Clôturée & anonymisée', variant: 'brand' }
	};

	async function fetchAssemblies(preferredId?: number | null) {
		if (!data.user || !canReadAg) {
			loadingList = false;
			return;
		}
		loadingList = true;
		loadError = null;
		try {
			const res = await fetch('/api/assemblies');
			if (res.status === 401) {
				await goto('/connexion');
				return;
			}
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(
					(json as { message?: string }).message || 'Erreur de chargement des assemblées.'
				);
			}
			assemblies = (json as { assemblies: AssemblySummary[] }).assemblies ?? [];

			const targetId =
				preferredId && assemblies.some((a) => a.id === preferredId)
					? preferredId
					: selectedId && assemblies.some((a) => a.id === selectedId)
						? selectedId
						: (assemblies[0]?.id ?? null);

			selectedId = targetId;
			if (targetId !== null) {
				await fetchDetail(targetId, false);
			} else {
				detail = null;
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Impossible de charger les AG.';
		} finally {
			loadingList = false;
		}
	}

	async function fetchDetail(id: number, silent = false) {
		if (!data.user || !canReadAg) return;
		if (!silent) loadingDetail = true;
		try {
			const res = await fetch(`/api/assemblies/${id}`);
			if (!res.ok) {
				if (!silent) {
					const err = await res.json().catch(() => ({}));
					toast.error(
						'Erreur',
						(err as { message?: string }).message || 'Impossible de charger cette AG.'
					);
				}
				return;
			}
			const payload = (await res.json()) as AssemblyDetailPayload;
			detail = payload;
			assemblies = assemblies.map((a) =>
				a.id === id
					? {
							...a,
							...payload.assembly,
							candidatesCount: payload.candidates.length,
							attendancesCount: payload.tally.presentCount
						}
					: a
			);
		} finally {
			if (!silent) loadingDetail = false;
		}
	}

	async function fetchMembersForAttendance() {
		if (!data.user || !canManageAg || !canReadMembers) return;
		try {
			const res = await fetch('/api/members');
			if (!res.ok) return;
			const json = (await res.json()) as { members?: MemberLite[] };
			membersList = (json.members ?? []).filter((m) => m.isAdherent);
		} catch {
			// Optionnel
		}
	}

	onMount(() => {
		if (!data.user) {
			goto('/connexion');
			return;
		}

		const queryAssemblyRaw = page.url.searchParams.get('assembly');
		const queryAssemblyId = queryAssemblyRaw ? Number(queryAssemblyRaw) : null;
		const wantsCandidate = page.url.searchParams.get('action') === 'candidater';

		void (async () => {
			await Promise.all([
				fetchAssemblies(Number.isFinite(queryAssemblyId) ? queryAssemblyId : null),
				fetchMembersForAttendance()
			]);
			if (wantsCandidate && detail?.assembly.status === 'candidatures') {
				openCandidateModal();
			}
		})();

		const interval = setInterval(() => {
			if (
				typeof document !== 'undefined' &&
				document.visibilityState === 'visible' &&
				selectedId !== null &&
				detail?.assembly.status === 'vote_ouvert'
			) {
				void fetchDetail(selectedId, true);
			}
		}, 5000);

		return () => clearInterval(interval);
	});

	function selectAssembly(id: number) {
		if (selectedId === id) return;
		selectedId = id;
		selectedVoteTarget = null;
		void fetchDetail(id, false);
	}

	function openCreateModal() {
		const nextWeek = new Date(Date.now() + 7 * 86_400_000);
		nextWeek.setHours(12, 30, 0, 0);
		const localIso = new Date(nextWeek.getTime() - nextWeek.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 16);

		agTitle = `Assemblée Générale Ordinaire ${data.settings.schoolYear}`;
		agDescription = 'Bilan moral et financier, projets de l’année et renouvellement du bureau.';
		agScheduledAt = localIso;
		agLocation = 'Amphithéâtre du lycée';
		agQuorum = '30';
		createModalOpen = true;
	}

	async function handleCreateAssembly(event: SubmitEvent) {
		event.preventDefault();
		if (creatingAg) return;
		creatingAg = true;
		try {
			const res = await fetch('/api/assemblies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: agTitle.trim(),
					description: agDescription.trim(),
					scheduledAt: new Date(agScheduledAt).toISOString(),
					location: agLocation.trim(),
					quorumRequired: Math.max(1, Number.parseInt(agQuorum, 10) || 30)
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Création impossible.');
			}
			const created = (json as { assembly: AssemblySummary }).assembly;
			createModalOpen = false;
			toast.success('Assemblée créée', created.title);
			await fetchAssemblies(created.id);
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Échec de création.');
		} finally {
			creatingAg = false;
		}
	}

	async function transitionStatus(nextStatus: AssemblyStatus) {
		if (!detail || !canManageAg || updatingStatus) return;
		updatingStatus = true;
		try {
			const res = await fetch(`/api/assemblies/${detail.assembly.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Transition refusée.');
			}
			const payload = json as { assembly: AssemblySummary; anonymizedVotes?: number };
			closeConfirmOpen = false;
			if (nextStatus === 'cloturee') {
				toast.success(
					'AG clôturée et votes anonymisés',
					`${payload.anonymizedVotes ?? 0} bulletin(s) anonymisé(s) de façon irréversible.`
				);
			} else {
				toast.success(
					'Statut mis à jour',
					statusBadgeMap[nextStatus]?.label ?? nextStatus
				);
			}
			await fetchDetail(detail.assembly.id, false);
		} catch (err) {
			toast.error('Action impossible', err instanceof Error ? err.message : 'Erreur serveur.');
		} finally {
			updatingStatus = false;
		}
	}

	function openCandidateModal() {
		if (data.user) {
			candFullName = `${data.user.firstName} ${data.user.lastName}`;
			candClasse = data.user.classe || '';
		}
		candPosition = 'Président(e)';
		candFaith = '';
		candidateModalOpen = true;
	}

	async function handleSubmitCandidate(event: SubmitEvent) {
		event.preventDefault();
		if (!detail || submittingCand) return;
		if (candFaith.trim().length < 10) {
			toast.error('Profession de foi trop courte', 'Rédigez au moins 10 caractères.');
			return;
		}
		submittingCand = true;
		try {
			const res = await fetch(`/api/assemblies/${detail.assembly.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fullName: candFullName.trim(),
					classe: candClasse.trim(),
					positionTitle: candPosition.trim(),
					professionOfFaith: candFaith.trim()
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Candidature refusée.');
			}
			candidateModalOpen = false;
			toast.success('Candidature enregistrée', `${candFullName.trim()} — ${candPosition.trim()}`);
			await fetchDetail(detail.assembly.id, false);
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Échec du dépôt.');
		} finally {
			submittingCand = false;
		}
	}

	async function openQrModal() {
		if (!detail || typeof window === 'undefined') return;
		const url = `${window.location.origin}/ag?assembly=${detail.assembly.id}&action=candidater`;
		qrShareUrl = url;
		qrModalOpen = true;
		try {
			qrDataUrl = await QRCode.toDataURL(url, {
				width: 280,
				margin: 2,
				color: { dark: '#0f172a', light: '#ffffff' }
			});
		} catch {
			qrDataUrl = null;
			toast.error('QR code indisponible', 'Copiez directement le lien ci-dessous.');
		}
	}

	async function copyShareUrl() {
		if (!qrShareUrl || typeof navigator === 'undefined') return;
		try {
			await navigator.clipboard.writeText(qrShareUrl);
			toast.success('Lien copié', 'Partagez-le aux élèves pour déposer leur candidature.');
		} catch {
			toast.warning('Copie manuelle requise', 'Sélectionnez le lien ci-dessous.');
		}
	}

	async function signOwnAttendance() {
		if (!detail || signingSelf) return;
		signingSelf = true;
		try {
			const res = await fetch(`/api/assemblies/${detail.assembly.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'attendance', present: true })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Émargement refusé.');
			}
			toast.success('Présence enregistrée', 'Votre émargement a bien été validé.');
			await fetchDetail(detail.assembly.id, true);
		} catch (err) {
			toast.error('Émargement impossible', err instanceof Error ? err.message : 'Erreur réseau.');
		} finally {
			signingSelf = false;
		}
	}

	async function signMemberAttendance() {
		if (!detail || !selectedAttendeeId || signingMember) return;
		signingMember = true;
		try {
			const res = await fetch(`/api/assemblies/${detail.assembly.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'attendance',
					present: true,
					targetUserId: Number(selectedAttendeeId)
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Émargement refusé.');
			}
			selectedAttendeeId = '';
			toast.success('Adhérent émargé', 'Présence ajoutée à la feuille d’émargement.');
			await fetchDetail(detail.assembly.id, true);
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Échec émargement.');
		} finally {
			signingMember = false;
		}
	}

	async function submitVote(event: SubmitEvent) {
		event.preventDefault();
		if (!detail || selectedVoteTarget === null || submittingVote) return;
		submittingVote = true;
		const isBlank = selectedVoteTarget === 'blank';
		const candidateId = isBlank ? null : selectedVoteTarget;

		try {
			const res = await fetch(`/api/assemblies/${detail.assembly.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					candidateId,
					isBlank,
					castMode
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Vote refusé.');
			}
			const payload = json as {
				recorded: boolean;
				tally: {
					totalVotes: number;
					blankVotes: number;
					candidates: Array<{ id: number; votesCount: number }>;
				};
			};

			// Mise à jour immédiate des résultats temps réel
			const votesByCandidate = new Map(payload.tally.candidates.map((c) => [c.id, c.votesCount]));
			detail = {
				...detail,
				hasVoted: true,
				tally: {
					...detail.tally,
					totalVotes: payload.tally.totalVotes,
					blankVotes: payload.tally.blankVotes
				},
				candidates: detail.candidates.map((c) => ({
					...c,
					votesCount: votesByCandidate.get(c.id) ?? c.votesCount
				}))
			};
			toast.success('Vote secret enregistré', 'Merci pour votre participation démocratique.');
		} catch (err) {
			toast.error('Vote non comptabilisé', err instanceof Error ? err.message : 'Erreur réseau.');
		} finally {
			submittingVote = false;
		}
	}

	const quorumPercent = $derived.by(() => {
		if (!detail || detail.assembly.quorumRequired <= 0) return 0;
		return Math.min(
			100,
			Math.round((detail.tally.presentCount / detail.assembly.quorumRequired) * 100)
		);
	});
</script>

<svelte:head>
	<title>Assemblées Générales · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-7">
	<header class="animate-spring flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Assemblées Générales & Élections
			</h1>
			<p class="mt-1 text-sm text-muted">
				Candidatures, convocations PDF, émargement, vote secret en ligne ou en salle et procès-verbaux.
			</p>
		</div>
		{#if canManageAg}
			<Button variant="primary" size="md" onclick={openCreateModal}>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
				</svg>
				Nouvelle AG
			</Button>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg">
			<p class="text-sm text-muted">Redirection vers la connexion...</p>
		</Card>
	{:else if !canReadAg}
		<Card padding="lg">
			<h2 class="text-lg font-bold text-ink">Accès réservé</h2>
			<p class="mt-1 text-sm text-muted">
				Connectez-vous avec un compte adhérent ou membre du bureau pour accéder aux Assemblées Générales.
			</p>
		</Card>
	{:else if loadingList}
		<div class="grid gap-6 lg:grid-cols-3">
			<Skeleton variant="card" height="18rem" />
			<div class="lg:col-span-2">
				<Skeleton variant="card" height="24rem" />
			</div>
		</div>
	{:else if loadError}
		<Card padding="md">
			<p class="text-sm font-semibold text-red-700 dark:text-red-300">{loadError}</p>
			<Button variant="secondary" size="sm" class="mt-3" onclick={() => fetchAssemblies()}>
				Réessayer
			</Button>
		</Card>
	{:else if assemblies.length === 0}
		<Card padding="lg" class="text-center">
			<h2 class="text-lg font-bold text-ink">Aucune Assemblée Générale programmée</h2>
			<p class="mt-1 text-sm text-muted">
				Planifiez votre prochaine AG pour générer la convocation et ouvrir les candidatures.
			</p>
			{#if canManageAg}
				<Button variant="primary" size="md" class="mt-4" onclick={openCreateModal}>
					Créer la première AG
				</Button>
			{/if}
		</Card>
	{:else}
		<div class="grid gap-5 lg:grid-cols-12">
			<!-- Carrousel snap mobile / Colonne gauche desktop : liste des AG -->
			<aside
				aria-label="Liste des Assemblées Générales"
				class="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:col-span-4 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
			>
				{#each assemblies as ag (ag.id)}
					{@const st = statusBadgeMap[ag.status] ?? { label: ag.status, variant: 'neutral' }}
					{@const isSelected = selectedId === ag.id}
					<button
						type="button"
						onclick={() => selectAssembly(ag.id)}
						class={`gpu-press w-[80vw] max-w-[300px] shrink-0 snap-start cursor-pointer rounded-[var(--radius-card)] border p-4 text-left transition lg:w-full lg:max-w-none ${
							isSelected
								? 'border-brand/40 bg-card apple-shadow-elevated ring-2 ring-brand/25'
								: 'border-border bg-card/80 apple-shadow-card hover:bg-card'
						}`}
					>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<Badge variant={st.variant} size="sm" dot>{st.label}</Badge>
							<span class="text-xs font-semibold text-muted">{countdownLabel(ag.scheduledAt)}</span>
						</div>
						<p class="mt-2 text-base font-bold text-ink">{ag.title}</p>
						<p class="mt-1 text-xs text-muted">
							{formatDateTimeFr(ag.scheduledAt)} · {ag.location}
						</p>
						<div class="mt-3 flex items-center gap-3 text-xs font-medium text-muted">
							<span>{ag.candidatesCount} candidat(s)</span>
							<span>·</span>
							<span>{ag.attendancesCount}/{ag.quorumRequired} émargés</span>
						</div>
					</button>
				{/each}
			</aside>

			<!-- Colonne droite : espace complet de l'AG sélectionnée -->
			<div class="space-y-6 lg:col-span-8">
				{#if loadingDetail || !detail}
					<Skeleton variant="card" height="24rem" />
				{:else}
					{@const ag = detail.assembly}
					{@const st = statusBadgeMap[ag.status] ?? { label: ag.status, variant: 'neutral' }}

					<!-- En-tête AG + Workflow + Téléchargements PDF -->
					<Card padding="md" class="space-y-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div class="space-y-1.5">
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant={st.variant} dot>{st.label}</Badge>
									<Badge variant="brand">{countdownLabel(ag.scheduledAt)}</Badge>
									{#if ag.pvGeneratedAt}
										<Badge variant="success">PV généré</Badge>
									{/if}
								</div>
								<h2 class="text-xl font-semibold text-ink sm:text-2xl">{ag.title}</h2>
								<p class="text-xs text-muted">
									{formatDateTimeFr(ag.scheduledAt)} · {ag.location} · Quorum requis : {ag.quorumRequired}
								</p>
								{#if ag.description}
									<p class="pt-1 text-sm text-muted">{ag.description}</p>
								{/if}
							</div>

							<Button
								variant="ghost"
								size="sm"
								onclick={() => fetchDetail(ag.id, false)}
								aria-label="Actualiser les données de l'AG"
							>
								Actualiser
							</Button>
						</div>

						<!-- Téléchargements PDF directs -->
						<div class="flex flex-wrap gap-2 border-t border-border/70 pt-3">
							<Button
								href={`/api/assemblies/${ag.id}/pdf?type=convocation`}
								target="_blank"
								rel="noopener"
								variant="secondary"
								size="sm"
							>
								Convocation PDF
							</Button>
							{#if canDownloadEmargement}
								<Button
									href={`/api/assemblies/${ag.id}/pdf?type=emargement`}
									target="_blank"
									rel="noopener"
									variant="secondary"
									size="sm"
								>
									Feuille d’émargement PDF
								</Button>
							{/if}
							{#if canGeneratePv}
								<Button
									href={`/api/assemblies/${ag.id}/pdf?type=pv`}
									target="_blank"
									rel="noopener"
									variant="secondary"
									size="sm"
								>
									Procès-Verbal PDF
								</Button>
							{/if}
							<Button variant="secondary" size="sm" onclick={openQrModal}>
								QR code candidature
							</Button>
						</div>

						<!-- Contrôles bureau (transitions de phase + Clôture & Anonymisation) -->
						{#if canManageAg && ag.status !== 'cloturee'}
							<div class="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface p-3">
								<span class="mr-1 text-xs font-bold uppercase tracking-wider text-muted">
									Pilotage séance :
								</span>
								{#if ag.status === 'brouillon'}
									<Button
										variant="primary"
										size="sm"
										loading={updatingStatus}
										onclick={() => transitionStatus('candidatures')}
									>
										Ouvrir les candidatures
									</Button>
								{/if}
								{#if ag.status === 'brouillon' || ag.status === 'candidatures'}
									<Button
										variant="primary"
										size="sm"
										loading={updatingStatus}
										onclick={() => transitionStatus('vote_ouvert')}
									>
										Ouvrir le vote
									</Button>
								{/if}
								<Button
									variant="danger"
									size="sm"
									onclick={() => (closeConfirmOpen = true)}
								>
									Clôture & Anonymisation des votes
								</Button>
							</div>
						{/if}
					</Card>

					<!-- Émargement & Quorum -->
					<Card padding="md" class="space-y-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h3 class="text-lg font-bold text-ink">Émargement & Quorum</h3>
								<p class="text-xs text-muted">
									{detail.tally.presentCount} présent(s) sur {ag.quorumRequired} requis ({quorumPercent}%)
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant={detail.tally.quorumReached ? 'success' : 'warning'} dot>
									{detail.tally.quorumReached ? 'Quorum atteint' : 'Quorum en attente'}
								</Badge>
								{#if ag.status !== 'cloturee'}
									{#if detail.hasSignedAttendance}
										<Badge variant="success">Vous avez émargé ✓</Badge>
									{:else}
										<Button
											variant="primary"
											size="sm"
											loading={signingSelf}
											onclick={signOwnAttendance}
										>
											Signer ma présence
										</Button>
									{/if}
								{/if}
							</div>
						</div>

						<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface">
							<div
								class={`h-full rounded-full transition-all duration-300 ${
									detail.tally.quorumReached ? 'bg-emerald-500' : 'bg-brand'
								}`}
								style={`width: ${quorumPercent}%`}
							></div>
						</div>

						{#if canManageAg && membersList.length > 0 && ag.status !== 'cloturee'}
							<div class="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3 sm:flex-row sm:items-center">
								<label for="ag-member-checkin" class="text-xs font-semibold text-ink">
									Émarger un adhérent en salle :
								</label>
								<select
									id="ag-member-checkin"
									bind:value={selectedAttendeeId}
									class="min-h-10 flex-1 rounded-[10px] border border-border bg-card px-3 py-1.5 text-base text-ink sm:text-sm"
								>
									<option value="">Sélectionner un adhérent...</option>
									{#each membersList as member (member.id)}
										<option value={String(member.id)}>
											{member.lastName.toUpperCase()} {member.firstName} {member.classe ? `(${member.classe})` : ''}
										</option>
									{/each}
								</select>
								<Button
									variant="secondary"
									size="sm"
									disabled={!selectedAttendeeId}
									loading={signingMember}
									onclick={signMemberAttendance}
								>
									Valider présence
								</Button>
							</div>
						{/if}

						{#if detail.attendances.length > 0}
							<div class="flex flex-wrap gap-1.5">
								{#each detail.attendances.filter((a) => a.present).slice(0, 18) as att (att.id)}
									<Badge variant="neutral" size="sm">
										{att.firstName} {att.lastName}{att.classe ? ` · ${att.classe}` : ''}
									</Badge>
								{/each}
								{#if detail.attendances.filter((a) => a.present).length > 18}
									<Badge variant="brand" size="sm">
										+{detail.attendances.filter((a) => a.present).length - 18} autres
									</Badge>
								{/if}
							</div>
						{/if}
					</Card>

					<!-- Candidatures -->
					<Card padding="md" class="space-y-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h3 class="text-lg font-bold text-ink">
									Candidatures ({detail.candidates.length})
								</h3>
								<p class="text-xs text-muted">
									{ag.status === 'candidatures'
										? 'Les candidatures sont ouvertes à tous les membres connectés.'
										: ag.status === 'brouillon'
											? 'Ouvrez la phase candidatures pour recevoir les dossiers.'
											: 'Liste officielle des candidats retenus pour le scrutin.'}
								</p>
							</div>
							{#if ag.status === 'candidatures'}
								<Button variant="primary" size="sm" onclick={openCandidateModal}>
									Déposer ma candidature
								</Button>
							{/if}
						</div>

						{#if detail.candidates.length === 0}
							<p class="rounded-[10px] border border-border/80 p-5 text-center text-sm text-muted">
								Aucune candidature déposée pour cette assemblée.
							</p>
						{:else}
							<div class="grid gap-3 sm:grid-cols-2">
								{#each detail.candidates as cand (cand.id)}
									<div class="rounded-[10px] border border-border bg-surface p-4 space-y-2">
										<div class="flex items-start justify-between gap-2">
											<div>
												<Badge variant="brand" size="sm">{cand.positionTitle}</Badge>
												<h4 class="mt-1.5 text-base font-bold text-ink">{cand.fullName}</h4>
												{#if cand.classe}
													<p class="text-xs text-muted">{cand.classe}</p>
												{/if}
											</div>
											{#if ag.status === 'vote_ouvert' || ag.status === 'cloturee'}
												<Badge variant="neutral" size="sm">{cand.votesCount} voix</Badge>
											{/if}
										</div>
										<p class="text-xs leading-relaxed text-muted">{cand.professionOfFaith}</p>
									</div>
								{/each}
							</div>
						{/if}
					</Card>

					<!-- Scrutin en ligne / mode salle & Résultats temps réel -->
					<Card padding="md" class="space-y-5">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h3 class="text-lg font-bold text-ink">Scrutin & Résultats en temps réel</h3>
								<p class="text-xs text-muted">
									{detail.tally.totalVotes} bulletin(s) exprimé(s) · dont {detail.tally.blankVotes} vote(s) blanc(s)
								</p>
							</div>
							{#if ag.status === 'vote_ouvert'}
								<Badge variant="success" dot>Actualisation auto (5s)</Badge>
							{/if}
						</div>

						{#if ag.status === 'vote_ouvert' && !detail.hasVoted}
							{#if !canVoteAg || !data.user.isAdherent}
								<div class="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
									Seuls les adhérents à jour de cotisation peuvent voter lors de l’Assemblée Générale.
								</div>
							{:else}
								<form onsubmit={submitVote} class="space-y-4 rounded-[10px] border border-brand/30 bg-brand-soft/30 p-4">
									<div class="flex flex-wrap items-center justify-between gap-3">
										<p class="text-sm font-bold text-ink">Mode de participation</p>
										<div class="inline-flex rounded-[10px] border border-border bg-card p-1">
											<button
												type="button"
												onclick={() => (castMode = 'en_ligne')}
												class={`min-h-9 cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold transition ${
													castMode === 'en_ligne'
														? 'bg-brand text-white'
														: 'text-muted hover:text-ink'
												}`}
											>
												En ligne
											</button>
											<button
												type="button"
												onclick={() => (castMode = 'salle')}
												class={`min-h-9 cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold transition ${
													castMode === 'salle'
														? 'bg-brand text-white'
														: 'text-muted hover:text-ink'
												}`}
											>
												Mode salle
											</button>
										</div>
									</div>

									<fieldset class="space-y-2">
										<legend class="text-xs font-semibold text-muted">
											Sélectionnez votre choix pour le scrutin secret :
										</legend>
										{#each detail.candidates.filter((c) => c.approved) as cand (cand.id)}
											<label
												class={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[10px] border p-3 transition ${
													selectedVoteTarget === cand.id
														? 'border-brand bg-card ring-1 ring-brand'
														: 'border-border bg-card/70 hover:border-brand/40'
												}`}
											>
												<div class="flex items-center gap-3">
													<input
														type="radio"
														name="ag-vote-choice"
														value={cand.id}
														checked={selectedVoteTarget === cand.id}
														onchange={() => (selectedVoteTarget = cand.id)}
														class="size-4 accent-brand"
													/>
													<div>
														<p class="text-sm font-bold text-ink">{cand.fullName}</p>
														<p class="text-xs text-muted">
															{cand.positionTitle}{cand.classe ? ` · ${cand.classe}` : ''}
														</p>
													</div>
												</div>
											</label>
										{/each}

										<label
											class={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] border p-3 transition ${
												selectedVoteTarget === 'blank'
													? 'border-brand bg-card ring-1 ring-brand'
													: 'border-border bg-card/70 hover:border-brand/40'
											}`}
										>
											<input
												type="radio"
												name="ag-vote-choice"
												value="blank"
												checked={selectedVoteTarget === 'blank'}
												onchange={() => (selectedVoteTarget = 'blank')}
												class="size-4 accent-brand"
											/>
											<span class="text-sm font-semibold text-ink">Vote blanc</span>
										</label>
									</fieldset>

									<Button
										type="submit"
										variant="primary"
										size="md"
										fullWidth
										loading={submittingVote}
										disabled={selectedVoteTarget === null}
									>
										Confirmer mon vote ({castMode === 'salle' ? 'en salle' : 'en ligne'})
									</Button>
								</form>
							{/if}
						{:else if detail.hasVoted && ag.status === 'vote_ouvert'}
							<div class="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
								Votre bulletin a bien été enregistré. Les résultats ci-dessous s’actualisent en direct.
							</div>
						{/if}

						<!-- Barres de résultats temps réel -->
						<div class="space-y-3" aria-live="polite">
							{#each detail.candidates as cand (cand.id)}
								{@const pct =
									detail.tally.totalVotes > 0
										? Math.round((cand.votesCount / detail.tally.totalVotes) * 100)
										: 0}
								<div class="space-y-1">
									<div class="flex items-center justify-between gap-2 text-sm">
										<span class="font-semibold text-ink">
											{cand.fullName}
											<span class="text-xs font-normal text-muted">({cand.positionTitle})</span>
										</span>
										<span class="font-bold text-ink">
											{cand.votesCount} voix ({pct}%)
										</span>
									</div>
									<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface">
										<div
											class="h-full rounded-full bg-brand transition-all duration-300"
											style={`width: ${pct}%`}
										></div>
									</div>
								</div>
							{/each}

							{#if detail.tally.totalVotes > 0}
								{@const blankPct = Math.round(
									(detail.tally.blankVotes / detail.tally.totalVotes) * 100
								)}
								<div class="space-y-1 pt-1">
									<div class="flex items-center justify-between text-xs text-muted">
										<span>Votes blancs</span>
										<span>{detail.tally.blankVotes} ({blankPct}%)</span>
									</div>
									<div class="h-2 w-full overflow-hidden rounded-full bg-surface">
										<div
											class="h-full rounded-full bg-slate-400 transition-all duration-300"
											style={`width: ${blankPct}%`}
										></div>
									</div>
								</div>
							{/if}
						</div>
					</Card>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Modal Création AG -->
<Modal bind:open={createModalOpen} title="Nouvelle Assemblée Générale" size="md">
	<form id="create-ag-form" onsubmit={handleCreateAssembly} class="space-y-3.5">
		<div>
			<label for="ag-title" class="mb-1 block text-xs font-semibold text-ink">Titre *</label>
			<input
				id="ag-title"
				type="text"
				required
				minlength="3"
				maxlength="140"
				bind:value={agTitle}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="ag-date" class="mb-1 block text-xs font-semibold text-ink">Date et heure *</label>
				<input
					id="ag-date"
					type="datetime-local"
					required
					bind:value={agScheduledAt}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
			<div>
				<label for="ag-quorum" class="mb-1 block text-xs font-semibold text-ink">Quorum requis *</label>
				<input
					id="ag-quorum"
					type="number"
					required
					min="1"
					max="2000"
					bind:value={agQuorum}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
		</div>
		<div>
			<label for="ag-location" class="mb-1 block text-xs font-semibold text-ink">Lieu *</label>
			<input
				id="ag-location"
				type="text"
				required
				minlength="2"
				maxlength="120"
				bind:value={agLocation}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
		</div>
		<div>
			<label for="ag-desc" class="mb-1 block text-xs font-semibold text-ink">Ordre du jour</label>
			<textarea
				id="ag-desc"
				rows="3"
				maxlength="2000"
				bind:value={agDescription}
				class="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
			></textarea>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (createModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-ag-form" variant="primary" loading={creatingAg}>
			Créer l’assemblée
		</Button>
	{/snippet}
</Modal>

<!-- Modal Dépôt candidature -->
<Modal
	bind:open={candidateModalOpen}
	title="Déposer ma candidature"
	description="Présentez votre motivation aux adhérents de la MDL."
	size="md"
>
	<form id="candidate-form" onsubmit={handleSubmitCandidate} class="space-y-3.5">
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="cand-name" class="mb-1 block text-xs font-semibold text-ink">Nom complet *</label>
				<input
					id="cand-name"
					type="text"
					required
					minlength="2"
					maxlength="100"
					bind:value={candFullName}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
			<div>
				<label for="cand-classe" class="mb-1 block text-xs font-semibold text-ink">Classe *</label>
				<input
					id="cand-classe"
					type="text"
					required
					minlength="1"
					maxlength="30"
					bind:value={candClasse}
					placeholder="Ex : 1ère G2"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
		</div>

		<div>
			<label for="cand-pos" class="mb-1 block text-xs font-semibold text-ink">Poste visé *</label>
			<input
				id="cand-pos"
				type="text"
				required
				minlength="2"
				maxlength="80"
				list="ag-positions-list"
				bind:value={candPosition}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
			<datalist id="ag-positions-list">
				<option value="Président(e)"></option>
				<option value="Vice-président(e)"></option>
				<option value="Trésorier(ère)"></option>
				<option value="Secrétaire"></option>
				<option value="Membre du bureau"></option>
			</datalist>
		</div>

		<div>
			<label for="cand-faith" class="mb-1 block text-xs font-semibold text-ink">
				Profession de foi (10 caractères min.) *
			</label>
			<textarea
				id="cand-faith"
				rows="4"
				required
				minlength="10"
				maxlength="1500"
				bind:value={candFaith}
				placeholder="Vos idées pour le foyer, les événements et la vie lycéenne..."
				class="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
			></textarea>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (candidateModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="candidate-form" variant="primary" loading={submittingCand}>
			Publier ma candidature
		</Button>
	{/snippet}
</Modal>

<!-- Modal QR Code lien de candidature -->
<Modal
	bind:open={qrModalOpen}
	title="QR code lien de candidature"
	description="Affichez ce QR code en salle ou sur les panneaux du lycée pour recueillir les candidatures."
	size="sm"
>
	<div class="flex flex-col items-center gap-4 text-center">
		{#if qrDataUrl}
			<div class="rounded-2xl border border-border bg-white p-3 shadow-xs">
				<img
					src={qrDataUrl}
					alt="QR code d’accès direct au dépôt de candidature"
					class="size-56"
				/>
			</div>
		{/if}
		<div class="w-full rounded-[10px] border border-border bg-surface p-2.5 text-left">
			<p class="break-all text-xs text-muted">{qrShareUrl}</p>
		</div>
	</div>
	{#snippet footer()}
		<Button variant="secondary" onclick={copyShareUrl}>Copier le lien</Button>
		<Button variant="primary" onclick={() => (qrModalOpen = false)}>Fermer</Button>
	{/snippet}
</Modal>

<!-- Modal Confirmation Clôture & Anonymisation -->
<Modal
	bind:open={closeConfirmOpen}
	title="Clôturer l’AG et anonymiser les votes ?"
	description="Cette action est irréversible : le scrutin sera verrouillé et tous les identifiants de votants seront définitivement dissociés de leurs bulletins."
	size="sm"
>
	<p class="text-sm text-ink">
		Vous pourrez ensuite télécharger le <strong>Procès-Verbal officiel PDF</strong> avec les résultats définitifs.
	</p>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (closeConfirmOpen = false)}>Annuler</Button>
		<Button
			variant="danger"
			loading={updatingStatus}
			onclick={() => transitionStatus('cloturee')}
		>
			Clôturer & Anonymiser
		</Button>
	{/snippet}
</Modal>
