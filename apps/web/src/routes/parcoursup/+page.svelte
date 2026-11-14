<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	interface ProjectParticipation {
		projectId: number;
		title: string;
		category: string;
		status: string;
		roleInProject: string;
		hoursLogged: number;
	}

	interface ParcoursupResponse {
		student: {
			id: number;
			firstName: string;
			lastName: string;
			classe: string | null;
			role: string;
			roleLabel: string;
		};
		schoolYear: string;
		loggedHours: number;
		projects: ProjectParticipation[];
		draft: {
			summaryText: string;
			skills: string[];
			hoursTotal: number;
			updatedAt: string | null;
		};
	}

	interface SkillGuide {
		label: string;
		promptHint: string;
	}

	const CURATED_SKILLS: SkillGuide[] = [
		{
			label: 'Travail en équipe',
			promptHint: 'Explique comment tu as coordonné les tâches avec les autres lycéens.'
		},
		{
			label: 'Gestion de projet',
			promptHint: 'Décris les étapes préparées (planning, rétroplanning, suivi).'
		},
		{
			label: 'Organisation d’événements',
			promptHint: 'Cite un événement concret : logistique, accueil, sécurité, bilan.'
		},
		{
			label: 'Gestion budgétaire',
			promptHint: 'Mentionne l’élaboration d’un budget prévisionnel ou le suivi des recettes.'
		},
		{
			label: 'Prise de parole en public',
			promptHint: 'Précise tes interventions devant les classes, le CVL ou en Assemblée Générale.'
		},
		{
			label: 'Communication numérique',
			promptHint: 'Affiches, information des élèves, diffusion auprès des adhérents.'
		},
		{
			label: 'Médiation & écoute',
			promptHint: 'Recueil des besoins des lycéens et dialogue avec la direction.'
		},
		{
			label: 'Responsabilité associative',
			promptHint: 'Respect des règles, passation, engagement régulier toute l’année.'
		},
		{
			label: 'Autonomie & initiative',
			promptHint: 'Proposition d’une idée nouvelle et mise en œuvre jusqu’au bout.'
		},
		{
			label: 'Accueil & billetterie',
			promptHint: 'Gestion des entrées, accueil du public et sens du service.'
		}
	];

	let { data }: { data: PageData } = $props();

	const canReadOwn = $derived(
		data.user ? hasPermission(data.user.role, 'parcoursup:read_own') : false
	);
	const canExportAll = $derived(
		data.user ? hasPermission(data.user.role, 'parcoursup:export_all') : false
	);

	let loading = $state(true);
	let saving = $state(false);
	let downloadingPdf = $state(false);
	let dossier = $state<ParcoursupResponse | null>(null);

	let summaryText = $state('');
	let skills = $state<string[]>([]);
	let hoursTotal = $state(0);
	let customSkill = $state('');
	let activeHint = $state<string | null>(null);
	let lastSavedText = $state('');
	let lastSavedSkillsJson = $state('[]');
	let lastSavedHours = $state(0);

	// Option consultation autre élève pour référent/secrétaire/président
	let membersList = $state<Array<{ id: number; firstName: string; lastName: string; classe: string | null }>>([]);
	let selectedUserId = $state<number | null>(null);

	const isViewingSelf = $derived(
		!data.user || selectedUserId === null || selectedUserId === data.user.id
	);

	const hasUnsavedChanges = $derived(
		isViewingSelf &&
			(summaryText !== lastSavedText ||
				JSON.stringify(skills) !== lastSavedSkillsJson ||
				hoursTotal !== lastSavedHours)
	);

	const statusLabels: Record<string, string> = {
		brouillon: 'Brouillon',
		en_cours: 'En cours',
		valide: 'Validé',
		termine: 'Terminé',
		archive: 'Archivé'
	};

	async function loadDossier(targetUserId?: number | null) {
		if (!data.user || !canReadOwn) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const query =
				targetUserId && targetUserId !== data.user.id ? `?userId=${targetUserId}` : '';
			const res = await fetch(`/api/parcoursup${query}`);
			const payload = (await res.json().catch(() => ({}))) as ParcoursupResponse & {
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				toast.error('Chargement impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}

			dossier = payload;
			summaryText = payload.draft.summaryText;
			skills = [...payload.draft.skills];
			hoursTotal = payload.draft.hoursTotal;
			lastSavedText = summaryText;
			lastSavedSkillsJson = JSON.stringify(skills);
			lastSavedHours = hoursTotal;
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger ton dossier Parcoursup.');
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if (data.user) {
			selectedUserId = data.user.id;
			await loadDossier(data.user.id);
			if (canExportAll) {
				try {
					const res = await fetch('/api/members');
					const payload = (await res.json().catch(() => ({}))) as {
						members?: Array<{ id: number; firstName: string; lastName: string; classe: string | null }>;
					};
					if (res.ok && payload.members) {
						membersList = payload.members;
					}
				} catch {
					// Optionnel
				}
			}
		} else {
			loading = false;
		}
	});

	function toggleSkill(guide: SkillGuide) {
		if (!isViewingSelf) return;
		if (skills.includes(guide.label)) {
			skills = skills.filter((s) => s !== guide.label);
			if (activeHint === guide.promptHint) activeHint = null;
		} else {
			if (skills.length >= 20) {
				toast.warning('Maximum atteint', 'Tu peux sélectionner jusqu’à 20 compétences.');
				return;
			}
			skills = [...skills, guide.label];
			activeHint = guide.promptHint;
		}
	}

	function addCustomSkill() {
		if (!isViewingSelf) return;
		const clean = customSkill.trim();
		if (!clean) return;
		if (skills.includes(clean)) {
			customSkill = '';
			return;
		}
		if (skills.length >= 20) {
			toast.warning('Maximum atteint', '20 compétences maximum.');
			return;
		}
		skills = [...skills, clean];
		customSkill = '';
	}

	async function saveDraft(event?: SubmitEvent) {
		event?.preventDefault();
		if (!dossier || !isViewingSelf || saving) return;

		saving = true;
		try {
			const res = await fetch('/api/parcoursup', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					schoolYear: dossier.schoolYear,
					summaryText: summaryText.trim(),
					skills,
					hoursTotal: Math.max(0, Number(hoursTotal) || 0)
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				draft?: ParcoursupResponse['draft'];
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.draft) {
				toast.error('Enregistrement impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}

			dossier = { ...dossier, draft: payload.draft };
			summaryText = payload.draft.summaryText;
			skills = [...payload.draft.skills];
			hoursTotal = payload.draft.hoursTotal;
			lastSavedText = summaryText;
			lastSavedSkillsJson = JSON.stringify(skills);
			lastSavedHours = hoursTotal;
			toast.success('Brouillon enregistré', 'Tes modifications sont prêtes pour l’attestation PDF.');
		} catch {
			toast.error('Erreur réseau', 'Impossible de sauvegarder pour le moment.');
		} finally {
			saving = false;
		}
	}

	async function downloadPdf() {
		if (!dossier || downloadingPdf) return;
		if (hasUnsavedChanges) {
			await saveDraft();
		}

		downloadingPdf = true;
		try {
			const query =
				selectedUserId && data.user && selectedUserId !== data.user.id
					? `?userId=${selectedUserId}&format=pdf`
					: '?format=pdf';
			const res = await fetch(`/api/parcoursup${query}`);
			if (!res.ok) {
				toast.error('Export PDF impossible', 'Réessaie dans quelques instants.');
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `attestation-parcoursup-${dossier.student.id}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Attestation PDF téléchargée');
		} catch {
			toast.error('Erreur réseau', 'Impossible de télécharger le PDF.');
		} finally {
			downloadingPdf = false;
		}
	}
</script>

<svelte:head>
	<title>Parcoursup & engagement · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Valorisation Parcoursup
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Prépare ta rubrique « Activités et centres d'intérêt » à partir de ton engagement réel à la MDL et génère ton attestation PDF signée par le lycée.
			</p>
		</div>

		{#if dossier}
			<Button variant="primary" loading={downloadingPdf} onclick={downloadPdf}>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
				</svg>
				Télécharger l'attestation PDF
			</Button>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connecte-toi pour accéder à ton dossier</h2>
			<p class="text-sm text-muted">
				Retrouve tes heures d'engagement calculées, tes projets et rédige ton texte personnel Parcoursup.
			</p>
			<Button href="/connexion?redirect=/parcoursup" variant="primary">Se connecter</Button>
		</Card>
	{:else if !canReadOwn}
		<Card padding="lg" class="text-center space-y-2">
			<h2 class="text-lg font-bold text-ink">Réservé aux adhérents et au bureau</h2>
			<p class="text-sm text-muted">
				Valide ton adhésion MDL pour bénéficier de l'attestation d'engagement Parcoursup.
			</p>
		</Card>
	{:else if loading}
		<div class="space-y-4">
			<Skeleton variant="card" height="150px" />
			<Skeleton variant="card" height="280px" />
		</div>
	{:else if dossier}
		{#if canExportAll && membersList.length > 0}
			<Card padding="sm" class="flex flex-wrap items-center justify-between gap-3">
				<label for="parcoursup-member-select" class="text-sm font-semibold text-ink">
					Consulter l'attestation d'un élève :
				</label>
				<select
					id="parcoursup-member-select"
					value={selectedUserId ?? data.user.id}
					onchange={(e) => {
						const val = Number.parseInt((e.currentTarget as HTMLSelectElement).value, 10);
						selectedUserId = val;
						loadDossier(val);
					}}
					class="min-h-10 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				>
					{#each membersList as m (m.id)}
						<option value={m.id}>
							{m.firstName} {m.lastName} {m.classe ? `(${m.classe})` : ''}
						</option>
					{/each}
				</select>
			</Card>
		{/if}

		<!-- Récapitulatif rôle, heures et projets -->
		<div class="grid gap-4 md:grid-cols-3">
			<Card padding="sm" class="space-y-1">
				<p class="text-xs font-medium text-muted">Rôle tenu à la MDL</p>
				<p class="text-lg font-semibold text-ink">{dossier.student.roleLabel}</p>
				<p class="text-xs text-muted">
					{dossier.student.firstName} {dossier.student.lastName}
					{#if dossier.student.classe}· {dossier.student.classe}{/if}
				</p>
			</Card>

			<Card padding="sm" class="space-y-1">
				<p class="text-xs font-medium text-muted">Heures calculées (projets)</p>
				<p class="text-2xl font-semibold text-brand-ink">
					{dossier.loggedHours} h
				</p>
				<p class="text-xs text-muted">Somme des heures enregistrées sur tes projets</p>
			</Card>

			<Card padding="sm" class="space-y-1">
				<p class="text-xs font-medium text-muted">Projets & actions</p>
				<p class="text-2xl font-semibold text-ink">{dossier.projects.length}</p>
				<p class="text-xs text-muted">Année scolaire {dossier.schoolYear}</p>
			</Card>
		</div>

		<!-- Liste des projets impliqués -->
		<Card class="space-y-3">
			<h2 class="text-lg font-bold text-ink">Tes projets et responsabilités</h2>
			{#if dossier.projects.length === 0}
				<p class="text-sm text-muted">
					Aucun projet enregistré pour l'instant sur ton compte. Participe à un projet MDL pour voir tes heures comptabilisées automatiquement.
				</p>
			{:else}
				<ul class="grid gap-2.5 sm:grid-cols-2">
					{#each dossier.projects as proj (proj.projectId)}
						<li class="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface p-3">
							<div class="min-w-0">
								<p class="font-semibold text-ink">{proj.title}</p>
								<p class="text-xs text-muted">
									Rôle : <span class="font-medium text-ink">{proj.roleInProject}</span> · {proj.category}
								</p>
							</div>
							<div class="shrink-0 text-right">
								<p class="font-mono text-sm font-bold text-ink">{proj.hoursLogged} h</p>
								<Badge size="sm" variant="neutral">
									{statusLabels[proj.status] || proj.status}
								</Badge>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<!-- Sélecteur de compétences + éditeur élève authentique -->
		<form onsubmit={saveDraft} class="grid gap-6 lg:grid-cols-[0.95fr_1.25fr]">
			<Card class="space-y-4">
				<div>
					<h2 class="text-lg font-bold text-ink">Compétences mobilisées</h2>
					<p class="mt-1 text-xs text-muted">
						Clique sur les compétences que tu as réellement pratiquées pour structurer tes idées avant de rédiger.
					</p>
				</div>

				<div class="flex flex-wrap gap-2" role="group" aria-label="Sélecteur de compétences">
					{#each CURATED_SKILLS as guide (guide.label)}
						{@const active = skills.includes(guide.label)}
						<button
							type="button"
							disabled={!isViewingSelf}
							aria-pressed={active}
							onclick={() => toggleSkill(guide)}
							class={`min-h-10 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
								active
									? 'border-brand bg-brand text-white'
									: 'border-border bg-surface text-ink hover:border-brand/40'
							} ${!isViewingSelf ? 'opacity-70 cursor-default' : ''}`}
						>
							{active ? '✓ ' : '+ '}{guide.label}
						</button>
					{/each}

					{#each skills.filter((s) => !CURATED_SKILLS.some((g) => g.label === s)) as extra (extra)}
						<button
							type="button"
							disabled={!isViewingSelf}
							onclick={() => {
								if (isViewingSelf) skills = skills.filter((s) => s !== extra);
							}}
							class="min-h-10 cursor-pointer rounded-full border border-brand bg-brand text-white px-3 py-1.5 text-xs font-semibold"
						>
							✓ {extra} ×
						</button>
					{/each}
				</div>

				{#if isViewingSelf}
					<div class="flex gap-2">
						<label for="custom-skill-input" class="sr-only">Ajouter une compétence personnalisée</label>
						<input
							id="custom-skill-input"
							type="text"
							bind:value={customSkill}
							maxlength={80}
							placeholder="Autre compétence (ex : Graphisme)..."
							class="min-h-10 flex-1 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
						/>
						<Button size="sm" variant="secondary" onclick={addCustomSkill}>Ajouter</Button>
					</div>
				{/if}

				{#if activeHint}
					<div class="rounded-[10px] border border-brand/25 bg-brand-soft/60 p-3 text-xs text-ink">
						<p class="font-bold text-brand-ink">Piste de rédaction :</p>
						<p class="mt-0.5 leading-relaxed">{activeHint}</p>
					</div>
				{/if}
			</Card>

			<Card class="space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-lg font-bold text-ink">Ton texte d'engagement personnel</h2>
						<p class="text-xs text-muted">
							Rédige avec tes propres mots ce que cette expérience t'a apporté (zéro texte généré automatiquement).
						</p>
					</div>
					{#if hasUnsavedChanges}
						<Badge variant="warning">Modifications non enregistrées</Badge>
					{:else if dossier.draft.updatedAt}
						<Badge variant="success">Sauvegardé</Badge>
					{/if}
				</div>

				<div class="space-y-1.5">
					<label for="parcoursup-hours" class="block text-xs font-semibold text-ink">
						Volume horaire total déclaré (heures)
					</label>
					<div class="flex items-center gap-2">
						<input
							id="parcoursup-hours"
							type="number"
							min={0}
							max={2000}
							step="1"
							disabled={!isViewingSelf}
							bind:value={hoursTotal}
							class="min-h-10 w-32 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm font-bold text-ink focus:border-brand focus:outline-none"
						/>
						{#if isViewingSelf && dossier.loggedHours > 0 && hoursTotal !== dossier.loggedHours}
							<button
								type="button"
								onclick={() => (hoursTotal = dossier!.loggedHours)}
								class="text-xs font-semibold text-brand hover:underline text-brand-ink cursor-pointer"
							>
								Utiliser les {dossier.loggedHours} h calculées
							</button>
						{/if}
					</div>
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between text-xs">
						<label for="parcoursup-summary" class="font-semibold text-ink">
							Description personnelle pour Parcoursup
						</label>
						<span class="font-mono text-muted">{summaryText.length} / 3000</span>
					</div>
					<textarea
						id="parcoursup-summary"
						rows={8}
						maxlength={3000}
						readonly={!isViewingSelf}
						bind:value={summaryText}
						placeholder="Décris tes missions à la MDL, un projet marquant, les difficultés surmontées et ce que tu en retiens pour la suite de tes études..."
						class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none"
					></textarea>
				</div>

				<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
					<span class="text-xs text-muted">
						{#if dossier.draft.updatedAt}
							Dernière sauvegarde : {formatDateTimeFr(dossier.draft.updatedAt)}
						{:else}
							Brouillon non encore enregistré
						{/if}
					</span>

					{#if isViewingSelf}
						<Button type="submit" variant="primary" loading={saving}>
							Enregistrer mon brouillon
						</Button>
					{/if}
				</div>
			</Card>
		</form>
	{/if}
</div>
