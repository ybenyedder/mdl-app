<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import BudgetChartSvg, {
		type CategorySpendDatum,
		type ProjectBudgetDatum
	} from '$lib/components/charts/BudgetChartSvg.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { compressReceiptImageClient, exportCsvWasm } from '$lib/wasm-client';
	import { formatDateFr, formatEuros } from '$shared/format';
	import { hasAnyPermission, hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	interface BudgetEntryItem {
		id: number;
		projectId: number | null;
		type: 'recette' | 'depense';
		category: string;
		label: string;
		amountCents: number;
		entryDate: string;
		hasReceipt: boolean;
		receiptMime: string | null;
		receiptUrl: string | null;
		createdBy: number;
		validatedBy: number | null;
		fiscalYear: string;
		createdAt: string;
	}

	interface BudgetTotals {
		totalRecettesCents: number;
		totalDepensesCents: number;
		soldeCents: number;
	}

	interface ProjectOption {
		id: number;
		title: string;
		budgetPlannedCents: number;
	}

	let { data }: { data: PageData } = $props();

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let selectedFiscalYearOverride = $state<string | null>(null);
	const selectedFiscalYear = $derived(
		selectedFiscalYearOverride ?? (data.settings.schoolYear || '2026-2027')
	);
	let typeFilter = $state<'all' | 'recette' | 'depense'>('all');
	let searchQuery = $state('');

	let entries = $state<BudgetEntryItem[]>([]);
	let totals = $state<BudgetTotals>({
		totalRecettesCents: 0,
		totalDepensesCents: 0,
		soldeCents: 0
	});
	let projects = $state<ProjectOption[]>([]);

	// Formulaire nouvelle écriture
	let addModalOpen = $state(false);
	let formType = $state<'recette' | 'depense'>('depense');
	let formCategory = $state('Matériel / Foyer');
	let formLabel = $state('');
	let formAmountEuros = $state('');
	let formEntryDate = $state(new Date().toISOString().slice(0, 10));
	let formProjectId = $state<string>('');
	let formFiscalYear = $state('');
	let submittingEntry = $state(false);

	// Compression justificatif côté client (Rust/WASM)
	let compressingReceipt = $state(false);
	let compressedFile = $state<File | null>(null);
	let receiptStats = $state<{
		fileName: string;
		originalBytes: number;
		compressedBytes: number;
		isImage: boolean;
	} | null>(null);
	let receiptPreviewUrl = $state<string | null>(null);

	// Export CSV
	let exportingCsv = $state(false);

	// Aperçu justificatif déchiffré
	let previewModalOpen = $state(false);
	let previewEntry = $state<BudgetEntryItem | null>(null);

	const canReadBudget = $derived(
		data.user ? hasPermission(data.user.role, 'budget:read') : false
	);
	const canWriteBudget = $derived(
		data.user ? hasPermission(data.user.role, 'budget:write') : false
	);
	const canValidateBudget = $derived(
		data.user
			? hasAnyPermission(data.user.role, ['budget:write', 'budget:close_year', 'projects:validate'])
			: false
	);
	const canReadProjects = $derived(
		data.user ? hasPermission(data.user.role, 'projects:read') : false
	);

	const fiscalYearOptions = $derived.by(() => {
		const base = data.settings.schoolYear || '2026-2027';
		const m = /^(\d{4})-(\d{4})$/.exec(base);
		const set = new Set<string>([base]);
		if (m) {
			const y1 = Number(m[1]);
			set.add(`${y1 - 1}-${y1}`);
			set.add(`${y1 + 1}-${y1 + 2}`);
		}
		for (const e of entries) {
			if (e.fiscalYear) set.add(e.fiscalYear);
		}
		return Array.from(set).sort().reverse();
	});

	const projectMap = $derived(new Map(projects.map((p) => [p.id, p])));

	const filteredEntries = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return entries.filter((e) => {
			if (typeFilter !== 'all' && e.type !== typeFilter) return false;
			if (!q) return true;
			const projTitle = e.projectId ? projectMap.get(e.projectId)?.title ?? '' : '';
			return (
				e.label.toLowerCase().includes(q) ||
				e.category.toLowerCase().includes(q) ||
				projTitle.toLowerCase().includes(q)
			);
		});
	});

	const chartProjects = $derived.by<ProjectBudgetDatum[]>(() => {
		const spentByProj = new Map<number, number>();
		let unlinkedSpent = 0;

		for (const entry of entries) {
			if (entry.type !== 'depense') continue;
			if (entry.projectId) {
				spentByProj.set(entry.projectId, (spentByProj.get(entry.projectId) ?? 0) + entry.amountCents);
			} else {
				unlinkedSpent += entry.amountCents;
			}
		}

		const list: ProjectBudgetDatum[] = [];
		for (const p of projects) {
			const spent = spentByProj.get(p.id) ?? 0;
			if (p.budgetPlannedCents > 0 || spent > 0) {
				list.push({
					label: p.title,
					plannedCents: p.budgetPlannedCents,
					spentCents: spent
				});
			}
		}

		// Inclure les projets qui ont des dépenses mais ne sont pas dans la liste chargée
		for (const [pid, spent] of spentByProj.entries()) {
			if (!projectMap.has(pid)) {
				list.push({ label: `Projet #${pid}`, plannedCents: 0, spentCents: spent });
			}
		}

		if (unlinkedSpent > 0) {
			list.push({ label: 'Hors projet', plannedCents: 0, spentCents: unlinkedSpent });
		}

		return list;
	});

	const chartCategories = $derived.by<CategorySpendDatum[]>(() => {
		const byCat = new Map<string, number>();
		for (const entry of entries) {
			if (entry.type !== 'depense') continue;
			byCat.set(entry.category, (byCat.get(entry.category) ?? 0) + entry.amountCents);
		}
		return Array.from(byCat.entries())
			.map(([category, totalCents]) => ({ category, totalCents }))
			.sort((a, b) => b.totalCents - a.totalCents);
	});

	function formatKo(bytes: number): string {
		return `${(bytes / 1024).toLocaleString('fr-FR', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		})} Ko`;
	}

	function computeGainPercent(before: number, after: number): number {
		if (before <= 0) return 0;
		return Math.round(((before - after) / before) * 100);
	}

	async function fetchBudget(year = selectedFiscalYear) {
		if (!data.user || !canReadBudget) {
			loading = false;
			return;
		}
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`/api/budget?fiscalYear=${encodeURIComponent(year)}`);
			if (res.status === 401) {
				await goto('/connexion');
				return;
			}
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Erreur de chargement du budget.');
			}
			const payload = json as {
				fiscalYear: string;
				entries: BudgetEntryItem[];
				totals: BudgetTotals;
			};
			entries = payload.entries ?? [];
			totals = payload.totals ?? { totalRecettesCents: 0, totalDepensesCents: 0, soldeCents: 0 };
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Impossible de charger la trésorerie.';
		} finally {
			loading = false;
		}
	}

	async function fetchProjectsList() {
		if (!data.user || !canReadProjects) return;
		try {
			const res = await fetch('/api/projects');
			if (!res.ok) return;
			const json = (await res.json()) as { projects?: ProjectOption[] };
			projects = json.projects ?? [];
		} catch {
			// Optionnel pour le libellé projet
		}
	}

	onMount(() => {
		if (!data.user) {
			goto('/connexion');
			return;
		}
		void Promise.all([fetchBudget(selectedFiscalYear), fetchProjectsList()]);
		return () => {
			if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
		};
	});

	function handleFiscalYearChange(nextYear: string) {
		selectedFiscalYearOverride = nextYear;
		void fetchBudget(nextYear);
	}

	function resetReceiptState() {
		if (receiptPreviewUrl) {
			URL.revokeObjectURL(receiptPreviewUrl);
			receiptPreviewUrl = null;
		}
		compressedFile = null;
		receiptStats = null;
	}

	async function handleReceiptInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		resetReceiptState();
		if (!file) return;

		if (file.type === 'application/pdf') {
			compressedFile = file;
			receiptStats = {
				fileName: file.name,
				originalBytes: file.size,
				compressedBytes: file.size,
				isImage: false
			};
			return;
		}

		if (!file.type.startsWith('image/')) {
			toast.error('Format non supporté', 'Sélectionnez une image (JPEG, PNG, WebP) ou un PDF.');
			input.value = '';
			return;
		}

		compressingReceipt = true;
		try {
			const result = await compressReceiptImageClient(file, 1600, 82);
			const baseName = file.name.replace(/\.[^.]+$/, '') || 'justificatif';
			const blobPart = new Uint8Array(result.bytes);
			const outFile = new File([blobPart], `${baseName}.jpg`, {
				type: result.mimeType
			});

			compressedFile = outFile;
			receiptStats = {
				fileName: outFile.name,
				originalBytes: result.originalSize,
				compressedBytes: result.compressedSize,
				isImage: true
			};
			receiptPreviewUrl = URL.createObjectURL(outFile);
		} catch (err) {
			toast.error(
				'Compression impossible',
				err instanceof Error ? err.message : 'Vérifiez le fichier image.'
			);
			input.value = '';
		} finally {
			compressingReceipt = false;
		}
	}

	function openAddModal() {
		formType = 'depense';
		formCategory = 'Matériel / Foyer';
		formLabel = '';
		formAmountEuros = '';
		formEntryDate = new Date().toISOString().slice(0, 10);
		formProjectId = '';
		formFiscalYear =
			selectedFiscalYear === 'all'
				? data.settings.schoolYear || '2026-2027'
				: selectedFiscalYear;
		resetReceiptState();
		addModalOpen = true;
	}

	async function handleAddEntry(event: SubmitEvent) {
		event.preventDefault();
		if (submittingEntry || compressingReceipt) return;

		const euros = Number.parseFloat(String(formAmountEuros ?? '').replace(',', '.'));
		const amountCents = Number.isFinite(euros) ? Math.round(euros * 100) : 0;
		if (amountCents <= 0) {
			toast.error('Montant invalide', 'Indiquez un montant positif en euros.');
			return;
		}

		submittingEntry = true;
		try {
			const formData = new FormData();
			formData.set('type', formType);
			formData.set('category', formCategory.trim());
			formData.set('label', formLabel.trim());
			formData.set('amountCents', String(amountCents));
			formData.set('entryDate', formEntryDate);
			formData.set('fiscalYear', formFiscalYear.trim());
			if (formProjectId) {
				formData.set('projectId', formProjectId);
			}
			if (compressedFile) {
				formData.set('receipt', compressedFile);
			}

			const res = await fetch('/api/budget', {
				method: 'POST',
				body: formData
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Enregistrement refusé.');
			}

			const created = (json as { entry: BudgetEntryItem }).entry;
			if (selectedFiscalYear === 'all' || selectedFiscalYear === created.fiscalYear) {
				entries = [created, ...entries];
				if (created.type === 'recette') {
					totals = {
						...totals,
						totalRecettesCents: totals.totalRecettesCents + created.amountCents,
						soldeCents: totals.soldeCents + created.amountCents
					};
				} else {
					totals = {
						...totals,
						totalDepensesCents: totals.totalDepensesCents + created.amountCents,
						soldeCents: totals.soldeCents - created.amountCents
					};
				}
			} else {
				selectedFiscalYearOverride = created.fiscalYear;
				await fetchBudget(created.fiscalYear);
			}

			addModalOpen = false;
			resetReceiptState();
			toast.success('Écriture enregistrée', `${created.label} (${formatEuros(created.amountCents)})`);
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Impossible d’ajouter l’écriture.');
		} finally {
			submittingEntry = false;
		}
	}

	async function toggleValidateEntry(entry: BudgetEntryItem) {
		if (!canValidateBudget) return;
		const nextValidate = entry.validatedBy === null;
		const prevEntries = [...entries];

		// Mise à jour optimiste
		entries = entries.map((e) =>
			e.id === entry.id ? { ...e, validatedBy: nextValidate ? data.user!.id : null } : e
		);

		try {
			const res = await fetch(`/api/budget/${entry.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ validate: nextValidate })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Validation refusée.');
			}
			const updated = (json as { entry: BudgetEntryItem }).entry;
			entries = entries.map((e) => (e.id === updated.id ? updated : e));
			toast.success(
				nextValidate ? 'Écriture validée' : 'Validation retirée',
				updated.label
			);
		} catch (err) {
			entries = prevEntries;
			toast.error('Erreur', err instanceof Error ? err.message : 'Impossible de valider.');
		}
	}

	async function deleteEntry(entry: BudgetEntryItem) {
		if (!canWriteBudget) return;
		if (!window.confirm(`Supprimer l’écriture « ${entry.label} » (${formatEuros(entry.amountCents)}) ?`)) {
			return;
		}
		const prevEntries = [...entries];
		const prevTotals = { ...totals };

		entries = entries.filter((e) => e.id !== entry.id);
		if (entry.type === 'recette') {
			totals = {
				...totals,
				totalRecettesCents: totals.totalRecettesCents - entry.amountCents,
				soldeCents: totals.soldeCents - entry.amountCents
			};
		} else {
			totals = {
				...totals,
				totalDepensesCents: totals.totalDepensesCents - entry.amountCents,
				soldeCents: totals.soldeCents + entry.amountCents
			};
		}

		try {
			const res = await fetch(`/api/budget/${entry.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { message?: string }).message || 'Suppression refusée.');
			}
			toast.info('Écriture supprimée', entry.label);
		} catch (err) {
			entries = prevEntries;
			totals = prevTotals;
			toast.error('Suppression impossible', err instanceof Error ? err.message : 'Erreur réseau.');
		}
	}

	async function handleExportCsv() {
		if (exportingCsv) return;
		exportingCsv = true;
		try {
			const headers = [
				'Date',
				'Type',
				'Catégorie',
				'Libellé',
				'Projet',
				'Montant (EUR)',
				'Exercice',
				'Statut',
				'Justificatif'
			];
			const rows = filteredEntries.map((e) => {
				const signed = ((e.type === 'recette' ? e.amountCents : -e.amountCents) / 100)
					.toFixed(2)
					.replace('.', ',');
				const projTitle = e.projectId ? projectMap.get(e.projectId)?.title ?? `Projet #${e.projectId}` : '';
				return [
					e.entryDate,
					e.type === 'recette' ? 'Recette' : 'Dépense',
					e.category,
					e.label,
					projTitle,
					signed,
					e.fiscalYear,
					e.validatedBy ? 'Validée' : 'À valider',
					e.hasReceipt ? 'Oui' : 'Non'
				];
			});

			const csvContent = await exportCsvWasm(headers, rows);
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `tresorerie-mdl-${selectedFiscalYear}.csv`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
			toast.success('Export CSV prêt', `${rows.length} écriture(s) exportée(s).`);
		} catch (err) {
			toast.error('Export CSV impossible', err instanceof Error ? err.message : 'Erreur WASM/CSV.');
		} finally {
			exportingCsv = false;
		}
	}

	function openReceiptPreview(entry: BudgetEntryItem) {
		previewEntry = entry;
		previewModalOpen = true;
	}
</script>

<svelte:head>
	<title>Trésorerie & Budget · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-7">
	<!-- En-tête + actions export & ajout -->
	<header class="animate-spring flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Trésorerie & Budget MDL
			</h1>
			<p class="mt-1 text-sm text-muted">
				Suivi comptable, justificatifs chiffrés et bilans annuels par exercice scolaire.
			</p>
		</div>

		{#if canReadBudget}
			<div class="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
				<Button variant="secondary" size="sm" loading={exportingCsv} onclick={handleExportCsv} class="shrink-0">
					Export CSV
				</Button>
				<Button
					href={`/api/budget/export?format=pdf&fiscalYear=${encodeURIComponent(selectedFiscalYear)}`}
					variant="secondary"
					size="sm"
					target="_blank"
					rel="noopener"
					class="shrink-0"
				>
					Export PDF
				</Button>
				{#if canWriteBudget}
					<Button variant="primary" size="sm" onclick={openAddModal} class="shrink-0">
						<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
						</svg>
						Ajouter une écriture
					</Button>
				{/if}
			</div>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg">
			<p class="text-sm text-muted">Redirection vers la connexion...</p>
		</Card>
	{:else if !canReadBudget}
		<Card padding="lg">
			<h2 class="text-lg font-bold text-ink">Accès restreint</h2>
			<p class="mt-1 text-sm text-muted">
				La consultation de la comptabilité est réservée aux membres du bureau et au professeur référent.
			</p>
		</Card>
	{:else}
		<!-- Filtres exercice + type + recherche -->
		<Card padding="sm">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label for="budget-fiscal-year" class="mb-1 block text-xs font-semibold text-muted">
							Exercice scolaire
						</label>
						<select
							id="budget-fiscal-year"
							value={selectedFiscalYear}
							onchange={(e) => handleFiscalYearChange((e.currentTarget as HTMLSelectElement).value)}
							class="min-h-10 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink"
						>
							{#each fiscalYearOptions as fy (fy)}
								<option value={fy}>{fy}</option>
							{/each}
							<option value="all">Tous les exercices</option>
						</select>
					</div>

					<div>
						<label for="budget-type-filter" class="mb-1 block text-xs font-semibold text-muted">
							Nature
						</label>
						<select
							id="budget-type-filter"
							bind:value={typeFilter}
							class="min-h-10 rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
						>
							<option value="all">Recettes & Dépenses</option>
							<option value="recette">Recettes uniquement</option>
							<option value="depense">Dépenses uniquement</option>
						</select>
					</div>
				</div>

				<div class="w-full sm:w-64">
					<label for="budget-search" class="mb-1 block text-xs font-semibold text-muted">
						Rechercher
					</label>
					<input
						id="budget-search"
						type="search"
						bind:value={searchQuery}
						placeholder="Libellé, catégorie, projet"
						class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
					/>
				</div>
			</div>
		</Card>

		{#if loading}
			<div class="grid gap-4 sm:grid-cols-3">
				<Skeleton variant="card" height="7rem" />
				<Skeleton variant="card" height="7rem" />
				<Skeleton variant="card" height="7rem" />
			</div>
			<Skeleton variant="card" height="20rem" />
		{:else if loadError}
			<Card padding="md">
				<p class="text-sm font-semibold text-red-700 dark:text-red-300">{loadError}</p>
				<Button variant="secondary" size="sm" class="mt-3" onclick={() => fetchBudget(selectedFiscalYear)}>
					Réessayer
				</Button>
			</Card>
		{:else}
			<!-- KPI Totaux -->
			<section aria-label="Synthèse financière" class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
				<Card padding="md" stagger={1}>
					<p class="text-xs font-medium text-muted">Recettes</p>
					<p
						class={`tabular-nums mt-1.5 text-xl font-semibold sm:text-3xl ${
							totals.totalRecettesCents > 0
								? 'text-emerald-600 dark:text-[#4cc38a]'
								: 'text-ink'
						}`}
					>
						+{formatEuros(totals.totalRecettesCents)}
					</p>
					<p class="mt-1 text-xs text-muted">
						{entries.filter((e) => e.type === 'recette').length} écriture(s)
					</p>
				</Card>

				<Card padding="md" stagger={2}>
					<p class="text-xs font-medium text-muted">Dépenses</p>
					<p
						class={`tabular-nums mt-1.5 text-xl font-semibold sm:text-3xl ${
							totals.totalDepensesCents > 0 ? 'text-ink' : 'text-muted'
						}`}
					>
						{totals.totalDepensesCents > 0
							? `−${formatEuros(totals.totalDepensesCents)}`
							: formatEuros(0)}
					</p>
					<p class="mt-1 text-xs text-muted">
						{entries.filter((e) => e.type === 'depense').length} écriture(s)
					</p>
				</Card>

				<Card padding="md" stagger={3} class="col-span-2 sm:col-span-1">
					<p class="text-xs font-medium text-muted">Solde net</p>
					<p
						class={`tabular-nums mt-1.5 text-2xl font-semibold sm:text-3xl ${
							totals.soldeCents < 0 ? 'text-red-600 dark:text-[#e5484d]' : 'text-ink'
						}`}
					>
						{formatEuros(totals.soldeCents)}
					</p>
					<p class="mt-1 text-xs text-muted">
						Exercice {selectedFiscalYear === 'all' ? 'cumulé' : selectedFiscalYear}
					</p>
				</Card>
			</section>

			<!-- Graphiques SVG purs -->
			<BudgetChartSvg
				projects={chartProjects}
				categories={chartCategories}
				title={`Analyse budgétaire — ${selectedFiscalYear === 'all' ? 'Tous exercices' : selectedFiscalYear}`}
			/>

			<!-- Liste des écritures -->
			<Card padding="md">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-lg font-semibold text-ink">Journal des écritures</h2>
						<p class="text-xs text-muted">
							{filteredEntries.length} écriture{filteredEntries.length > 1 ? 's' : ''} affichée{filteredEntries.length > 1 ? 's' : ''}
						</p>
					</div>
				</div>

				{#if filteredEntries.length === 0}
					<div class="rounded-[10px] border border-border/80 p-8 text-center">
						<p class="text-sm font-semibold text-muted">Aucune écriture comptable sur ce filtre.</p>
						{#if canWriteBudget}
							<Button variant="primary" size="sm" class="mt-3" onclick={openAddModal}>
								Saisir la première écriture
							</Button>
						{/if}
					</div>
				{:else}
					<!-- Vue tableau Desktop -->
					<div class="hidden overflow-x-auto md:block">
						<table class="w-full border-collapse text-left text-sm">
							<thead>
								<tr class="border-b border-border text-xs text-muted">
									<th class="py-3 pr-3 font-semibold">Date</th>
									<th class="py-3 pr-3 font-semibold">Libellé & Projet</th>
									<th class="py-3 pr-3 font-semibold">Catégorie</th>
									<th class="py-3 pr-3 font-semibold">Montant</th>
									<th class="py-3 pr-3 font-semibold">Validation</th>
									<th class="py-3 pr-3 font-semibold">Justificatif</th>
									<th class="py-3 text-right font-semibold">Actions</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border/70">
								{#each filteredEntries as entry (entry.id)}
									{@const proj = entry.projectId ? projectMap.get(entry.projectId) : null}
									<tr class="hover:bg-surface">
										<td class="py-3 pr-3 whitespace-nowrap text-xs text-muted">
											{formatDateFr(entry.entryDate)}
										</td>
										<td class="py-3 pr-3">
											<p class="font-semibold text-ink">{entry.label}</p>
											{#if proj}
												<a
													href={`/projets/${proj.id}`}
													class="text-xs text-brand hover:underline text-brand-ink"
												>
													{proj.title}
												</a>
											{/if}
										</td>
										<td class="py-3 pr-3">
											<Badge variant="neutral" size="sm">{entry.category}</Badge>
										</td>
										<td class="py-3 pr-3 whitespace-nowrap font-bold">
											<span
												class={entry.type === 'recette'
													? 'text-emerald-700 dark:text-emerald-400'
													: 'text-amber-700 dark:text-amber-400'}
											>
												{entry.type === 'recette' ? '+' : '−'}{formatEuros(entry.amountCents)}
											</span>
										</td>
										<td class="py-3 pr-3">
											{#if entry.validatedBy}
												<Badge variant="success" size="sm" dot>Validée</Badge>
											{:else}
												<Badge variant="warning" size="sm" dot>À valider</Badge>
											{/if}
										</td>
										<td class="py-3 pr-3">
											{#if entry.hasReceipt}
												<div class="flex items-center gap-2">
													<a
														href={`/api/budget/${entry.id}?receipt=1`}
														target="_blank"
														rel="noopener"
														download={`justificatif-${entry.id}`}
														class="text-xs font-semibold text-brand hover:underline text-brand-ink"
													>
														Télécharger
													</a>
													{#if entry.receiptMime?.startsWith('image/')}
														<button
															type="button"
															onclick={() => openReceiptPreview(entry)}
															class="cursor-pointer text-xs font-medium text-muted hover:text-ink hover:underline"
														>
															Aperçu
														</button>
													{/if}
												</div>
											{:else}
												<span class="text-xs text-muted">Aucun</span>
											{/if}
										</td>
										<td class="py-3 text-right">
											<div class="inline-flex items-center gap-1.5">
												{#if canValidateBudget}
													<button
														type="button"
														onclick={() => toggleValidateEntry(entry)}
														class="min-h-8 cursor-pointer rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:border-brand/40"
													>
														{entry.validatedBy ? 'Invalider' : 'Valider'}
													</button>
												{/if}
												{#if canWriteBudget}
													<button
														type="button"
														onclick={() => deleteEntry(entry)}
														aria-label={`Supprimer ${entry.label}`}
														class="min-h-8 cursor-pointer rounded-md border border-red-500/30 bg-red-500/8 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-500/15 dark:text-red-300"
													>
														Suppr.
													</button>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Vue cartes Mobile -->
					<ul class="space-y-3 md:hidden">
						{#each filteredEntries as entry (entry.id)}
							{@const proj = entry.projectId ? projectMap.get(entry.projectId) : null}
							<li class="rounded-[10px] border border-border bg-surface p-3.5 space-y-2.5">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="font-bold text-ink">{entry.label}</p>
										<p class="text-xs text-muted">
											{formatDateFr(entry.entryDate)} · {entry.category}
											{#if proj}· {proj.title}{/if}
										</p>
									</div>
									<p
										class={`shrink-0 text-base font-semibold ${
											entry.type === 'recette'
												? 'text-emerald-700 dark:text-emerald-400'
												: 'text-amber-700 dark:text-amber-400'
										}`}
									>
										{entry.type === 'recette' ? '+' : '−'}{formatEuros(entry.amountCents)}
									</p>
								</div>

								<div class="flex flex-wrap items-center justify-between gap-2">
									<div class="flex items-center gap-2">
										{#if entry.validatedBy}
											<Badge variant="success" size="sm" dot>Validée</Badge>
										{:else}
											<Badge variant="warning" size="sm" dot>À valider</Badge>
										{/if}
										{#if entry.hasReceipt}
											<a
												href={`/api/budget/${entry.id}?receipt=1`}
												target="_blank"
												rel="noopener"
												class="text-xs font-semibold text-brand underline text-brand-ink"
											>
												Justificatif
											</a>
										{/if}
									</div>

									<div class="flex items-center gap-1.5">
										{#if canValidateBudget}
											<button
												type="button"
												onclick={() => toggleValidateEntry(entry)}
												class="min-h-9 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-ink"
											>
												{entry.validatedBy ? 'Invalider' : 'Valider'}
											</button>
										{/if}
										{#if canWriteBudget}
											<button
												type="button"
												onclick={() => deleteEntry(entry)}
												class="min-h-9 cursor-pointer rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
											>
												Suppr.
											</button>
										{/if}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		{/if}
	{/if}
</div>

<!-- Modal Ajout écriture avec compression WASM -->
<Modal
	bind:open={addModalOpen}
	title="Nouvelle écriture comptable"
	description="Les justificatifs photo sont automatiquement compressés sur votre appareil (Rust/WASM) avant chiffrement serveur."
	size="md"
>
	<form id="budget-add-form" onsubmit={handleAddEntry} class="space-y-4">
		<div class="grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={() => (formType = 'depense')}
				class={`min-h-11 cursor-pointer rounded-[10px] border text-sm font-bold transition ${
					formType === 'depense'
						? 'border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-300'
						: 'border-border bg-surface text-muted'
				}`}
			>
				Dépense
			</button>
			<button
				type="button"
				onclick={() => (formType = 'recette')}
				class={`min-h-11 cursor-pointer rounded-[10px] border text-sm font-bold transition ${
					formType === 'recette'
						? 'border-emerald-500 bg-emerald-500/15 text-emerald-900 dark:text-emerald-300'
						: 'border-border bg-surface text-muted'
				}`}
			>
				Recette
			</button>
		</div>

		<div>
			<label for="entry-label" class="mb-1 block text-xs font-semibold text-ink">Libellé *</label>
			<input
				id="entry-label"
				type="text"
				required
				minlength="2"
				maxlength="160"
				bind:value={formLabel}
				placeholder="Ex : Achat boissons buvette kermesse"
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="entry-category" class="mb-1 block text-xs font-semibold text-ink">
					Catégorie *
				</label>
				<input
					id="entry-category"
					type="text"
					required
					minlength="2"
					maxlength="60"
					list="budget-category-suggestions"
					bind:value={formCategory}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
				<datalist id="budget-category-suggestions">
					<option value="Billetterie"></option>
					<option value="Cotisations"></option>
					<option value="Subvention"></option>
					<option value="Matériel / Foyer"></option>
					<option value="Prestation / DJ"></option>
					<option value="Alimentation / Buvette"></option>
					<option value="Communication"></option>
					<option value="Fournitures"></option>
				</datalist>
			</div>

			<div>
				<label for="entry-amount" class="mb-1 block text-xs font-semibold text-ink">
					Montant (EUR) *
				</label>
				<input
					id="entry-amount"
					type="number"
					required
					min="0.01"
					step="0.01"
					bind:value={formAmountEuros}
					placeholder="45.90"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="entry-date" class="mb-1 block text-xs font-semibold text-ink">Date *</label>
				<input
					id="entry-date"
					type="date"
					required
					bind:value={formEntryDate}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
			<div>
				<label for="entry-fiscal-year" class="mb-1 block text-xs font-semibold text-ink">
					Exercice *
				</label>
				<input
					id="entry-fiscal-year"
					type="text"
					required
					minlength="4"
					maxlength="16"
					bind:value={formFiscalYear}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
		</div>

		{#if projects.length > 0}
			<div>
				<label for="entry-project" class="mb-1 block text-xs font-semibold text-ink">
					Projet associé (optionnel)
				</label>
				<select
					id="entry-project"
					bind:value={formProjectId}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				>
					<option value="">Hors projet</option>
					{#each projects as proj (proj.id)}
						<option value={String(proj.id)}>{proj.title}</option>
					{/each}
				</select>
			</div>
		{/if}

		<!-- Justificatif avec compression client Rust/WASM -->
		<div class="rounded-[10px] border border-border/80 bg-surface p-3.5 space-y-2.5">
			<label for="entry-receipt-file" class="block text-xs font-semibold text-ink">
				Pièce justificative (Ticket ou facture, photo ou PDF)
			</label>
			<input
				id="entry-receipt-file"
				type="file"
				accept="image/jpeg,image/png,image/webp,application/pdf"
				onchange={handleReceiptInput}
				class="block w-full text-xs text-muted file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-brand-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand file:text-brand-ink"
			/>

			{#if compressingReceipt}
				<p class="text-xs font-medium text-brand" aria-live="polite">
					Compression de l’image en cours (Rust/WASM)...
				</p>
			{:else if receiptStats}
				{@const savedPct = computeGainPercent(receiptStats.originalBytes, receiptStats.compressedBytes)}
				<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs">
					<p class="font-bold text-emerald-800 dark:text-emerald-300">
						{#if receiptStats.isImage}
							Compression client : {formatKo(receiptStats.originalBytes)} → {formatKo(receiptStats.compressedBytes)}
							{#if savedPct > 0}
								(−{savedPct} %)
							{/if}
						{:else}
							PDF prêt : {receiptStats.fileName} ({formatKo(receiptStats.originalBytes)})
						{/if}
					</p>
					{#if receiptPreviewUrl}
						<img
							src={receiptPreviewUrl}
							alt="Aperçu du justificatif compressé"
							class="mt-2 max-h-36 rounded-md border border-border object-contain"
						/>
					{/if}
				</div>
			{/if}
		</div>
	</form>

	{#snippet footer()}
		<Button variant="ghost" onclick={() => (addModalOpen = false)}>Annuler</Button>
		<Button
			type="submit"
			form="budget-add-form"
			variant="primary"
			loading={submittingEntry}
			disabled={compressingReceipt}
		>
			Enregistrer l’écriture
		</Button>
	{/snippet}
</Modal>

<!-- Modal Aperçu justificatif déchiffré -->
<Modal
	bind:open={previewModalOpen}
	title={previewEntry ? `Justificatif · ${previewEntry.label}` : 'Justificatif'}
	size="lg"
>
	{#if previewEntry}
		<div class="space-y-3 text-center">
			<img
				src={`/api/budget/${previewEntry.id}?receipt=1`}
				alt={`Justificatif pour ${previewEntry.label}`}
				class="mx-auto max-h-[65dvh] rounded-[10px] border border-border object-contain"
			/>
		</div>
	{/if}
	{#snippet footer()}
		{#if previewEntry}
			<Button
				href={`/api/budget/${previewEntry.id}?receipt=1`}
				download={`justificatif-${previewEntry.id}`}
				variant="secondary"
			>
				Télécharger le fichier
			</Button>
		{/if}
		<Button variant="primary" onclick={() => (previewModalOpen = false)}>Fermer</Button>
	{/snippet}
</Modal>
