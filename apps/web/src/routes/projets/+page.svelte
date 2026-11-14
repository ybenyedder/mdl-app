<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, daysUntil, formatDateFr, formatEuros } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import { PROJECT_TEMPLATES, type ProjectTemplate } from '$shared/project-templates';
	import type { PageData } from './$types';

	type ProjectStatus = 'brouillon' | 'en_cours' | 'valide' | 'termine' | 'archive';
	type TaskStatus = 'todo' | 'doing' | 'done';

	interface SafetyItem {
		label: string;
		checked: boolean;
	}

	interface ProjectTaskItem {
		id: number;
		projectId: number;
		title: string;
		status: TaskStatus;
		dueDate: string | null;
		assigneeId: number | null;
		position: number;
		createdAt: string;
	}

	interface ProjectMemberItem {
		id: number;
		projectId: number;
		userId: number;
		hoursLogged: number;
		roleInProject: string;
		firstName: string;
		lastName: string;
		classe: string | null;
		role: string;
	}

	interface ProjectItem {
		id: number;
		templateId: string | null;
		title: string;
		description: string;
		category: string;
		eventDate: string | null;
		budgetPlannedCents: number;
		status: ProjectStatus;
		leadUserId: number;
		safetyChecklist: SafetyItem[];
		profValidatedBy: number | null;
		profValidatedAt: string | null;
		createdAt: string;
		tasks: ProjectTaskItem[];
		members: ProjectMemberItem[];
	}

	let { data }: { data: PageData } = $props();

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let projects = $state<ProjectItem[]>([]);

	let activeTab = $state<'liste' | 'kanban' | 'calendrier'>('liste');
	let searchQuery = $state('');
	let statusFilter = $state<'all' | ProjectStatus>('all');

	// Modal nouveau projet
	let createModalOpen = $state(false);
	let selectedTemplateId = $state<string>('libre');
	let formTitle = $state('');
	let formCategory = $state('Vie lycéenne');
	let formDescription = $state('');
	let formEventDate = $state('');
	let formBudgetEuros = $state('0');
	let creating = $state(false);

	const canRead = $derived(data.user ? hasPermission(data.user.role, 'projects:read') : false);
	const canCreate = $derived(data.user ? hasPermission(data.user.role, 'projects:create') : false);
	const canEditAny = $derived(data.user ? hasPermission(data.user.role, 'projects:edit') : false);

	const statusMeta: Record<
		ProjectStatus,
		{ label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' }
	> = {
		brouillon: { label: 'Brouillon', variant: 'neutral' },
		en_cours: { label: 'En cours', variant: 'brand' },
		valide: { label: 'Validé référent', variant: 'success' },
		termine: { label: 'Terminé', variant: 'success' },
		archive: { label: 'Archivé', variant: 'neutral' }
	};

	const columnMeta: Array<{ key: TaskStatus; label: string; tone: string }> = [
		{ key: 'todo', label: 'À faire', tone: 'border-t-slate-400' },
		{ key: 'doing', label: 'En cours', tone: 'border-t-brand' },
		{ key: 'done', label: 'Terminé', tone: 'border-t-emerald-500' }
	];

	async function fetchProjects() {
		if (!data.user || !canRead) {
			loading = false;
			return;
		}
		loading = true;
		loadError = null;
		try {
			const res = await fetch('/api/projects');
			if (res.status === 401) {
				await goto('/connexion');
				return;
			}
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { message?: string }).message || 'Erreur de chargement des projets.');
			}
			const payload = (await res.json()) as { projects: ProjectItem[] };
			projects = payload.projects ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Impossible de charger les projets.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (!data.user) {
			goto('/connexion');
			return;
		}
		void fetchProjects();
	});

	const filteredProjects = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return projects.filter((p) => {
			if (statusFilter !== 'all' && p.status !== statusFilter) return false;
			if (!q) return true;
			return (
				p.title.toLowerCase().includes(q) ||
				p.category.toLowerCase().includes(q) ||
				p.description.toLowerCase().includes(q)
			);
		});
	});

	const allGlobalTasks = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		const list: Array<
			ProjectTaskItem & { projectTitle: string; projectCategory: string; canMove: boolean }
		> = [];
		for (const p of projects) {
			const canMove =
				Boolean(data.user) &&
				(canEditAny || (p.leadUserId === data.user!.id && canCreate));
			for (const t of p.tasks) {
				if (
					q &&
					!t.title.toLowerCase().includes(q) &&
					!p.title.toLowerCase().includes(q)
				) {
					continue;
				}
				list.push({
					...t,
					projectTitle: p.title,
					projectCategory: p.category,
					canMove
				});
			}
		}
		return list;
	});

	const schoolYearMonths = $derived.by(() => {
		const match = /^(\d{4})/.exec(data.settings.schoolYear || '');
		const startYear = match ? Number(match[1]) : new Date().getFullYear();
		const months: Array<{
			key: string;
			label: string;
			year: number;
			monthIndex: number;
			items: Array<{
				kind: 'project' | 'task';
				id: string;
				title: string;
				subtitle: string;
				dateIso: string;
				href: string;
				badge: string;
				variant: 'brand' | 'warning' | 'success' | 'neutral';
			}>;
		}> = [];

		for (let i = 0; i < 12; i += 1) {
			const monthIndex = (8 + i) % 12; // Septembre (8) -> Août (7)
			const year = monthIndex >= 8 ? startYear : startYear + 1;
			const dateObj = new Date(year, monthIndex, 1);
			const rawLabel = new Intl.DateTimeFormat('fr-FR', {
				month: 'long',
				year: 'numeric'
			}).format(dateObj);
			const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
			months.push({
				key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
				label,
				year,
				monthIndex,
				items: []
			});
		}

		const monthByKey = new Map(months.map((m) => [m.key, m]));
		const unscheduled: typeof projects = [];

		for (const p of projects) {
			if (!p.eventDate) {
				unscheduled.push(p);
			} else {
				const d = new Date(p.eventDate);
				if (!Number.isNaN(d.getTime())) {
					const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
					const bucket = monthByKey.get(k);
					if (bucket) {
						bucket.items.push({
							kind: 'project',
							id: `proj-${p.id}`,
							title: p.title,
							subtitle: `${p.category} · Budget ${formatEuros(p.budgetPlannedCents)}`,
							dateIso: p.eventDate,
							href: `/projets/${p.id}`,
							badge: countdownLabel(p.eventDate),
							variant: p.status === 'valide' ? 'success' : 'brand'
						});
					}
				}
			}

			for (const t of p.tasks) {
				if (t.status === 'done' || !t.dueDate) continue;
				const td = new Date(t.dueDate);
				if (Number.isNaN(td.getTime())) continue;
				const k = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}`;
				const bucket = monthByKey.get(k);
				if (bucket) {
					bucket.items.push({
						kind: 'task',
						id: `task-${t.id}`,
						title: t.title,
						subtitle: `Tâche · ${p.title}`,
						dateIso: t.dueDate,
						href: `/projets/${p.id}`,
						badge: countdownLabel(t.dueDate),
						variant: 'warning'
					});
				}
			}
		}

		for (const m of months) {
			m.items.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
		}

		return { months, unscheduled };
	});

	function selectTemplate(tpl: ProjectTemplate | 'libre') {
		if (tpl === 'libre') {
			selectedTemplateId = 'libre';
			formTitle = '';
			formCategory = 'Vie lycéenne';
			formDescription = '';
			formBudgetEuros = '0';
			return;
		}
		selectedTemplateId = tpl.id;
		formTitle = tpl.name;
		formCategory = tpl.category;
		formDescription = tpl.description;
		formBudgetEuros = String(Math.round(tpl.estimatedBudgetCents / 100));
	}

	function openCreateModal() {
		selectTemplate('libre');
		formEventDate = '';
		createModalOpen = true;
	}

	async function handleCreateProject(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;

		const title = formTitle.trim();
		const category = formCategory.trim();
		if (title.length < 3) {
			toast.error('Titre trop court', 'Indiquez un titre d’au moins 3 caractères.');
			return;
		}
		if (category.length < 2) {
			toast.error('Catégorie requise', 'Précisez une catégorie pour ce projet.');
			return;
		}

		const euros = Number.parseFloat(String(formBudgetEuros ?? '').replace(',', '.'));
		const budgetPlannedCents = Number.isFinite(euros) && euros >= 0 ? Math.round(euros * 100) : 0;

		creating = true;
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(selectedTemplateId !== 'libre' ? { templateId: selectedTemplateId } : {}),
					title,
					description: formDescription.trim(),
					category,
					...(formEventDate ? { eventDate: formEventDate } : {}),
					budgetPlannedCents
				})
			});

			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Création impossible.');
			}

			const created = (json as { project: ProjectItem }).project;
			projects = [created, ...projects];
			createModalOpen = false;
			toast.success('Projet créé', `« ${created.title} » est prêt dans le Kanban.`);
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Échec de la création.');
		} finally {
			creating = false;
		}
	}

	async function moveGlobalTask(task: ProjectTaskItem, nextStatus: TaskStatus) {
		if (task.status === nextStatus) return;
		const previous = projects.map((p) => ({ ...p, tasks: [...p.tasks] }));

		// Mise à jour optimiste immédiate
		projects = projects.map((p) =>
			p.id === task.projectId
				? {
						...p,
						tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t))
					}
				: p
		);

		try {
			const res = await fetch(`/api/projects/${task.projectId}/tasks`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ taskId: task.id, status: nextStatus })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { message?: string }).message || 'Mise à jour refusée.');
			}
		} catch (err) {
			projects = previous;
			toast.error(
				'Déplacement annulé',
				err instanceof Error ? err.message : 'Impossible de déplacer cette tâche.'
			);
		}
	}

	const activeTemplate = $derived(
		selectedTemplateId === 'libre'
			? null
			: (PROJECT_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? null)
	);
</script>

<svelte:head>
	<title>Projets & Kanban · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-7">
	<!-- En-tête -->
	<header class="animate-spring flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Projets & Kanban
			</h1>
			<p class="mt-1 text-sm text-muted">
				Événements, checklists sécurité et rétroplannings {data.settings.schoolYear}.
			</p>
		</div>
		{#if canCreate}
			<Button variant="primary" size="md" onclick={openCreateModal}>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
				</svg>
				Nouveau projet
			</Button>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg">
			<p class="text-sm text-muted">Redirection vers la page de connexion...</p>
		</Card>
	{:else if !canRead}
		<Card padding="lg">
			<h2 class="text-lg font-bold text-ink">Accès restreint</h2>
			<p class="mt-1 text-sm text-muted">
				Votre rôle actuel ne permet pas de consulter les projets de la MDL.
			</p>
		</Card>
	{:else}
		<!-- Contrôle segmenté + filtres rapides -->
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div
				role="tablist"
				aria-label="Vues des projets"
				class="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-2 p-0.5 sm:inline-flex"
			>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'liste'}
					onclick={() => (activeTab = 'liste')}
					class={`gpu-press min-h-9.5 shrink-0 cursor-pointer rounded-[8px] px-4 py-1.5 text-[13px] font-semibold transition ${
						activeTab === 'liste'
							? 'bg-card text-ink apple-shadow-card'
							: 'text-muted hover:text-ink'
					}`}
				>
					Liste ({filteredProjects.length})
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'kanban'}
					onclick={() => (activeTab = 'kanban')}
					class={`gpu-press min-h-9.5 shrink-0 cursor-pointer rounded-[8px] px-4 py-1.5 text-[13px] font-semibold transition ${
						activeTab === 'kanban'
							? 'bg-card text-ink apple-shadow-card'
							: 'text-muted hover:text-ink'
					}`}
				>
					Kanban ({allGlobalTasks.length})
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'calendrier'}
					onclick={() => (activeTab = 'calendrier')}
					class={`gpu-press min-h-9.5 shrink-0 cursor-pointer rounded-[8px] px-4 py-1.5 text-[13px] font-semibold transition ${
						activeTab === 'calendrier'
							? 'bg-card text-ink apple-shadow-card'
							: 'text-muted hover:text-ink'
					}`}
				>
					Calendrier
				</button>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<label class="sr-only" for="project-search">Rechercher un projet ou une tâche</label>
				<input
					id="project-search"
					type="search"
					bind:value={searchQuery}
					placeholder="Rechercher..."
					class="min-h-11 w-full rounded-2xl border border-border bg-card px-3.5 py-2 text-base text-ink placeholder:text-muted sm:min-h-10 sm:w-52 sm:text-sm"
				/>
				{#if activeTab === 'liste'}
					<label class="sr-only" for="project-status-filter">Filtrer par statut</label>
					<select
						id="project-status-filter"
						bind:value={statusFilter}
						class="min-h-11 rounded-2xl border border-border bg-card px-3.5 py-2 text-base text-ink sm:min-h-10 sm:text-sm"
					>
						<option value="all">Tous les statuts</option>
						<option value="brouillon">Brouillon</option>
						<option value="en_cours">En cours</option>
						<option value="valide">Validé référent</option>
						<option value="termine">Terminé</option>
						<option value="archive">Archivé</option>
					</select>
				{/if}
			</div>
		</div>

		{#if loading}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Skeleton variant="card" height="11rem" />
				<Skeleton variant="card" height="11rem" />
				<Skeleton variant="card" height="11rem" />
			</div>
		{:else if loadError}
			<Card padding="md">
				<p class="text-sm font-semibold text-red-700 dark:text-red-300">{loadError}</p>
				<Button variant="secondary" size="sm" class="mt-3" onclick={fetchProjects}>Réessayer</Button>
			</Card>
		{:else if activeTab === 'liste'}
			{#if filteredProjects.length === 0}
				<Card padding="lg" class="text-center">
					<p class="text-base font-bold text-ink">Aucun projet trouvé</p>
					<p class="mt-1 text-sm text-muted">
						Démarrez à partir d’un des 11 modèles prêts à l’emploi ou créez un projet libre.
					</p>
					{#if canCreate}
						<Button variant="primary" size="md" class="mt-4" onclick={openCreateModal}>
							Créer un projet
						</Button>
					{/if}
				</Card>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredProjects as project (project.id)}
						{@const st = statusMeta[project.status] ?? { label: project.status, variant: 'neutral' }}
						{@const doneTasks = project.tasks.filter((t) => t.status === 'done').length}
						{@const totalTasks = project.tasks.length}
						{@const checkedSafety = project.safetyChecklist.filter((s) => s.checked).length}
						{@const totalSafety = project.safetyChecklist.length}
						{@const days = daysUntil(project.eventDate)}

						<Card hover padding="md" class="flex flex-col justify-between gap-4">
							<div class="space-y-2.5">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<Badge variant={st.variant} size="sm" dot>{st.label}</Badge>
									<Badge variant={days !== null && days >= 0 && days <= 7 ? 'warning' : 'brand'} size="sm">
										{countdownLabel(project.eventDate)}
									</Badge>
								</div>

								<div>
									<p class="text-xs font-semibold text-brand-ink">{project.category}</p>
									<h2 class="mt-0.5 text-lg font-bold leading-snug text-ink">{project.title}</h2>
									{#if project.description}
										<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
											{project.description}
										</p>
									{/if}
								</div>
							</div>

							<div class="space-y-3 border-t border-border/70 pt-3">
								<div class="grid grid-cols-2 gap-2 text-xs">
									<div>
										<span class="text-muted">Échéance</span>
										<p class="font-semibold text-ink">{formatDateFr(project.eventDate)}</p>
									</div>
									<div>
										<span class="text-muted">Budget prévu</span>
										<p class="font-semibold text-ink">{formatEuros(project.budgetPlannedCents)}</p>
									</div>
								</div>

								<div class="space-y-1.5">
									<div class="flex items-center justify-between text-xs text-muted">
										<span>Tâches ({doneTasks}/{totalTasks})</span>
										<span>Sécurité ({checkedSafety}/{totalSafety})</span>
									</div>
									<div class="h-1.5 w-full overflow-hidden rounded-full bg-surface">
										<div
											class="h-full rounded-full bg-brand transition-all duration-300"
											style={`width: ${totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%`}
										></div>
									</div>
								</div>

								<Button href={`/projets/${project.id}`} variant="secondary" size="sm" fullWidth>
									Ouvrir le Kanban & checklist
								</Button>
							</div>
						</Card>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'kanban'}
			<div class="grid gap-4 lg:grid-cols-3">
				{#each columnMeta as col (col.key)}
					{@const colTasks = allGlobalTasks.filter((t) => t.status === col.key)}
					<section
						aria-label={`Colonne ${col.label}`}
						class={`rounded-[var(--radius-card)] border border-border border-t-4 ${col.tone} bg-card p-4`}
					>
						<div class="mb-3 flex items-center justify-between">
							<h2 class="text-base font-bold text-ink">{col.label}</h2>
							<Badge variant="neutral" size="sm">{colTasks.length}</Badge>
						</div>

						{#if colTasks.length === 0}
							<p class="rounded-[10px] border border-border/80 p-4 text-center text-xs text-muted">
								Aucune tâche dans cette colonne.
							</p>
						{:else}
							<ul class="space-y-2.5">
								{#each colTasks as task (task.id)}
									{@const d = daysUntil(task.dueDate)}
									<li class="rounded-[10px] border border-border bg-surface p-3 space-y-2">
										<div class="flex items-start justify-between gap-2">
											<a
												href={`/projets/${task.projectId}`}
												class="text-xs font-semibold text-brand hover:underline text-brand-ink"
											>
												{task.projectTitle}
											</a>
											{#if task.dueDate}
												<Badge variant={d !== null && d < 0 ? 'danger' : d !== null && d <= 5 ? 'warning' : 'neutral'} size="sm">
													{countdownLabel(task.dueDate)}
												</Badge>
											{/if}
										</div>
										<p class="text-sm font-semibold text-ink">{task.title}</p>
										{#if task.canMove}
											<div class="flex flex-wrap gap-1.5 pt-1">
												{#if col.key !== 'todo'}
													<button
														type="button"
														onclick={() => moveGlobalTask(task, 'todo')}
														class="min-h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-soft"
													>
														← À faire
													</button>
												{/if}
												{#if col.key !== 'doing'}
													<button
														type="button"
														onclick={() => moveGlobalTask(task, 'doing')}
														class="min-h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-soft"
													>
														En cours
													</button>
												{/if}
												{#if col.key !== 'done'}
													<button
														type="button"
														onclick={() => moveGlobalTask(task, 'done')}
														class="min-h-8 cursor-pointer rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-300"
													>
														Terminer ✓
													</button>
												{/if}
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>
		{:else}
			<!-- Calendrier annuel (Septembre -> Août) -->
			<div class="space-y-5">
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each schoolYearMonths.months as month (month.key)}
						<Card padding="sm" class="flex flex-col gap-2.5">
							<div class="flex items-center justify-between border-b border-border/70 pb-2">
								<h2 class="text-sm font-bold text-ink">{month.label}</h2>
								<Badge variant={month.items.length > 0 ? 'brand' : 'neutral'} size="sm">
									{month.items.length}
								</Badge>
							</div>
							{#if month.items.length === 0}
								<p class="py-3 text-center text-xs text-muted">Aucune échéance prévue</p>
							{:else}
								<ul class="space-y-2">
									{#each month.items as item (item.id)}
										<li>
											<a
												href={item.href}
												class="flex items-start justify-between gap-2 rounded-[10px] border border-border/80 bg-surface p-2.5 transition hover:border-brand/40"
											>
												<div class="min-w-0">
													<p class="truncate text-xs font-bold text-ink">{item.title}</p>
													<p class="truncate text-[11px] text-muted">
														{formatDateFr(item.dateIso)} · {item.subtitle}
													</p>
												</div>
												<Badge variant={item.variant} size="sm">{item.badge}</Badge>
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</Card>
					{/each}
				</div>

				{#if schoolYearMonths.unscheduled.length > 0}
					<Card padding="md">
						<h2 class="text-base font-bold text-ink">Projets sans date fixée</h2>
						<div class="mt-3 flex flex-wrap gap-2">
							{#each schoolYearMonths.unscheduled as proj (proj.id)}
								<Button href={`/projets/${proj.id}`} variant="secondary" size="sm">
									{proj.title} ({proj.category})
								</Button>
							{/each}
						</div>
					</Card>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Modal Création de projet (11 modèles ou libre) -->
<Modal
	bind:open={createModalOpen}
	title="Nouveau projet MDL"
	description="Choisissez l’un des 11 modèles pré-remplis (tâches + checklist sécurité) ou lancez un projet libre."
	size="lg"
>
	<form id="create-project-form" onsubmit={handleCreateProject} class="space-y-5">
		<div>
			<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
				Modèles disponibles ({PROJECT_TEMPLATES.length} + projet libre)
			</p>
			<div class="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
				<button
					type="button"
					onclick={() => selectTemplate('libre')}
					class={`cursor-pointer rounded-[10px] border p-3 text-left transition ${
						selectedTemplateId === 'libre'
							? 'border-brand bg-brand-soft/60 ring-1 ring-brand'
							: 'border-border bg-surface hover:border-brand/40'
					}`}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm font-bold text-ink">Projet libre</span>
						<Badge variant="neutral" size="sm">Personnalisé</Badge>
					</div>
					<p class="mt-1 text-xs text-muted">Définissez vous-même le titre, le budget et les tâches.</p>
				</button>

				{#each PROJECT_TEMPLATES as tpl (tpl.id)}
					<button
						type="button"
						onclick={() => selectTemplate(tpl)}
						class={`cursor-pointer rounded-[10px] border p-3 text-left transition ${
							selectedTemplateId === tpl.id
								? 'border-brand bg-brand-soft/60 ring-1 ring-brand'
								: 'border-border bg-surface hover:border-brand/40'
						}`}
					>
						<div class="flex items-center justify-between gap-2">
							<span class="text-sm font-bold text-ink">{tpl.name}</span>
							<Badge variant="brand" size="sm">{formatEuros(tpl.estimatedBudgetCents)}</Badge>
						</div>
						<p class="mt-0.5 text-[11px] font-medium text-muted">
							{tpl.category} · {tpl.defaultTasks.length} tâches · {tpl.safetyChecklist.length} points sécu
						</p>
					</button>
				{/each}
			</div>
		</div>

		{#if activeTemplate}
			<div class="rounded-[10px] border border-brand/25 bg-brand-soft/40 p-3 text-xs">
				<p class="font-bold text-ink">Inclus avec le modèle « {activeTemplate.name} » :</p>
				<p class="mt-1 text-muted">
					{activeTemplate.defaultTasks.length} tâches rétroplanning générées automatiquement et {activeTemplate.safetyChecklist.length} vérifications sécurité.
				</p>
			</div>
		{/if}

		<div class="grid gap-3.5 sm:grid-cols-2">
			<div class="sm:col-span-2">
				<label for="new-proj-title" class="mb-1 block text-xs font-semibold text-ink">
					Titre du projet *
				</label>
				<input
					id="new-proj-title"
					type="text"
					required
					minlength="3"
					maxlength="120"
					bind:value={formTitle}
					placeholder="Ex : Soirée d’hiver du lycée"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>

			<div>
				<label for="new-proj-category" class="mb-1 block text-xs font-semibold text-ink">
					Catégorie *
				</label>
				<input
					id="new-proj-category"
					type="text"
					required
					minlength="2"
					maxlength="60"
					bind:value={formCategory}
					placeholder="Ex : Événement festif"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>

			<div>
				<label for="new-proj-date" class="mb-1 block text-xs font-semibold text-ink">
					Date cible de l’événement
				</label>
				<input
					id="new-proj-date"
					type="date"
					bind:value={formEventDate}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>

			<div>
				<label for="new-proj-budget" class="mb-1 block text-xs font-semibold text-ink">
					Budget prévisionnel (EUR)
				</label>
				<input
					id="new-proj-budget"
					type="number"
					min="0"
					step="1"
					bind:value={formBudgetEuros}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>

			<div class="sm:col-span-2">
				<label for="new-proj-desc" class="mb-1 block text-xs font-semibold text-ink">
					Description & objectifs
				</label>
				<textarea
					id="new-proj-desc"
					rows="3"
					maxlength="2000"
					bind:value={formDescription}
					placeholder="Public visé, lieu envisagé, besoins logistiques..."
					class="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
				></textarea>
			</div>
		</div>
	</form>

	{#snippet footer()}
		<Button variant="ghost" onclick={() => (createModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-project-form" variant="primary" loading={creating}>
			Créer le projet
		</Button>
	{/snippet}
</Modal>
