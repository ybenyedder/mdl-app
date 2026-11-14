<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr, formatEuros } from '$shared/format';
	import { getRoleLabel, hasPermission, type Role } from '$shared/permissions';
	import type { PageData } from './$types';

	type VaultCategory = 'statuts' | 'rib' | 'convention' | 'photo' | 'autre';

	interface ChecklistStep {
		id: number;
		schoolYear: string;
		stepKey: string;
		label: string;
		description: string;
		completed: boolean;
		completedBy: number | null;
		completedAt: string | null;
		notes: string | null;
	}

	interface AnnualSummary {
		projects: { total: number; validated: number; completed: number };
		budget: { recettesCents: number; depensesCents: number; soldeCents: number; entriesCount: number };
		members: { total: number; adherents: number };
		assembliesCount: number;
		eventsCount: number;
		ticketsCount: number;
		vaultDocumentsCount: number;
	}

	interface VaultDoc {
		id: number;
		title: string;
		category: VaultCategory;
		mimeType: string;
		sizeBytes: number;
		encrypted: boolean;
		uploadedBy: number;
		uploaderFirstName?: string;
		uploaderLastName?: string;
		createdAt: string;
		downloadUrl: string;
	}

	interface MemberOption {
		id: number;
		firstName: string;
		lastName: string;
		role: Role;
		classe: string | null;
	}

	let { data }: { data: PageData } = $props();

	const canReadPassation = $derived(
		data.user ? hasPermission(data.user.role, 'passation:read') : false
	);
	const canManagePassation = $derived(
		data.user ? hasPermission(data.user.role, 'passation:manage') : false
	);
	const canReadVault = $derived(data.user ? hasPermission(data.user.role, 'vault:read') : false);
	const canWriteVault = $derived(data.user ? hasPermission(data.user.role, 'vault:write') : false);
	const canEmergencyRecover = $derived(
		data.user?.role === 'prof_referent' || data.user?.role === 'president'
	);

	let loading = $state(true);
	let schoolYear = $state('');
	let checklist = $state<ChecklistStep[]>([]);
	let summary = $state<AnnualSummary | null>(null);
	let vaultDocs = $state<VaultDoc[]>([]);
	let togglingStepId = $state<number | null>(null);

	// Notes modifiables par étape
	let editingNoteStep = $state<ChecklistStep | null>(null);
	let noteDraft = $state('');
	let savingNote = $state(false);

	// Upload coffre-fort chiffré
	let uploadTitle = $state('');
	let uploadCategory = $state<VaultCategory>('statuts');
	let uploadFile = $state<File | null>(null);
	let uploading = $state(false);
	let deletingDocId = $state<number | null>(null);

	// Procédure récupération d'urgence
	let membersOptions = $state<MemberOption[]>([]);
	let recoveryTargetId = $state<number | ''>('');
	let recoveryCustomPass = $state('');
	let recoveryResetTotp = $state(true);
	let recovering = $state(false);
	let recoveryResult = $state<{
		targetUserId: number;
		temporaryPassword: string;
		totpReset: boolean;
	} | null>(null);

	// Lettre-type Accord de l'établissement
	let accordLegalRep = $state('Madame / Monsieur le Proviseur');
	let accordPresident = $state('Le bureau de la MDL');
	let accordBody = $state('');
	let accordInitialized = $state(false);
	$effect(() => {
		if (!accordInitialized) {
			accordInitialized = true;
			accordPresident = data.user
				? `${data.user.firstName} ${data.user.lastName}`
				: 'Le bureau de la MDL';
			accordBody = `Objet : Demande d'accord préalable pour les projets, événements et campagnes de la Maison des Lycéens (${data.settings.schoolYear})\n\nMadame, Monsieur le chef d'établissement,\n\nConformément au décret n°2016-1228 et aux statuts de l'association ${data.settings.mdlName} domiciliée au ${data.settings.schoolName}, nous sollicitons votre accord pour l'organisation des actions de vie lycéenne (événements, foyer, précommandes textiles) au titre de l'année scolaire ${data.settings.schoolYear}.\n\nChaque manifestation fera l'objet d'un budget prévisionnel validé, d'une liste nominative de participants et du strict respect du règlement intérieur de l'établissement.\n\nNous restons à votre entière disposition pour tout échange complémentaire.\n\nRespectueusement,\nLe Bureau de la ${data.settings.mdlName}`;
		}
	});
	let generatingAccordPdf = $state(false);

	async function copyAccordText() {
		try {
			await navigator.clipboard.writeText(accordBody);
			toast.success('Lettre copiée', 'Tu peux la coller dans un mail ou courrier officiel.');
		} catch {
			toast.info('Copie manuelle', 'Sélectionne le texte dans la zone ci-dessous.');
		}
	}

	async function downloadAccordPdf() {
		if (generatingAccordPdf || accordBody.trim().length < 20) return;
		generatingAccordPdf = true;
		try {
			const res = await fetch('/api/passation/accord-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					legalRepresentative: accordLegalRep.trim(),
					presidentName: accordPresident.trim(),
					bodyText: accordBody.trim()
				})
			});
			if (!res.ok) {
				toast.error('Impossible de générer le PDF');
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `demande-accord-etablissement-${schoolYear || data.settings.schoolYear}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			toast.error('Erreur réseau lors de l’export PDF');
		} finally {
			generatingAccordPdf = false;
		}
	}

	const categoryLabels: Record<VaultCategory, string> = {
		statuts: 'Statuts',
		rib: 'RIB / Banque',
		convention: 'Convention',
		photo: 'Photo / Justificatif',
		autre: 'Autre document'
	};

	const completedCount = $derived(checklist.filter((s) => s.completed).length);
	const progressPct = $derived(
		checklist.length > 0 ? Math.round((completedCount / checklist.length) * 100) : 0
	);

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} o`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
	}

	async function loadAll() {
		if (!data.user || !canReadPassation) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const requests: Promise<Response>[] = [fetch('/api/passation')];
			if (canReadVault) requests.push(fetch('/api/vault'));
			if (canEmergencyRecover) requests.push(fetch('/api/members'));

			const responses = await Promise.all(requests);
			const passData = (await responses[0].json().catch(() => ({}))) as {
				schoolYear?: string;
				checklist?: ChecklistStep[];
				annualSummary?: AnnualSummary;
			};

			if (responses[0].ok) {
				schoolYear = passData.schoolYear || data.settings.schoolYear;
				checklist = passData.checklist ?? [];
				summary = passData.annualSummary ?? null;
			}

			let idx = 1;
			if (canReadVault && responses[idx]) {
				const vaultData = (await responses[idx].json().catch(() => ({}))) as {
					documents?: VaultDoc[];
				};
				if (responses[idx].ok) {
					vaultDocs = vaultData.documents ?? [];
				}
				idx += 1;
			}

			if (canEmergencyRecover && responses[idx]) {
				const memData = (await responses[idx].json().catch(() => ({}))) as {
					members?: MemberOption[];
				};
				if (responses[idx].ok && memData.members) {
					membersOptions = memData.members;
				}
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger le dossier de passation.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadAll();
	});

	async function toggleStep(step: ChecklistStep) {
		if (!canManagePassation || togglingStepId !== null) return;
		const previous = checklist;
		const nextCompleted = !step.completed;
		togglingStepId = step.id;

		// Optimiste
		checklist = checklist.map((s) =>
			s.id === step.id
				? {
						...s,
						completed: nextCompleted,
						completedAt: nextCompleted ? new Date().toISOString() : null
					}
				: s
		);

		try {
			const res = await fetch('/api/passation', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: step.id,
					schoolYear: step.schoolYear,
					completed: nextCompleted
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				step?: ChecklistStep;
				error?: string;
				message?: string;
			};
			if (!res.ok || !payload.step) {
				checklist = previous;
				toast.error('Échec mise à jour', payload.error || payload.message || 'Impossible de modifier cette étape.');
				return;
			}
			checklist = checklist.map((s) => (s.id === step.id ? payload.step! : s));
			toast.success(nextCompleted ? 'Étape validée' : 'Étape réouverte', step.label);
		} catch {
			checklist = previous;
			toast.error('Erreur réseau', 'Impossible de joindre le serveur.');
		} finally {
			togglingStepId = null;
		}
	}

	async function saveStepNote(event: SubmitEvent) {
		event.preventDefault();
		if (!editingNoteStep || !canManagePassation) return;
		savingNote = true;
		try {
			const res = await fetch('/api/passation', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: editingNoteStep.id,
					schoolYear: editingNoteStep.schoolYear,
					completed: editingNoteStep.completed,
					notes: noteDraft.trim() || null
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				step?: ChecklistStep;
				error?: string;
				message?: string;
			};
			if (!res.ok || !payload.step) {
				toast.error('Enregistrement impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}
			checklist = checklist.map((s) => (s.id === editingNoteStep!.id ? payload.step! : s));
			editingNoteStep = null;
			toast.success('Note enregistrée');
		} catch {
			toast.error('Erreur réseau', 'Impossible d’enregistrer la note.');
		} finally {
			savingNote = false;
		}
	}

	async function handleVaultUpload(event: SubmitEvent) {
		event.preventDefault();
		if (!uploadFile || !uploadTitle.trim() || !canWriteVault) {
			toast.warning('Champs requis', 'Choisis un titre et un fichier à chiffrer.');
			return;
		}

		uploading = true;
		try {
			const fd = new FormData();
			fd.append('title', uploadTitle.trim());
			fd.append('category', uploadCategory);
			fd.append('file', uploadFile);

			const res = await fetch('/api/vault', {
				method: 'POST',
				body: fd
			});
			const payload = (await res.json().catch(() => ({}))) as {
				document?: VaultDoc;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.document) {
				toast.error('Téléversement refusé', payload.error || payload.message || 'Erreur chiffrement.');
				return;
			}

			vaultDocs = [payload.document, ...vaultDocs];
			uploadTitle = '';
			uploadFile = null;
			const input = document.getElementById('vault-file-input') as HTMLInputElement | null;
			if (input) input.value = '';
			toast.success('Document chiffré (AES-256-GCM)', 'Stocké en sécurité dans le coffre-fort.');
		} catch {
			toast.error('Erreur réseau', 'Impossible d’envoyer le document.');
		} finally {
			uploading = false;
		}
	}

	async function deleteVaultDoc(doc: VaultDoc) {
		if (!canManagePassation || deletingDocId !== null) return;
		deletingDocId = doc.id;
		try {
			const res = await fetch(`/api/vault?id=${doc.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				toast.error('Suppression impossible', err.error || err.message || 'Erreur serveur.');
				return;
			}
			vaultDocs = vaultDocs.filter((d) => d.id !== doc.id);
			toast.success('Document supprimé', doc.title);
		} catch {
			toast.error('Erreur réseau');
		} finally {
			deletingDocId = null;
		}
	}

	async function handleEmergencyRecovery(event: SubmitEvent) {
		event.preventDefault();
		if (!canEmergencyRecover || !recoveryTargetId) return;

		if (recoveryCustomPass && recoveryCustomPass.length < 12) {
			toast.warning('Mot de passe trop court', '12 caractères minimum ou laisse vide pour génération auto.');
			return;
		}

		recovering = true;
		recoveryResult = null;
		try {
			const res = await fetch('/api/passation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					targetUserId: Number(recoveryTargetId),
					temporaryPassword: recoveryCustomPass.trim() || undefined,
					resetTotp: recoveryResetTotp
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				recovered?: boolean;
				targetUserId?: number;
				temporaryPassword?: string;
				totpReset?: boolean;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.recovered || !payload.temporaryPassword) {
				toast.error('Récupération refusée', payload.error || payload.message || 'Erreur serveur.');
				return;
			}

			recoveryResult = {
				targetUserId: payload.targetUserId!,
				temporaryPassword: payload.temporaryPassword,
				totpReset: Boolean(payload.totpReset)
			};
			recoveryCustomPass = '';
			toast.success('Accès réinitialisé', 'Transmets le mot de passe temporaire en main propre.');
		} catch {
			toast.error('Erreur réseau');
		} finally {
			recovering = false;
		}
	}
</script>

<svelte:head>
	<title>Passation & coffre-fort · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Passation & coffre-fort MDL
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Transmission du bureau {schoolYear || data.settings.schoolYear}, bilan annuel auto-généré et documents chiffrés.
			</p>
		</div>
		{#if checklist.length > 0}
			<Badge variant={progressPct === 100 ? 'success' : 'brand'} dot>
				{completedCount}/{checklist.length} étapes validées ({progressPct}%)
			</Badge>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connexion requise</h2>
			<p class="text-sm text-muted">
				Cet espace est réservé aux membres du bureau et au professeur référent.
			</p>
			<Button href="/connexion?redirect=/passation" variant="primary">Se connecter</Button>
		</Card>
	{:else if !canReadPassation}
		<Card padding="lg" class="text-center">
			<p class="text-base font-semibold text-ink">
				Accès réservé aux membres du bureau et au professeur référent.
			</p>
		</Card>
	{:else if loading}
		<div class="space-y-4">
			<Skeleton variant="card" height="140px" />
			<Skeleton variant="card" height="260px" />
		</div>
	{:else}
		<!-- Bilan annuel auto-généré -->
		{#if summary}
			<section aria-labelledby="annual-summary-heading" class="space-y-3">
				<h2 id="annual-summary-heading" class="text-lg font-bold text-ink">
					Bilan annuel automatique ({schoolYear})
				</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Card padding="sm" class="space-y-1">
						<p class="text-xs font-medium text-muted">Projets menés</p>
						<p class="text-2xl font-semibold text-ink">{summary.projects.total}</p>
						<p class="text-xs text-muted">
							{summary.projects.validated} validé(s) · {summary.projects.completed} terminé(s)
						</p>
					</Card>
					<Card padding="sm" class="space-y-1">
						<p class="text-xs font-medium text-muted">Solde budgétaire</p>
						<p class="text-2xl font-semibold text-ink">{formatEuros(summary.budget.soldeCents)}</p>
						<p class="text-xs text-muted">
							+{formatEuros(summary.budget.recettesCents)} / -{formatEuros(summary.budget.depensesCents)}
						</p>
					</Card>
					<Card padding="sm" class="space-y-1">
						<p class="text-xs font-medium text-muted">Adhérents & membres</p>
						<p class="text-2xl font-semibold text-ink">{summary.members.adherents}</p>
						<p class="text-xs text-muted">
							sur {summary.members.total} comptes actifs
						</p>
					</Card>
					<Card padding="sm" class="space-y-1">
						<p class="text-xs font-medium text-muted">Vie associative</p>
						<p class="text-2xl font-semibold text-ink">{summary.eventsCount} évts</p>
						<p class="text-xs text-muted">
							{summary.ticketsCount} billets · {summary.assembliesCount} AG · {summary.vaultDocumentsCount} docs
						</p>
					</Card>
				</div>
			</section>
		{/if}

		<div class="grid gap-6 lg:grid-cols-2">
			<!-- Checklist interactive de passation -->
			<Card class="space-y-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-lg font-bold text-ink">Checklist de passation</h2>
						<span class="font-mono text-xs font-bold text-ink">{progressPct}%</span>
					</div>
					<div
						class="h-2.5 w-full overflow-hidden rounded-full bg-border"
						role="progressbar"
						aria-valuenow={progressPct}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label="Progression passation"
					>
						<div
							class="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
							style={`width: ${progressPct}%`}
						></div>
					</div>
				</div>

				{#if checklist.length === 0}
					<p class="text-sm text-muted">Aucune étape configurée pour cette année scolaire.</p>
				{:else}
					<ul class="space-y-2.5">
						{#each checklist as step (step.id)}
							<li class="rounded-[10px] border border-border bg-surface p-3.5">
								<div class="flex items-start gap-3">
									<button
										type="button"
										disabled={!canManagePassation || togglingStepId === step.id}
										onclick={() => toggleStep(step)}
										aria-pressed={step.completed}
										aria-label={`${step.completed ? 'Décocher' : 'Valider'} l'étape ${step.label}`}
										class={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition ${
											step.completed
												? 'border-emerald-600 bg-emerald-600 text-white'
												: 'border-muted/50 bg-card'
										} ${canManagePassation ? 'cursor-pointer hover:border-brand' : 'opacity-65 cursor-not-allowed'}`}
									>
										{#if step.completed}
											<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
												<path stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5L20 7" />
											</svg>
										{/if}
									</button>

									<div class="min-w-0 flex-1 space-y-1">
										<p class={`text-sm font-semibold ${step.completed ? 'line-through text-muted' : 'text-ink'}`}>
											{step.label}
										</p>
										{#if step.description}
											<p class="text-xs text-muted">{step.description}</p>
										{/if}
										{#if step.notes}
											<p class="rounded-lg bg-card px-2.5 py-1.5 text-xs text-ink border border-border">
												{step.notes}
											</p>
										{/if}
										<div class="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted">
											{#if step.completedAt}
												<span>Validée le {formatDateTimeFr(step.completedAt)}</span>
											{/if}
											{#if canManagePassation}
												<button
													type="button"
													onclick={() => {
														editingNoteStep = step;
														noteDraft = step.notes || '';
													}}
													class="font-semibold text-brand hover:underline text-brand-ink cursor-pointer"
												>
													{step.notes ? 'Modifier la note' : 'Ajouter une note'}
												</button>
											{/if}
										</div>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>

			<!-- Coffre-fort documentaire chiffré -->
			{#if canReadVault}
				<Card class="space-y-4">
					<div class="flex items-center justify-between gap-2">
						<div>
							<h2 class="text-lg font-bold text-ink">Coffre-fort chiffré (AES-256)</h2>
							<p class="text-xs text-muted">
								Statuts, RIB, conventions et justificatifs chiffrés au repos sur le serveur.
							</p>
						</div>
						<Badge variant="success" dot>Chiffré</Badge>
					</div>

					{#if canWriteVault}
						<form onsubmit={handleVaultUpload} class="space-y-3 rounded-[10px] border border-border bg-surface p-3.5">
							<p class="text-xs font-semibold text-muted">
								Ajouter un document
							</p>
							<div class="grid gap-2.5 sm:grid-cols-2">
								<div class="space-y-1">
									<label for="vault-title" class="block text-xs font-semibold text-ink">
										Intitulé du document
									</label>
									<input
										id="vault-title"
										type="text"
										bind:value={uploadTitle}
										required
										placeholder="Ex : Statuts MDL 2026"
										class="min-h-10 w-full rounded-[10px] border border-border bg-card px-3 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									/>
								</div>
								<div class="space-y-1">
									<label for="vault-category" class="block text-xs font-semibold text-ink">
										Catégorie
									</label>
									<select
										id="vault-category"
										bind:value={uploadCategory}
										class="min-h-10 w-full rounded-[10px] border border-border bg-card px-3 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									>
										<option value="statuts">Statuts</option>
										<option value="rib">RIB / Banque</option>
										<option value="convention">Convention</option>
										<option value="photo">Photo / Justificatif</option>
										<option value="autre">Autre</option>
									</select>
								</div>
							</div>

							<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
								<label for="vault-file-input" class="sr-only">Fichier à chiffrer</label>
								<input
									id="vault-file-input"
									type="file"
									onchange={(e) => {
										const target = e.currentTarget as HTMLInputElement;
										uploadFile = target.files?.[0] ?? null;
									}}
									class="min-h-10 flex-1 text-xs text-muted file:mr-3 file:rounded-[10px] file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
								/>
								<Button type="submit" size="sm" variant="primary" loading={uploading}>
									Chiffrer & déposer
								</Button>
							</div>
						</form>
					{/if}

					{#if vaultDocs.length === 0}
						<p class="py-4 text-center text-sm text-muted">
							Aucun document dans le coffre-fort pour le moment.
						</p>
					{:else}
						<ul class="divide-y divide-border/70">
							{#each vaultDocs as doc (doc.id)}
								<li class="flex flex-wrap items-center justify-between gap-3 py-3">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<p class="font-semibold text-ink">{doc.title}</p>
											<Badge size="sm" variant="brand">
												{categoryLabels[doc.category]}
											</Badge>
										</div>
										<p class="mt-0.5 text-xs text-muted">
											{formatFileSize(doc.sizeBytes)} · déposé le {formatDateTimeFr(doc.createdAt)}
											{#if doc.uploaderFirstName}
												par {doc.uploaderFirstName} {doc.uploaderLastName}
											{/if}
										</p>
									</div>

									<div class="flex items-center gap-2">
										<a
											href={doc.downloadUrl}
											download
											class="inline-flex min-h-9 items-center rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/40"
										>
											Déchiffrer
										</a>
										{#if canManagePassation}
											<Button
												size="sm"
												variant="danger"
												loading={deletingDocId === doc.id}
												onclick={() => deleteVaultDoc(doc)}
											>
												Supprimer
											</Button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			{/if}
		</div>

		<!-- Lettre-type Accord du chef d'établissement -->
		<Card class="space-y-4">
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 class="text-lg font-bold text-ink">Lettre-type : Accord de l'établissement</h2>
					<p class="mt-0.5 text-xs text-muted">
						Modèle officiel à adapter et remettre au proviseur / CPE avant un événement, une boutique de pulls ou le renouvellement annuel de la MDL.
					</p>
				</div>
				<Badge variant="brand">PDF & copie rapide</Badge>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1">
					<label for="accord-rep" class="block text-xs font-semibold text-ink">
						Destinataire (Chef d'établissement)
					</label>
					<input
						id="accord-rep"
						type="text"
						bind:value={accordLegalRep}
						class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
					/>
				</div>
				<div class="space-y-1">
					<label for="accord-pres" class="block text-xs font-semibold text-ink">
						Signataire (Président(e) / Bureau MDL)
					</label>
					<input
						id="accord-pres"
						type="text"
						bind:value={accordPresident}
						class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
					/>
				</div>
			</div>

			<div class="space-y-1">
				<label for="accord-body" class="block text-xs font-semibold text-ink">
					Contenu de la demande d'accord
				</label>
				<textarea
					id="accord-body"
					rows={9}
					bind:value={accordBody}
					class="w-full rounded-[10px] border border-border bg-surface p-3.5 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none"
				></textarea>
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				<Button variant="secondary" onclick={copyAccordText}>Copier le texte</Button>
				<Button variant="primary" loading={generatingAccordPdf} onclick={downloadAccordPdf}>
					Télécharger en PDF
				</Button>
			</div>
		</Card>

		<!-- Procédure récupération d'urgence -->
		{#if canEmergencyRecover}
			<Card class="border-amber-500/35 space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div>
						<h2 class="text-lg font-bold text-ink">Procédure de récupération d'urgence</h2>
						<p class="text-xs text-muted">
							Réservée au professeur référent et au président en cas de perte d'accès d'un bureau sortant. Génère un mot de passe temporaire et révoque toutes les sessions actives.
						</p>
					</div>
					<Badge variant="warning">Journalisé SHA-256</Badge>
				</div>

				<form onsubmit={handleEmergencyRecovery} class="grid gap-3 sm:grid-cols-3 sm:items-end">
					<div class="space-y-1.5">
						<label for="recovery-user" class="block text-xs font-semibold text-ink">
							Compte cible
						</label>
						<select
							id="recovery-user"
							bind:value={recoveryTargetId}
							required
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
						>
							<option value="">Sélectionner un membre...</option>
							{#each membersOptions as m (m.id)}
								<option value={m.id}>
									{m.firstName} {m.lastName} ({getRoleLabel(m.role)})
								</option>
							{/each}
						</select>
					</div>

					<div class="space-y-1.5">
						<label for="recovery-pass" class="block text-xs font-semibold text-ink">
							Mot de passe temporaire (optionnel, min 12 car.)
						</label>
						<input
							id="recovery-pass"
							type="text"
							bind:value={recoveryCustomPass}
							placeholder="Laisser vide = généré automatiquement"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
						/>
					</div>

					<div class="flex flex-col gap-2">
						<label class="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
							<input type="checkbox" bind:checked={recoveryResetTotp} class="size-4 accent-brand" />
							Réinitialiser aussi la 2FA (TOTP)
						</label>
						<Button type="submit" variant="danger" loading={recovering} disabled={!recoveryTargetId}>
							Réinitialiser l'accès
						</Button>
					</div>
				</form>

				{#if recoveryResult}
					<div
						role="status"
						class="rounded-[10px] border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-1.5"
					>
						<p class="text-sm font-bold text-emerald-900 dark:text-emerald-200">
							Accès réinitialisé pour le compte #{recoveryResult.targetUserId}
						</p>
						<p class="text-xs text-ink">
							Mot de passe temporaire (à noter maintenant, affiché une seule fois) :
							<code class="ml-1 rounded bg-card px-2 py-0.5 font-mono font-bold text-brand-ink">
								{recoveryResult.temporaryPassword}
							</code>
						</p>
						<p class="text-xs text-muted">
							2FA réinitialisée : {recoveryResult.totpReset ? 'Oui' : 'Non'} · Toutes les sessions existantes ont été fermées.
						</p>
					</div>
				{/if}
			</Card>
		{/if}
	{/if}
</div>

<!-- Modal édition de note sur une étape -->
<Modal
	open={editingNoteStep !== null}
	onclose={() => (editingNoteStep = null)}
	title={editingNoteStep ? `Note : ${editingNoteStep.label}` : 'Note'}
	size="sm"
>
	<form id="step-note-form" onsubmit={saveStepNote} class="space-y-3">
		<label for="step-note-text" class="block text-sm font-semibold text-ink">
			Consignes pour le prochain bureau
		</label>
		<textarea
			id="step-note-text"
			rows={4}
			maxlength={1000}
			bind:value={noteDraft}
			placeholder="Contact banque, emplacement des clés, remarques..."
			class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none"
		></textarea>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editingNoteStep = null)}>Annuler</Button>
		<Button type="submit" form="step-note-form" variant="primary" loading={savingNote}>
			Enregistrer
		</Button>
	{/snippet}
</Modal>
