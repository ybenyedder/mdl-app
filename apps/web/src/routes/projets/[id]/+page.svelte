<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, daysUntil, formatDateFr, formatDateTimeFr, formatEuros } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
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

	interface ProjectDetail {
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

	const projectId = $derived(page.params.id);

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let project = $state<ProjectDetail | null>(null);

	// Ajout tâche
	let newTaskTitle = $state('');
	let newTaskStatus = $state<TaskStatus>('todo');
	let newTaskDueDate = $state('');
	let addingTask = $state(false);

	// Ajout point sécurité
	let newSafetyLabel = $state('');
	let savingSafety = $state(false);
	let validatingProf = $state(false);
	let updatingStatus = $state(false);

	// Modal édition projet
	let editModalOpen = $state(false);
	let editTitle = $state('');
	let editCategory = $state('');
	let editDescription = $state('');
	let editEventDate = $state('');
	let editBudgetEuros = $state('0');
	let savingEdit = $state(false);

	// Drag-and-drop desktop
	let draggedTaskId = $state<number | null>(null);

	const canEdit = $derived.by(() => {
		if (!data.user || !project) return false;
		return (
			hasPermission(data.user.role, 'projects:edit') ||
			(project.leadUserId === data.user.id && hasPermission(data.user.role, 'projects:create'))
		);
	});

	const canValidateProf = $derived(
		data.user ? hasPermission(data.user.role, 'projects:validate') : false
	);

	const columns: Array<{ key: TaskStatus; label: string; tone: string }> = [
		{ key: 'todo', label: 'À faire', tone: 'border-t-slate-400' },
		{ key: 'doing', label: 'En cours', tone: 'border-t-brand' },
		{ key: 'done', label: 'Terminé', tone: 'border-t-emerald-500' }
	];

	const statusBadgeMap: Record<
		ProjectStatus,
		{ label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' }
	> = {
		brouillon: { label: 'Brouillon', variant: 'neutral' },
		en_cours: { label: 'En cours', variant: 'brand' },
		valide: { label: 'Validé référent', variant: 'success' },
		termine: { label: 'Terminé', variant: 'success' },
		archive: { label: 'Archivé', variant: 'neutral' }
	};

	async function loadProject() {
		if (!data.user) {
			loading = false;
			return;
		}
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`/api/projects/${projectId}`);
			if (res.status === 401) {
				await goto('/connexion');
				return;
			}
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Projet introuvable.');
			}
			project = (json as { project: ProjectDetail }).project;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Erreur de chargement du projet.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (!data.user) {
			goto('/connexion');
			return;
		}
		void loadProject();
	});

	async function handleAddTask(event: SubmitEvent) {
		event.preventDefault();
		if (!project || addingTask) return;
		const title = newTaskTitle.trim();
		if (title.length < 2) {
			toast.error('Titre invalide', 'Saisissez au moins 2 caractères.');
			return;
		}

		addingTask = true;
		const tempId = -Date.now();
		const optimisticTask: ProjectTaskItem = {
			id: tempId,
			projectId: project.id,
			title,
			status: newTaskStatus,
			dueDate: newTaskDueDate || null,
			assigneeId: data.user?.id ?? null,
			position: project.tasks.length,
			createdAt: new Date().toISOString()
		};

		const prevTasks = [...project.tasks];
		project.tasks = [...project.tasks, optimisticTask];
		newTaskTitle = '';
		newTaskDueDate = '';

		try {
			const res = await fetch(`/api/projects/${project.id}/tasks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title,
					status: optimisticTask.status,
					...(optimisticTask.dueDate ? { dueDate: optimisticTask.dueDate } : {})
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Ajout refusé.');
			}
			const created = (json as { task: ProjectTaskItem }).task;
			project.tasks = project.tasks.map((t) => (t.id === tempId ? created : t));
			toast.success('Tâche ajoutée', created.title);
		} catch (err) {
			project.tasks = prevTasks;
			toast.error('Erreur', err instanceof Error ? err.message : 'Impossible d’ajouter la tâche.');
		} finally {
			addingTask = false;
		}
	}

	async function moveTask(task: ProjectTaskItem, nextStatus: TaskStatus) {
		if (!project || task.status === nextStatus || !canEdit) return;
		const prevTasks = [...project.tasks];

		// État optimiste immédiat
		project.tasks = project.tasks.map((t) =>
			t.id === task.id ? { ...t, status: nextStatus } : t
		);

		try {
			const res = await fetch(`/api/projects/${project.id}/tasks`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ taskId: task.id, status: nextStatus })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Déplacement refusé.');
			}
			const updated = (json as { task: ProjectTaskItem }).task;
			project.tasks = project.tasks.map((t) => (t.id === updated.id ? updated : t));
		} catch (err) {
			project.tasks = prevTasks;
			toast.error(
				'Déplacement annulé',
				err instanceof Error ? err.message : 'Impossible de mettre à jour la tâche.'
			);
		}
	}

	async function deleteTask(task: ProjectTaskItem) {
		if (!project || !canEdit) return;
		const prevTasks = [...project.tasks];
		project.tasks = project.tasks.filter((t) => t.id !== task.id);

		try {
			const res = await fetch(`/api/projects/${project.id}/tasks`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ taskId: task.id })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { message?: string }).message || 'Suppression refusée.');
			}
			toast.info('Tâche supprimée', task.title);
		} catch (err) {
			project.tasks = prevTasks;
			toast.error(
				'Suppression annulée',
				err instanceof Error ? err.message : 'Impossible de supprimer la tâche.'
			);
		}
	}

	async function toggleSafetyItem(index: number) {
		if (!project || !canEdit || savingSafety) return;
		const prev = project.safetyChecklist.map((item) => ({ ...item }));
		const updated = prev.map((item, idx) =>
			idx === index ? { ...item, checked: !item.checked } : item
		);

		project.safetyChecklist = updated;
		savingSafety = true;

		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ safetyChecklist: updated })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Mise à jour refusée.');
			}
			const patched = (json as { project: Partial<ProjectDetail> }).project;
			if (patched.safetyChecklist) {
				project.safetyChecklist = patched.safetyChecklist;
			}
		} catch (err) {
			project.safetyChecklist = prev;
			toast.error(
				'Checklist non enregistrée',
				err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.'
			);
		} finally {
			savingSafety = false;
		}
	}

	async function addSafetyItem(event: SubmitEvent) {
		event.preventDefault();
		if (!project || !canEdit || savingSafety) return;
		const label = newSafetyLabel.trim();
		if (!label) return;

		const prev = [...project.safetyChecklist];
		const updated = [...prev, { label, checked: false }];
		project.safetyChecklist = updated;
		newSafetyLabel = '';
		savingSafety = true;

		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ safetyChecklist: updated })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error((err as { message?: string }).message || 'Ajout refusé.');
			}
		} catch (err) {
			project.safetyChecklist = prev;
			toast.error('Erreur', err instanceof Error ? err.message : 'Ajout impossible.');
		} finally {
			savingSafety = false;
		}
	}

	async function validateByProf() {
		if (!project || !canValidateProf || validatingProf) return;
		validatingProf = true;
		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ validateProf: true })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Validation refusée.');
			}
			const updated = (json as { project: Partial<ProjectDetail> }).project;
			project = { ...project, ...updated };
			toast.success(
				'Projet validé',
				'La validation du professeur référent a été enregistrée dans le journal d’audit.'
			);
		} catch (err) {
			toast.error('Validation impossible', err instanceof Error ? err.message : 'Erreur réseau.');
		} finally {
			validatingProf = false;
		}
	}

	async function changeProjectStatus(nextStatus: ProjectStatus) {
		if (!project || !canEdit || updatingStatus || project.status === nextStatus) return;
		updatingStatus = true;
		const prevStatus = project.status;
		project.status = nextStatus;
		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Statut refusé.');
			}
			const updated = (json as { project: Partial<ProjectDetail> }).project;
			project = { ...project, ...updated };
			toast.success('Statut mis à jour', statusBadgeMap[nextStatus]?.label ?? nextStatus);
		} catch (err) {
			project.status = prevStatus;
			toast.error('Erreur', err instanceof Error ? err.message : 'Mise à jour refusée.');
		} finally {
			updatingStatus = false;
		}
	}

	function openEditModal() {
		if (!project) return;
		editTitle = project.title;
		editCategory = project.category;
		editDescription = project.description;
		editEventDate = project.eventDate ? project.eventDate.slice(0, 10) : '';
		editBudgetEuros = String(Math.round(project.budgetPlannedCents / 100));
		editModalOpen = true;
	}

	async function handleSaveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!project || savingEdit) return;
		savingEdit = true;
		const euros = Number.parseFloat(String(editBudgetEuros ?? '').replace(',', '.'));
		const budgetPlannedCents = Number.isFinite(euros) && euros >= 0 ? Math.round(euros * 100) : 0;

		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: editTitle.trim(),
					category: editCategory.trim(),
					description: editDescription.trim(),
					eventDate: editEventDate || null,
					budgetPlannedCents
				})
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((json as { message?: string }).message || 'Modification refusée.');
			}
			const updated = (json as { project: Partial<ProjectDetail> }).project;
			project = { ...project, ...updated };
			editModalOpen = false;
			toast.success('Projet modifié', 'Les informations ont été enregistrées.');
		} catch (err) {
			toast.error('Erreur', err instanceof Error ? err.message : 'Sauvegarde impossible.');
		} finally {
			savingEdit = false;
		}
	}

	function handleDrop(targetStatus: TaskStatus) {
		if (draggedTaskId === null || !project) return;
		const task = project.tasks.find((t) => t.id === draggedTaskId);
		draggedTaskId = null;
		if (task && task.status !== targetStatus) {
			void moveTask(task, targetStatus);
		}
	}
</script>

<svelte:head>
	<title>{project ? project.title : 'Détail projet'} · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-7">
	<div>
		<a
			href="/projets"
			class="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand hover:text-brand-ink"
		>
			<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
			</svg>
			Retour aux projets
		</a>
	</div>

	{#if loading}
		<div class="space-y-4">
			<Skeleton variant="card" height="9rem" />
			<div class="grid gap-4 lg:grid-cols-3">
				<Skeleton variant="card" height="16rem" />
				<Skeleton variant="card" height="16rem" />
				<Skeleton variant="card" height="16rem" />
			</div>
		</div>
	{:else if loadError || !project}
		<Card padding="lg">
			<h1 class="text-lg font-bold text-ink">Projet inaccessible</h1>
			<p class="mt-1 text-sm text-muted">{loadError || 'Ce projet n’existe pas.'}</p>
			<Button href="/projets" variant="secondary" size="sm" class="mt-4">
				Revenir à la liste
			</Button>
		</Card>
	{:else}
		{@const st = statusBadgeMap[project.status] ?? { label: project.status, variant: 'neutral' }}
		{@const days = daysUntil(project.eventDate)}
		{@const safetyDone = project.safetyChecklist.filter((i) => i.checked).length}
		{@const safetyTotal = project.safetyChecklist.length}

		<!-- En-tête projet avec compte à rebours J-x -->
		<section class="rounded-[var(--radius-card)] border border-border bg-card p-5 apple-shadow-card sm:p-6">
			<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div class="space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						<Badge variant={st.variant} dot>{st.label}</Badge>
						<Badge variant="neutral">{project.category}</Badge>
						<Badge variant={days !== null && days >= 0 && days <= 7 ? 'warning' : 'brand'}>
							{countdownLabel(project.eventDate)}
						</Badge>
						{#if project.profValidatedAt}
							<Badge variant="success">
								Validé référent le {formatDateFr(project.profValidatedAt)}
							</Badge>
						{/if}
					</div>
					<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
						{project.title}
					</h1>
					{#if project.description}
						<p class="max-w-3xl text-sm leading-relaxed text-muted">{project.description}</p>
					{/if}
					<div class="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-muted">
						<span>
							Date cible : <strong class="text-ink">{formatDateFr(project.eventDate)}</strong>
						</span>
						<span>
							Budget prévu : <strong class="text-ink">{formatEuros(project.budgetPlannedCents)}</strong>
						</span>
						<span>
							Checklist sécurité : <strong class="text-ink">{safetyDone}/{safetyTotal}</strong>
						</span>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					{#if canValidateProf && !project.profValidatedAt}
						<Button variant="primary" size="md" loading={validatingProf} onclick={validateByProf}>
							Valider ce projet (Professeur référent)
						</Button>
					{/if}
					{#if canEdit}
						<Button variant="secondary" size="md" onclick={openEditModal}>Modifier</Button>
						<label class="sr-only" for="project-status-select">Statut du projet</label>
						<select
							id="project-status-select"
							value={project.status}
							disabled={updatingStatus}
							onchange={(e) => changeProjectStatus((e.currentTarget as HTMLSelectElement).value as ProjectStatus)}
							class="min-h-11 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink"
						>
							<option value="brouillon">Brouillon</option>
							<option value="en_cours">En cours</option>
							{#if canValidateProf || project.status === 'valide'}
								<option value="valide">Validé</option>
							{/if}
							<option value="termine">Terminé</option>
							<option value="archive">Archivé</option>
						</select>
					{/if}
				</div>
			</div>
		</section>

		<!-- Formulaire ajout tâche + tableau 3 colonnes -->
		<section aria-labelledby="kanban-heading" class="space-y-4">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 id="kanban-heading" class="text-xl font-bold text-ink">Tableau des tâches</h2>
					<p class="text-xs text-muted">
						Déplacement instantané entre colonnes (boutons accessibles ou glisser-déposer).
					</p>
				</div>
			</div>

			{#if canEdit}
				<Card padding="sm">
					<form onsubmit={handleAddTask} class="flex flex-col gap-2.5 sm:flex-row sm:items-end">
						<div class="flex-1">
							<label for="task-title-input" class="mb-1 block text-xs font-semibold text-ink">
								Nouvelle tâche
							</label>
							<input
								id="task-title-input"
								type="text"
								required
								minlength="2"
								maxlength="160"
								bind:value={newTaskTitle}
								placeholder="Ex : Contacter le traiteur pour devis..."
								class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
							/>
						</div>
						<div>
							<label for="task-col-select" class="mb-1 block text-xs font-semibold text-ink">
								Colonne
							</label>
							<select
								id="task-col-select"
								bind:value={newTaskStatus}
								class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
							>
								<option value="todo">À faire</option>
								<option value="doing">En cours</option>
								<option value="done">Terminé</option>
							</select>
						</div>
						<div>
							<label for="task-due-input" class="mb-1 block text-xs font-semibold text-ink">
								Échéance
							</label>
							<input
								id="task-due-input"
								type="date"
								bind:value={newTaskDueDate}
								class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
							/>
						</div>
						<Button type="submit" variant="primary" size="md" loading={addingTask}>
							Ajouter
						</Button>
					</form>
				</Card>
			{/if}

			<div class="grid gap-4 lg:grid-cols-3">
				{#each columns as col (col.key)}
					{@const colTasks = project.tasks.filter((t) => t.status === col.key)}
					<div
						role="region"
						aria-label={`Colonne ${col.label}`}
						ondragover={(e) => {
							if (canEdit) e.preventDefault();
						}}
						ondrop={() => handleDrop(col.key)}
						class={`rounded-[var(--radius-card)] border border-border border-t-4 ${col.tone} bg-card p-4 transition`}
					>
						<div class="mb-3 flex items-center justify-between">
							<h3 class="text-base font-bold text-ink">{col.label}</h3>
							<Badge variant="neutral" size="sm">{colTasks.length}</Badge>
						</div>

						{#if colTasks.length === 0}
							<p class="rounded-[10px] border border-border/80 p-5 text-center text-xs text-muted">
								Aucune tâche ici
							</p>
						{:else}
							<ul class="space-y-2.5">
								{#each colTasks as task (task.id)}
									{@const td = daysUntil(task.dueDate)}
									<li
										draggable={canEdit && task.id > 0}
										ondragstart={() => (draggedTaskId = task.id)}
										ondragend={() => (draggedTaskId = null)}
										class="rounded-[10px] border border-border bg-surface p-3 space-y-2"
									>
										<div class="flex items-start justify-between gap-2">
											<p class="text-sm font-semibold leading-snug text-ink">{task.title}</p>
											{#if canEdit && task.id > 0}
												<button
													type="button"
													onclick={() => deleteTask(task)}
													aria-label={`Supprimer la tâche ${task.title}`}
													class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-red-500/10 hover:text-red-600"
												>
													<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
														<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
													</svg>
												</button>
											{/if}
										</div>

										{#if task.dueDate}
											<div class="flex items-center gap-2 text-xs text-muted">
												<span>Échéance : {formatDateFr(task.dueDate)}</span>
												<Badge
													variant={td !== null && td < 0 && col.key !== 'done' ? 'danger' : td !== null && td <= 5 && col.key !== 'done' ? 'warning' : 'neutral'}
													size="sm"
												>
													{countdownLabel(task.dueDate)}
												</Badge>
											</div>
										{/if}

										{#if canEdit && task.id > 0}
											<div class="flex flex-wrap gap-1.5 pt-1">
												{#if col.key !== 'todo'}
													<button
														type="button"
														onclick={() => moveTask(task, 'todo')}
														class="min-h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-soft"
													>
														← À faire
													</button>
												{/if}
												{#if col.key !== 'doing'}
													<button
														type="button"
														onclick={() => moveTask(task, 'doing')}
														class="min-h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-soft"
													>
														{col.key === 'todo' ? 'Démarrer →' : '← En cours'}
													</button>
												{/if}
												{#if col.key !== 'done'}
													<button
														type="button"
														onclick={() => moveTask(task, 'done')}
														class="min-h-8 cursor-pointer rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-300"
													>
														Terminer
													</button>
												{/if}
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		<!-- Checklist sécurité interactive + Équipe -->
		<div class="grid gap-6 lg:grid-cols-3">
			<Card padding="md" class="lg:col-span-2">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-lg font-bold text-ink">Checklist sécurité & conformité</h2>
						<p class="text-xs text-muted">
							Indispensable avant la validation par le professeur référent ou le chef d’établissement.
						</p>
					</div>
					<Badge variant={safetyTotal > 0 && safetyDone === safetyTotal ? 'success' : 'warning'}>
						{safetyDone}/{safetyTotal} validés
					</Badge>
				</div>

				{#if project.safetyChecklist.length === 0}
					<p class="rounded-[10px] border border-border/80 p-4 text-center text-sm text-muted">
						Aucun point de sécurité défini pour ce projet.
					</p>
				{:else}
					<ul class="space-y-2">
						{#each project.safetyChecklist as item, idx (idx)}
							<li>
								<label
									class={`flex min-h-11 items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-sm transition ${
										item.checked
											? 'border-emerald-500/30 bg-emerald-500/8 text-ink'
											: 'border-border bg-surface text-ink'
									} ${canEdit ? 'cursor-pointer hover:border-brand/40' : ''}`}
								>
									<input
										type="checkbox"
										checked={item.checked}
										disabled={!canEdit}
										onchange={() => toggleSafetyItem(idx)}
										class="size-5 rounded border-border accent-brand"
									/>
									<span class={item.checked ? 'line-through opacity-80' : 'font-medium'}>
										{item.label}
									</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}

				{#if canEdit}
					<form onsubmit={addSafetyItem} class="mt-4 flex gap-2">
						<label class="sr-only" for="new-safety-item">Ajouter un point sécurité</label>
						<input
							id="new-safety-item"
							type="text"
							maxlength="200"
							bind:value={newSafetyLabel}
							placeholder="Ajouter un point sécurité (ex : Extincteur vérifié)..."
							class="min-h-10 flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
						/>
						<Button type="submit" variant="secondary" size="sm" disabled={savingSafety}>
							Ajouter
						</Button>
					</form>
				{/if}
			</Card>

			<Card padding="md">
				<h2 class="text-lg font-bold text-ink">Équipe projet</h2>
				<p class="mt-0.5 text-xs text-muted">Membres impliqués et suivi d’engagement</p>

				{#if project.members.length === 0}
					<p class="mt-4 text-sm text-muted">Aucun membre enregistré.</p>
				{:else}
					<ul class="mt-4 space-y-2.5">
						{#each project.members as member (member.id)}
							<li class="flex items-center justify-between gap-2 rounded-[10px] border border-border bg-surface p-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-bold text-ink">
										{member.firstName} {member.lastName}
									</p>
									<p class="text-xs text-muted">
										{member.roleInProject}{member.classe ? ` · ${member.classe}` : ''}
									</p>
								</div>
								<Badge variant="neutral" size="sm">{member.hoursLogged} h</Badge>
							</li>
						{/each}
					</ul>
				{/if}

				{#if project.profValidatedAt}
					<div class="mt-4 rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
						<p class="font-bold">Validation référent enregistrée</p>
						<p class="mt-0.5">Le {formatDateTimeFr(project.profValidatedAt)}</p>
					</div>
				{:else if canValidateProf}
					<div class="mt-4">
						<Button variant="primary" fullWidth loading={validatingProf} onclick={validateByProf}>
							Valider ce projet (Référent)
						</Button>
					</div>
				{/if}
			</Card>
		</div>
	{/if}
</div>

<Modal bind:open={editModalOpen} title="Modifier le projet" size="md">
	<form id="edit-project-form" onsubmit={handleSaveEdit} class="space-y-3.5">
		<div>
			<label for="edit-proj-title" class="mb-1 block text-xs font-semibold text-ink">Titre</label>
			<input
				id="edit-proj-title"
				type="text"
				required
				minlength="3"
				maxlength="120"
				bind:value={editTitle}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="edit-proj-cat" class="mb-1 block text-xs font-semibold text-ink">Catégorie</label>
				<input
					id="edit-proj-cat"
					type="text"
					required
					minlength="2"
					maxlength="60"
					bind:value={editCategory}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
			<div>
				<label for="edit-proj-date" class="mb-1 block text-xs font-semibold text-ink">Date cible</label>
				<input
					id="edit-proj-date"
					type="date"
					bind:value={editEventDate}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
				/>
			</div>
		</div>
		<div>
			<label for="edit-proj-budget" class="mb-1 block text-xs font-semibold text-ink">
				Budget prévisionnel (EUR)
			</label>
			<input
				id="edit-proj-budget"
				type="number"
				min="0"
				step="1"
				bind:value={editBudgetEuros}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
			/>
		</div>
		<div>
			<label for="edit-proj-desc" class="mb-1 block text-xs font-semibold text-ink">Description</label>
			<textarea
				id="edit-proj-desc"
				rows="3"
				maxlength="2000"
				bind:value={editDescription}
				class="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
			></textarea>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (editModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="edit-project-form" variant="primary" loading={savingEdit}>
			Enregistrer
		</Button>
	{/snippet}
</Modal>
