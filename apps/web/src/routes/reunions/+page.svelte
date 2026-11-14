<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, formatDateTimeFr } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import { MEETING_RSVP_STATUSES, MEETING_STATUSES } from '$shared/schemas';
	import type { PageData } from './$types';

	type MeetingStatus = (typeof MEETING_STATUSES)[number];
	type RsvpStatus = (typeof MEETING_RSVP_STATUSES)[number];
	type MeetingScope = 'bureau' | 'adherents' | 'lycee';

	interface AgendaItem {
		title: string;
		durationMin?: number;
		done?: boolean;
	}

	interface AttendeeRow {
		userId: number;
		name: string;
		classe: string;
		roleLabel: string;
		rsvpStatus: RsvpStatus;
		checkedIn: boolean;
	}

	interface MeetingItem {
		id: number;
		title: string;
		description: string;
		scope: MeetingScope;
		scheduledAt: string;
		location: string;
		agenda: AgendaItem[];
		minutesText: string;
		status: MeetingStatus;
		attendees: AttendeeRow[];
		myRsvp: AttendeeRow | null;
		createdAt: string;
		updatedAt: string;
	}

	let { data }: { data: PageData } = $props();

	const canRead = $derived(data.user ? hasPermission(data.user.role, 'meetings:read') : false);
	const canManage = $derived(data.user ? hasPermission(data.user.role, 'meetings:manage') : false);
	const canRsvp = $derived(data.user ? hasPermission(data.user.role, 'meetings:rsvp') : false);

	let loading = $state(true);
	let meetingsList = $state<MeetingItem[]>([]);
	let scopeFilter = $state<'all' | MeetingScope>('all');

	// Sélection compte-rendu / édition
	let editingMeeting = $state<MeetingItem | null>(null);
	let minutesDraft = $state('');
	let statusDraft = $state<MeetingStatus>('planifiee');
	let savingMinutes = $state(false);

	// Création de réunion
	let createOpen = $state(false);
	let creating = $state(false);
	let createError = $state('');
	let newTitle = $state('');
	let newDescription = $state('');
	let newScope = $state<MeetingScope>('bureau');
	let newScheduledAt = $state('');
	let newLocation = $state('');
	let newAgenda = $state<AgendaItem[]>([{ title: 'Bilan des actions en cours', durationMin: 15, done: false }]);

	const scopeLabels: Record<MeetingScope, string> = {
		bureau: 'Bureau MDL',
		adherents: 'Adhérents',
		lycee: 'Tout le lycée'
	};

	const statusLabels: Record<MeetingStatus, string> = {
		planifiee: 'Planifiée',
		en_cours: 'En cours',
		terminee: 'Terminée',
		annulee: 'Annulée'
	};

	const statusVariant: Record<MeetingStatus, 'brand' | 'warning' | 'success' | 'danger'> = {
		planifiee: 'brand',
		en_cours: 'warning',
		terminee: 'success',
		annulee: 'danger'
	};

	const rsvpLabels: Record<RsvpStatus, string> = {
		present: 'Présent(e)',
		excuse: 'Excusé(e)',
		absent: 'Absent(e)',
		en_attente: 'En attente'
	};

	const rsvpVariant: Record<RsvpStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
		present: 'success',
		excuse: 'warning',
		absent: 'danger',
		en_attente: 'neutral'
	};

	const filteredMeetings = $derived.by(() =>
		scopeFilter === 'all' ? meetingsList : meetingsList.filter((m) => m.scope === scopeFilter)
	);

	async function loadMeetings() {
		if (!canRead) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/meetings');
			const payload = (await res.json().catch(() => ({}))) as { meetings?: MeetingItem[] };
			if (res.ok && payload.meetings) {
				meetingsList = payload.meetings;
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger les réunions.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadMeetings();
	});

	async function sendRsvp(meetingId: number, rsvpStatus: RsvpStatus) {
		if (!canRsvp) return;
		try {
			const res = await fetch(`/api/meetings/${meetingId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rsvpStatus })
			});
			if (res.ok) {
				await loadMeetings();
				toast.success('Réponse enregistrée', rsvpLabels[rsvpStatus]);
			}
		} catch {
			toast.error('Erreur réseau');
		}
	}

	async function toggleCheckIn(meetingId: number, attendee: AttendeeRow) {
		if (!canManage) return;
		try {
			const res = await fetch(`/api/meetings/${meetingId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: attendee.userId,
					rsvpStatus: attendee.rsvpStatus,
					checkedIn: !attendee.checkedIn
				})
			});
			if (res.ok) {
				await loadMeetings();
			}
		} catch {
			toast.error('Erreur réseau');
		}
	}

	async function toggleAgendaItem(meeting: MeetingItem, index: number) {
		if (!canManage) return;
		const updatedAgenda = meeting.agenda.map((item, idx) =>
			idx === index ? { ...item, done: !item.done } : item
		);
		try {
			const res = await fetch(`/api/meetings/${meeting.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agenda: updatedAgenda })
			});
			if (res.ok) {
				meetingsList = meetingsList.map((m) =>
					m.id === meeting.id ? { ...m, agenda: updatedAgenda } : m
				);
			}
		} catch {
			toast.error('Erreur réseau');
		}
	}

	function openMinutesModal(meeting: MeetingItem) {
		editingMeeting = meeting;
		minutesDraft = meeting.minutesText || '';
		statusDraft = meeting.status;
	}

	async function handleSaveMinutes(event: SubmitEvent) {
		event.preventDefault();
		if (!editingMeeting || !canManage || savingMinutes) return;
		savingMinutes = true;
		try {
			const res = await fetch(`/api/meetings/${editingMeeting.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					minutesText: minutesDraft,
					status: statusDraft
				})
			});
			if (res.ok) {
				editingMeeting = null;
				await loadMeetings();
				toast.success('Compte-rendu enregistré');
			} else {
				toast.error('Impossible de sauvegarder le compte-rendu');
			}
		} catch {
			toast.error('Erreur réseau');
		} finally {
			savingMinutes = false;
		}
	}

	async function handleCreateMeeting(event: SubmitEvent) {
		event.preventDefault();
		if (!canManage || creating) return;
		createError = '';

		if (!newTitle.trim() || !newScheduledAt || !newLocation.trim()) {
			createError = 'Titre, date et lieu sont requis.';
			return;
		}

		const cleanAgenda = newAgenda
			.map((a) => ({
				title: a.title.trim(),
				durationMin: a.durationMin || undefined,
				done: false
			}))
			.filter((a) => a.title.length >= 2);

		creating = true;
		try {
			const res = await fetch('/api/meetings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: newTitle.trim(),
					description: newDescription.trim(),
					scope: newScope,
					scheduledAt: new Date(newScheduledAt).toISOString(),
					location: newLocation.trim(),
					agenda: cleanAgenda
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
			};
			if (!res.ok) {
				createError = payload.error || payload.message || 'Erreur lors de la création.';
				return;
			}
			createOpen = false;
			newTitle = '';
			newDescription = '';
			newScheduledAt = '';
			newLocation = '';
			newAgenda = [{ title: 'Bilan des actions en cours', durationMin: 15, done: false }];
			await loadMeetings();
			toast.success('Réunion planifiée !');
		} catch {
			createError = 'Erreur réseau.';
		} finally {
			creating = false;
		}
	}

	async function deleteMeeting(id: number) {
		if (!canManage) return;
		try {
			const res = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
			if (res.ok) {
				meetingsList = meetingsList.filter((m) => m.id !== id);
				toast.success('Réunion supprimée');
			}
		} catch {
			toast.error('Erreur réseau');
		}
	}
</script>

<svelte:head>
	<title>Réunions · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Réunions & ordres du jour
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Convocations bureau et commissions, ordre du jour, émargement et comptes-rendus PDF.
			</p>
		</div>

		{#if canManage}
			<Button variant="primary" onclick={() => (createOpen = true)}>
				+ Planifier une réunion
			</Button>
		{/if}
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connexion requise</h2>
			<p class="text-sm text-muted">
				Connecte-toi pour consulter les réunions, confirmer ta présence et lire les comptes-rendus.
			</p>
			<Button href="/connexion?redirect=/reunions" variant="primary">Se connecter</Button>
		</Card>
	{:else if !canRead}
		<Card padding="lg" class="text-center">
			<p class="text-sm font-semibold text-ink">
				Ton rôle actuel n'a pas accès au module Réunions.
			</p>
		</Card>
	{:else}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each [
				{ id: 'all', label: 'Toutes' },
				{ id: 'bureau', label: 'Bureau MDL' },
				{ id: 'adherents', label: 'Adhérents' },
				{ id: 'lycee', label: 'Tout le lycée' }
			] as pill (pill.id)}
				<button
					type="button"
					onclick={() => (scopeFilter = pill.id as 'all' | MeetingScope)}
					class={`min-h-9 cursor-pointer rounded-full border px-3.5 text-xs font-semibold transition ${
						scopeFilter === pill.id
							? 'border-brand bg-brand text-white'
							: 'border-border bg-card text-muted hover:text-ink'
					}`}
				>
					{pill.label}
				</button>
			{/each}
		</div>

		{#if loading}
			<div class="grid gap-4 md:grid-cols-2">
				<Skeleton variant="card" height="240px" />
				<Skeleton variant="card" height="240px" />
			</div>
		{:else if filteredMeetings.length === 0}
			<Card padding="lg" class="text-center space-y-2">
				<p class="text-base font-bold text-ink">Aucune réunion prévue dans cette catégorie</p>
			</Card>
		{:else}
			<div class="space-y-5">
				{#each filteredMeetings as m (m.id)}
					<Card class="space-y-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="space-y-1.5">
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant={statusVariant[m.status]}>{statusLabels[m.status]}</Badge>
									<Badge variant="neutral">{scopeLabels[m.scope]}</Badge>
									<span class="text-xs font-medium text-muted">{countdownLabel(m.scheduledAt)}</span>
								</div>
								<h2 class="text-lg font-bold text-ink">{m.title}</h2>
								<p class="text-xs text-muted">
									{formatDateTimeFr(m.scheduledAt)} · {m.location}
								</p>
								{#if m.description}
									<p class="text-sm text-muted pt-1">{m.description}</p>
								{/if}
							</div>

							<div class="flex flex-wrap items-center gap-2">
								<a
									href={`/api/meetings/${m.id}?format=pdf`}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex min-h-9 items-center rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand/50"
								>
									PV PDF
								</a>
								{#if canManage}
									<Button size="sm" variant="secondary" onclick={() => openMinutesModal(m)}>
										Compte-rendu
									</Button>
									<Button size="sm" variant="ghost" onclick={() => deleteMeeting(m.id)}>
										Supprimer
									</Button>
								{/if}
							</div>
						</div>

						<div class="grid gap-4 lg:grid-cols-2">
							<!-- Ordre du jour -->
							<div class="rounded-[12px] border border-border bg-surface p-3.5 space-y-2.5">
								<h3 class="text-xs font-bold uppercase tracking-wider text-muted">
									Ordre du jour ({m.agenda.length})
								</h3>
								{#if m.agenda.length === 0}
									<p class="text-xs text-muted">Aucun point défini.</p>
								{:else}
									<ul class="space-y-1.5">
										{#each m.agenda as item, idx (idx)}
											<li class="flex items-start justify-between gap-2 text-xs">
												<label class="flex items-start gap-2 cursor-pointer">
													<input
														type="checkbox"
														checked={Boolean(item.done)}
														disabled={!canManage}
														onchange={() => toggleAgendaItem(m, idx)}
														class="mt-0.5 size-4 accent-brand"
													/>
													<span class={item.done ? 'line-through text-muted' : 'text-ink font-medium'}>
														{item.title}
													</span>
												</label>
												{#if item.durationMin}
													<span class="shrink-0 font-mono text-[11px] text-muted">
														{item.durationMin} min
													</span>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>

							<!-- RSVP & émargement -->
							<div class="rounded-[12px] border border-border bg-surface p-3.5 space-y-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h3 class="text-xs font-bold uppercase tracking-wider text-muted">
										Ma présence & émargement ({m.attendees.filter((a) => a.rsvpStatus === 'present').length} présent(s))
									</h3>
									{#if canRsvp}
										<div class="flex items-center gap-1">
											{#each [
												{ id: 'present', label: 'Présent' },
												{ id: 'excuse', label: 'Excusé' },
												{ id: 'absent', label: 'Absent' }
											] as btn (btn.id)}
												<button
													type="button"
													onclick={() => sendRsvp(m.id, btn.id as RsvpStatus)}
													class={`cursor-pointer rounded-[8px] border px-2 py-1 text-[11px] font-semibold transition ${
														m.myRsvp?.rsvpStatus === btn.id
															? 'border-brand bg-brand text-white'
															: 'border-border bg-card text-muted hover:text-ink'
													}`}
												>
													{btn.label}
												</button>
											{/each}
										</div>
									{/if}
								</div>

								{#if m.attendees.length === 0}
									<p class="text-xs text-muted">Aucune réponse enregistrée pour le moment.</p>
								{:else}
									<div class="max-h-40 space-y-1.5 overflow-y-auto pr-1">
										{#each m.attendees as att (att.userId)}
											<div class="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-card px-2.5 py-1.5 text-xs">
												<div class="min-w-0">
													<span class="font-semibold text-ink">{att.name}</span>
													<span class="ml-1.5 text-[11px] text-muted">
														{att.roleLabel} · {att.classe}
													</span>
												</div>
												<div class="flex items-center gap-2 shrink-0">
													<Badge size="sm" variant={rsvpVariant[att.rsvpStatus]}>
														{rsvpLabels[att.rsvpStatus]}
													</Badge>
													{#if canManage}
														<label class="flex items-center gap-1 text-[11px] text-muted cursor-pointer" title="Émargement présent en séance">
															<input
																type="checkbox"
																checked={att.checkedIn}
																onchange={() => toggleCheckIn(m.id, att)}
																class="size-3.5 accent-brand"
															/>
															Émargé
														</label>
													{:else if att.checkedIn}
														<span class="text-[11px] font-semibold text-emerald-500">✓ Émargé</span>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						{#if m.minutesText}
							<div class="rounded-[12px] border border-border bg-surface p-3.5 space-y-1">
								<div class="text-xs font-bold uppercase tracking-wider text-muted">Compte-rendu</div>
								<p class="whitespace-pre-line text-sm text-ink leading-relaxed">{m.minutesText}</p>
							</div>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Modal Planifier une réunion -->
<Modal bind:open={createOpen} title="Planifier une réunion" size="lg">
	<form id="create-meeting-form" onsubmit={handleCreateMeeting} class="space-y-4">
		{#if createError}
			<div role="alert" class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-sm text-danger">
				{createError}
			</div>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="mt-title" class="block text-sm font-semibold text-ink">Titre</label>
				<input
					id="mt-title"
					type="text"
					required
					bind:value={newTitle}
					placeholder="Ex : Réunion Bureau préparation Bal"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="mt-scope" class="block text-sm font-semibold text-ink">Public concerné</label>
				<select
					id="mt-scope"
					bind:value={newScope}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
				>
					<option value="bureau">Bureau MDL</option>
					<option value="adherents">Adhérents</option>
					<option value="lycee">Tout le lycée</option>
				</select>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="mt-date" class="block text-sm font-semibold text-ink">Date & heure</label>
				<input
					id="mt-date"
					type="datetime-local"
					required
					bind:value={newScheduledAt}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="mt-loc" class="block text-sm font-semibold text-ink">Lieu / Salle</label>
				<input
					id="mt-loc"
					type="text"
					required
					bind:value={newLocation}
					placeholder="Ex : Foyer MDL · Salle B04"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="mt-desc" class="block text-sm font-semibold text-ink">Notes / contexte</label>
			<textarea
				id="mt-desc"
				rows="2"
				bind:value={newDescription}
				class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
			></textarea>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-sm font-semibold text-ink">Ordre du jour</span>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onclick={() => (newAgenda = [...newAgenda, { title: '', durationMin: 10, done: false }])}
				>
					+ Ajouter un point
				</Button>
			</div>
			{#each newAgenda as pt, idx (idx)}
				<div class="flex items-center gap-2">
					<input
						type="text"
						bind:value={pt.title}
						placeholder="Intitulé du point..."
						class="min-h-10 flex-1 rounded-[8px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
					/>
					<input
						type="number"
						min="1"
						max="240"
						bind:value={pt.durationMin}
						placeholder="min"
						class="min-h-10 w-20 rounded-[8px] border border-border bg-surface px-2 py-1.5 text-sm text-ink"
					/>
					{#if newAgenda.length > 1}
						<button
							type="button"
							onclick={() => (newAgenda = newAgenda.filter((_, i) => i !== idx))}
							class="px-2 text-xs text-danger hover:underline cursor-pointer"
						>
							Retirer
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-meeting-form" variant="primary" loading={creating}>
			Créer la réunion
		</Button>
	{/snippet}
</Modal>

<!-- Modal Compte-rendu -->
<Modal
	bind:open={
		() => editingMeeting !== null,
		(v) => {
			if (!v) editingMeeting = null;
		}
	}
	title={editingMeeting ? `Compte-rendu · ${editingMeeting.title}` : 'Compte-rendu'}
	size="lg"
>
	{#if editingMeeting}
		<form id="minutes-form" onsubmit={handleSaveMinutes} class="space-y-4">
			<div class="space-y-1.5">
				<label for="mt-status" class="block text-sm font-semibold text-ink">Statut de la réunion</label>
				<select
					id="mt-status"
					bind:value={statusDraft}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
				>
					{#each MEETING_STATUSES as st (st)}
						<option value={st}>{statusLabels[st]}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="mt-minutes" class="block text-sm font-semibold text-ink">
					Compte-rendu & décisions prises
				</label>
				<textarea
					id="mt-minutes"
					rows="8"
					bind:value={minutesDraft}
					placeholder="Rédige ici le résumé des décisions, responsables et prochaines étapes..."
					class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm text-ink"
				></textarea>
			</div>
		</form>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editingMeeting = null)}>Fermer</Button>
		<Button type="submit" form="minutes-form" variant="primary" loading={savingMinutes}>
			Enregistrer le compte-rendu
		</Button>
	{/snippet}
</Modal>
