<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateFr, formatDateTimeFr } from '$shared/format';
	import {
		getRoleLabel,
		hasPermission,
		isBureauRole,
		isElevatedRole,
		type Role
	} from '$shared/permissions';
	import type { PageData } from './$types';

	type AdhesionMethod = 'especes' | 'virement' | 'cheque' | 'stripe' | 'gratuit';

	interface MemberItem {
		id: number;
		email: string;
		firstName: string;
		lastName: string;
		classe: string | null;
		role: Role;
		customTitle: string | null;
		isAdherent: boolean;
		adhesionPaidAt: string | null;
		adhesionMethod: AdhesionMethod | null;
		totpEnabled: boolean;
		deletionRequestedAt: string | null;
		createdAt: string;
	}

	interface InvitationItem {
		id: number;
		email: string;
		role: Role;
		customTitle: string | null;
		invitedBy: number;
		acceptedAt: string | null;
		expiresAt: string;
		createdAt: string;
	}

	let { data }: { data: PageData } = $props();
	const availableRoles = $derived(data.roles ?? []);

	const canReadMembers = $derived(
		data.user ? hasPermission(data.user.role, 'members:read') : false
	);
	const canInviteMembers = $derived(
		data.user ? hasPermission(data.user.role, 'members:invite') : false
	);
	const canManageMembers = $derived(
		data.user ? hasPermission(data.user.role, 'members:manage') : false
	);
	const canAdminRoles = $derived(
		data.user ? hasPermission(data.user.role, 'admin:roles') : false
	);

	let loading = $state(true);
	let members = $state<MemberItem[]>([]);
	let invitations = $state<InvitationItem[]>([]);
	let search = $state('');
	let segment = $state<'all' | 'bureau' | 'adherents' | 'pending'>('all');

	// Modal invitation par email
	let inviteModalOpen = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<Role>('adherent');
	let inviteCustomTitle = $state('');
	let inviting = $state(false);
	let inviteError = $state('');
	let previewInviteUrl = $state<string | null>(null);

	// Modal adhésion manuelle nouvel élève
	let manualAdhesionOpen = $state(false);
	let manualEmail = $state('');
	let manualFirstName = $state('');
	let manualLastName = $state('');
	let manualClasse = $state('');
	let manualMethod = $state<AdhesionMethod>('especes');
	let savingManual = $state(false);
	let manualError = $state('');

	// Modal édition membre (rôle + titre + adhésion)
	let editMember = $state<MemberItem | null>(null);
	let editRole = $state<Role>('adherent');
	let editCustomTitle = $state('');
	let editIsAdherent = $state(false);
	let editAdhesionMethod = $state<AdhesionMethod>('especes');
	let savingEdit = $state(false);
	let editError = $state('');

	let quickValidatingId = $state<number | null>(null);
	let revokingInviteId = $state<number | null>(null);

	// Modal lien & QR d'adhésion directe
	let adhesionLinkModalOpen = $state(false);
	let adhesionDirectUrl = $state('');
	let adhesionQrSvg = $state('');

	async function openAdhesionLinkModal() {
		const url = typeof window !== 'undefined' ? `${window.location.origin}/adhesion` : '/adhesion';
		adhesionDirectUrl = url;
		adhesionLinkModalOpen = true;
		try {
			adhesionQrSvg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 220 });
		} catch {
			adhesionQrSvg = '';
		}
	}

	async function copyAdhesionLink() {
		if (!adhesionDirectUrl) return;
		try {
			await navigator.clipboard.writeText(adhesionDirectUrl);
			toast.success('Lien d’adhésion copié', adhesionDirectUrl);
		} catch {
			toast.info('Lien d’adhésion', adhesionDirectUrl);
		}
	}

	const filteredMembers = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return members.filter((m) => {
			if (segment === 'bureau' && !isBureauRole(m.role)) return false;
			if (segment === 'adherents' && !m.isAdherent) return false;
			if (segment === 'pending' && m.isAdherent) return false;
			if (!q) return true;
			return (
				`${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
				m.email.toLowerCase().includes(q) ||
				(m.classe || '').toLowerCase().includes(q) ||
				(m.customTitle || '').toLowerCase().includes(q)
			);
		});
	});

	const pendingInvites = $derived(invitations.filter((inv) => !inv.acceptedAt));

	async function loadDirectory() {
		if (!data.user || !canReadMembers) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/members');
			const payload = (await res.json().catch(() => ({}))) as {
				members?: MemberItem[];
				invitations?: InvitationItem[];
				error?: string;
				message?: string;
			};
			if (!res.ok) {
				toast.error('Chargement impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}
			members = payload.members ?? [];
			invitations = payload.invitations ?? [];
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger l’annuaire.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadDirectory();
	});

	function canAssignRole(targetCurrentRole: Role, nextRole: Role): boolean {
		if (!data.user) return false;
		if (nextRole === 'president' || targetCurrentRole === 'president') {
			return data.user.role === 'president';
		}
		if (isElevatedRole(nextRole) || isElevatedRole(targetCurrentRole)) {
			return canAdminRoles;
		}
		return canAdminRoles || canManageMembers;
	}

	async function handleInviteSubmit(event: SubmitEvent) {
		event.preventDefault();
		inviteError = '';
		previewInviteUrl = null;

		if (!inviteEmail.trim()) {
			inviteError = 'Adresse email requise.';
			return;
		}

		inviting = true;
		try {
			const res = await fetch('/api/members', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'invite',
					email: inviteEmail.trim(),
					role: inviteRole,
					customTitle: inviteCustomTitle.trim() || null
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				invitation?: InvitationItem;
				previewInviteUrl?: string;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.invitation) {
				inviteError = payload.error || payload.message || 'Impossible d’envoyer l’invitation.';
				return;
			}

			invitations = [payload.invitation, ...invitations];
			previewInviteUrl = payload.previewInviteUrl || null;
			inviteEmail = '';
			inviteCustomTitle = '';
			toast.success('Invitation créée', `Invitation générée pour ${payload.invitation.email}.`);
			if (!previewInviteUrl) {
				inviteModalOpen = false;
			}
		} catch {
			inviteError = 'Erreur réseau lors de l’invitation.';
		} finally {
			inviting = false;
		}
	}

	async function handleManualAdhesion(event: SubmitEvent) {
		event.preventDefault();
		manualError = '';
		if (!manualEmail.trim() || !manualFirstName.trim() || !manualLastName.trim() || !manualClasse.trim()) {
			manualError = 'Tous les champs sont obligatoires.';
			return;
		}

		savingManual = true;
		try {
			const res = await fetch('/api/members', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'adhesion',
					email: manualEmail.trim(),
					firstName: manualFirstName.trim(),
					lastName: manualLastName.trim(),
					classe: manualClasse.trim(),
					adhesionMethod: manualMethod
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				member?: MemberItem;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.member) {
				manualError = payload.error || payload.message || 'Impossible d’enregistrer l’adhésion.';
				return;
			}

			await loadDirectory();
			manualAdhesionOpen = false;
			manualEmail = '';
			manualFirstName = '';
			manualLastName = '';
			manualClasse = '';
			toast.success('Adhérent enregistré', 'Cotisation marquée comme payée.');
		} catch {
			manualError = 'Erreur réseau.';
		} finally {
			savingManual = false;
		}
	}

	async function quickValidateAdhesion(member: MemberItem) {
		if (!canManageMembers || quickValidatingId !== null) return;
		quickValidatingId = member.id;
		const previous = members;
		const nowIso = new Date().toISOString();

		members = members.map((m) =>
			m.id === member.id
				? { ...m, isAdherent: true, adhesionMethod: m.adhesionMethod || 'especes', adhesionPaidAt: nowIso }
				: m
		);

		try {
			const res = await fetch(`/api/members/${member.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					isAdherent: true,
					adhesionMethod: member.adhesionMethod || 'especes'
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				member?: MemberItem;
				error?: string;
				message?: string;
			};
			if (!res.ok || !payload.member) {
				members = previous;
				toast.error('Validation refusée', payload.error || payload.message || 'Erreur serveur.');
				return;
			}
			members = members.map((m) => (m.id === member.id ? { ...m, ...payload.member! } : m));
			toast.success('Adhésion validée', `${member.firstName} ${member.lastName} est adhérent(e).`);
		} catch {
			members = previous;
			toast.error('Erreur réseau');
		} finally {
			quickValidatingId = null;
		}
	}

	function openEditModal(member: MemberItem) {
		editMember = member;
		editRole = member.role;
		editCustomTitle = member.customTitle || '';
		editIsAdherent = member.isAdherent;
		editAdhesionMethod = member.adhesionMethod || 'especes';
		editError = '';
	}

	async function saveMemberEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!editMember || savingEdit) return;
		editError = '';

		const patchBody: Record<string, unknown> = {};
		if (editRole !== editMember.role) {
			patchBody.role = editRole;
		}
		if ((editCustomTitle.trim() || null) !== editMember.customTitle) {
			patchBody.customTitle = editCustomTitle.trim() || null;
		}
		if (canManageMembers) {
			if (editIsAdherent !== editMember.isAdherent) {
				patchBody.isAdherent = editIsAdherent;
			}
			if (editIsAdherent && editAdhesionMethod !== editMember.adhesionMethod) {
				patchBody.adhesionMethod = editAdhesionMethod;
			}
		}

		if (Object.keys(patchBody).length === 0) {
			editMember = null;
			return;
		}

		savingEdit = true;
		try {
			const res = await fetch(`/api/members/${editMember.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patchBody)
			});
			const payload = (await res.json().catch(() => ({}))) as {
				member?: MemberItem;
				error?: string;
				message?: string;
			};
			if (!res.ok || !payload.member) {
				editError = payload.error || payload.message || 'Modification impossible.';
				return;
			}
			members = members.map((m) => (m.id === editMember!.id ? { ...m, ...payload.member! } : m));
			editMember = null;
			toast.success('Fiche membre mise à jour');
		} catch {
			editError = 'Erreur réseau.';
		} finally {
			savingEdit = false;
		}
	}

	async function revokeInvitation(inv: InvitationItem) {
		if (!canInviteMembers || revokingInviteId !== null) return;
		revokingInviteId = inv.id;
		try {
			const res = await fetch(`/api/members/${inv.id}?type=invitation`, { method: 'DELETE' });
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				toast.error('Révocation impossible', err.error || err.message || 'Erreur serveur.');
				return;
			}
			invitations = invitations.filter((i) => i.id !== inv.id);
			toast.success('Invitation révoquée', inv.email);
		} catch {
			toast.error('Erreur réseau');
		} finally {
			revokingInviteId = null;
		}
	}
</script>

<svelte:head>
	<title>Membres & adhérents · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Annuaire bureau & adhérents
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Gestion des rôles MDL, suivi des cotisations ({members.filter((m) => m.isAdherent).length} adhérents actifs) et invitations par email.
			</p>
		</div>

		<div class="flex flex-wrap gap-2.5">
			{#if canInviteMembers || canManageMembers}
				<Button variant="secondary" onclick={openAdhesionLinkModal}>
					Lien & QR d'adhésion
				</Button>
			{/if}
			{#if canAdminRoles}
				<Button variant="secondary" href="/admin/parametres#roles">
					Gérer les rôles
				</Button>
			{/if}
			{#if canManageMembers}
				<Button variant="secondary" onclick={() => (manualAdhesionOpen = true)}>
					+ Adhésion sur place
				</Button>
			{/if}
			{#if canInviteMembers}
				<Button
					variant="primary"
					onclick={() => {
						inviteError = '';
						previewInviteUrl = null;
						inviteModalOpen = true;
					}}
				>
					+ Inviter par email
				</Button>
			{/if}
		</div>
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connexion requise</h2>
			<p class="text-sm text-muted">Connecte-toi avec un compte du bureau pour consulter l'annuaire.</p>
			<Button href="/connexion?redirect=/membres" variant="primary">Se connecter</Button>
		</Card>
	{:else if !canReadMembers}
		<Card padding="lg" class="text-center">
			<p class="text-base font-semibold text-ink">
				L'annuaire complet est accessible aux membres du bureau et au professeur référent.
			</p>
		</Card>
	{:else if loading}
		<div class="space-y-3">
			<Skeleton variant="card" height="120px" />
			<Skeleton variant="card" height="240px" />
		</div>
	{:else}
		<!-- Filtres & recherche -->
		<Card padding="sm" class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer les membres">
				{#each [
					{ id: 'all', label: `Tous (${members.length})` },
					{ id: 'bureau', label: `Bureau (${members.filter((m) => isBureauRole(m.role)).length})` },
					{ id: 'adherents', label: `Adhérents (${members.filter((m) => m.isAdherent).length})` },
					{ id: 'pending', label: `Cotisation en attente (${members.filter((m) => !m.isAdherent).length})` }
				] as seg (seg.id)}
					<button
						type="button"
						onclick={() => (segment = seg.id as typeof segment)}
						aria-pressed={segment === seg.id}
						class={`min-h-10 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
							segment === seg.id
								? 'border-brand bg-brand text-white'
								: 'border-border bg-surface text-muted hover:text-ink'
						}`}
					>
						{seg.label}
					</button>
				{/each}
			</div>

			<label for="member-search" class="sr-only">Rechercher un membre</label>
			<input
				id="member-search"
				type="search"
				bind:value={search}
				placeholder="Nom, classe, email..."
				class="min-h-10 min-w-56 rounded-[10px] border border-border bg-surface px-3.5 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</Card>

		<!-- Liste des membres -->
		<Card>
			{#if filteredMembers.length === 0}
				<p class="py-6 text-center text-sm text-muted">Aucun membre trouvé pour ce filtre.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full border-collapse text-left text-sm">
						<thead>
							<tr class="border-b border-border text-xs uppercase tracking-wider text-muted">
								<th class="py-2.5 pr-3">Membre</th>
								<th class="py-2.5 pr-3">Rôle & fonction</th>
								<th class="py-2.5 pr-3">Adhésion</th>
								<th class="py-2.5 pr-3">Sécurité</th>
								<th class="py-2.5 text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/70">
							{#each filteredMembers as m (m.id)}
								<tr>
									<td class="py-3 pr-3">
										<p class="font-semibold text-ink">
											{m.firstName} {m.lastName}
											{#if m.classe}
												<span class="ml-1 text-xs font-normal text-muted">({m.classe})</span>
											{/if}
										</p>
										<p class="text-xs text-muted">{m.email}</p>
									</td>
									<td class="py-3 pr-3">
										<Badge variant={isBureauRole(m.role) ? 'brand' : 'neutral'}>
											{getRoleLabel(m.role)}
										</Badge>
										{#if m.customTitle}
											<p class="mt-0.5 text-xs text-muted">{m.customTitle}</p>
										{/if}
									</td>
									<td class="py-3 pr-3">
										{#if m.isAdherent}
											<Badge variant="success" dot>Adhérent</Badge>
											{#if m.adhesionMethod || m.adhesionPaidAt}
												<p class="mt-0.5 text-[11px] text-muted">
													{m.adhesionMethod || 'validée'}
													{#if m.adhesionPaidAt}· {formatDateFr(m.adhesionPaidAt)}{/if}
												</p>
											{/if}
										{:else}
											<Badge variant="warning">Non adhérent</Badge>
										{/if}
									</td>
									<td class="py-3 pr-3">
										<Badge size="sm" variant={m.totpEnabled ? 'success' : 'neutral'}>
											{m.totpEnabled ? '2FA active' : 'Sans 2FA'}
										</Badge>
									</td>
									<td class="py-3 text-right">
										<div class="inline-flex flex-wrap justify-end gap-1.5">
											{#if canManageMembers && !m.isAdherent}
												<Button
													size="sm"
													variant="primary"
													loading={quickValidatingId === m.id}
													onclick={() => quickValidateAdhesion(m)}
												>
													Valider adhésion
												</Button>
											{/if}
											{#if canManageMembers || canAdminRoles}
												<Button size="sm" variant="secondary" onclick={() => openEditModal(m)}>
													Gérer
												</Button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>

		<!-- Invitations en attente -->
		{#if pendingInvites.length > 0}
			<Card class="space-y-3">
				<h2 class="text-base font-bold text-ink">Invitations en attente ({pendingInvites.length})</h2>
				<ul class="divide-y divide-border/70 text-sm">
					{#each pendingInvites as inv (inv.id)}
						<li class="flex flex-wrap items-center justify-between gap-3 py-2.5">
							<div>
								<p class="font-semibold text-ink">{inv.email}</p>
								<p class="text-xs text-muted">
									Rôle : {getRoleLabel(inv.role)}
									{#if inv.customTitle}({inv.customTitle}){/if}
									· Expire le {formatDateTimeFr(inv.expiresAt)}
								</p>
							</div>
							{#if canInviteMembers}
								<Button
									size="sm"
									variant="danger"
									loading={revokingInviteId === inv.id}
									onclick={() => revokeInvitation(inv)}
								>
									Révoquer
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>

<!-- Modal invitation par email -->
<Modal
	bind:open={inviteModalOpen}
	title="Inviter un membre par email"
	description="Un lien d'inscription sécurisé valable 7 jours sera envoyé."
	size="md"
>
	<form id="invite-member-form" onsubmit={handleInviteSubmit} class="space-y-4">
		{#if inviteError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{inviteError}
			</div>
		{/if}

		{#if previewInviteUrl}
			<div class="rounded-[10px] border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs space-y-1.5">
				<p class="font-bold text-emerald-900 dark:text-emerald-200">
					Lien d'invitation généré (mode sans SMTP) :
				</p>
				<p class="break-all font-mono text-ink">{previewInviteUrl}</p>
			</div>
		{/if}

		<div class="space-y-1.5">
			<label for="inv-email" class="block text-sm font-semibold text-ink">Adresse email</label>
			<input
				id="inv-email"
				type="email"
				bind:value={inviteEmail}
				required
				placeholder="eleve@lycee.fr"
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="inv-role" class="block text-sm font-semibold text-ink">Rôle attribué</label>
				<select
					id="inv-role"
					bind:value={inviteRole}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				>
					{#each availableRoles as roleOpt (roleOpt.slug)}
						{#if canAssignRole('adherent', roleOpt.slug)}
							<option value={roleOpt.slug}>{roleOpt.label}</option>
						{/if}
					{/each}
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="inv-title" class="block text-sm font-semibold text-ink">
					Titre personnalisé (optionnel)
				</label>
				<input
					id="inv-title"
					type="text"
					bind:value={inviteCustomTitle}
					placeholder="Ex : Resp. communication"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (inviteModalOpen = false)}>Fermer</Button>
		<Button type="submit" form="invite-member-form" variant="primary" loading={inviting}>
			Envoyer l'invitation
		</Button>
	{/snippet}
</Modal>

<!-- Modal adhésion sur place -->
<Modal
	bind:open={manualAdhesionOpen}
	title="Enregistrer une adhésion sur place"
	description="Crée directement une fiche adhérent avec cotisation payée (espèces, chèque ou virement)."
	size="md"
>
	<form id="manual-adhesion-form" onsubmit={handleManualAdhesion} class="space-y-4">
		{#if manualError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{manualError}
			</div>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="man-fn" class="block text-sm font-semibold text-ink">Prénom</label>
				<input
					id="man-fn"
					type="text"
					bind:value={manualFirstName}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="man-ln" class="block text-sm font-semibold text-ink">Nom</label>
				<input
					id="man-ln"
					type="text"
					bind:value={manualLastName}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="man-email" class="block text-sm font-semibold text-ink">Email</label>
				<input
					id="man-email"
					type="email"
					bind:value={manualEmail}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="man-classe" class="block text-sm font-semibold text-ink">Classe</label>
				<input
					id="man-classe"
					type="text"
					bind:value={manualClasse}
					required
					placeholder="Ex : Term G1"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="man-method" class="block text-sm font-semibold text-ink">Mode de règlement</label>
			<select
				id="man-method"
				bind:value={manualMethod}
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			>
				<option value="especes">Espèces</option>
				<option value="cheque">Chèque</option>
				<option value="virement">Virement</option>
				<option value="stripe">Carte (Stripe)</option>
				<option value="gratuit">Gratuit</option>
			</select>
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (manualAdhesionOpen = false)}>Annuler</Button>
		<Button type="submit" form="manual-adhesion-form" variant="primary" loading={savingManual}>
			Enregistrer l'adhérent
		</Button>
	{/snippet}
</Modal>

<!-- Modal édition rôle & adhésion d'un membre -->
<Modal
	open={editMember !== null}
	onclose={() => (editMember = null)}
	title={editMember ? `${editMember.firstName} ${editMember.lastName}` : 'Gérer le membre'}
	description={editMember?.email}
	size="md"
>
	{#if editMember}
		<form id="edit-member-form" onsubmit={saveMemberEdit} class="space-y-4">
			{#if editError}
				<div
					role="alert"
					class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
				>
					{editError}
				</div>
			{/if}

			<div class="space-y-1.5">
				<label for="edit-role" class="block text-sm font-semibold text-ink">Rôle MDL</label>
				<select
					id="edit-role"
					bind:value={editRole}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				>
					{#each availableRoles as roleOpt (roleOpt.slug)}
						{#if roleOpt.slug === editMember.role || canAssignRole(editMember.role, roleOpt.slug)}
							<option value={roleOpt.slug}>{roleOpt.label}</option>
						{/if}
					{/each}
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="edit-title" class="block text-sm font-semibold text-ink">
					Fonction personnalisée
				</label>
				<input
					id="edit-title"
					type="text"
					bind:value={editCustomTitle}
					placeholder="Ex : Responsable cafétéria"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			{#if canManageMembers}
				<div class="space-y-3 rounded-[10px] border border-border bg-surface p-3.5">
					<label class="flex items-center gap-2.5 text-sm font-semibold text-ink cursor-pointer">
						<input type="checkbox" bind:checked={editIsAdherent} class="size-4 accent-brand" />
						Adhésion validée (cotisation réglée)
					</label>

					{#if editIsAdherent}
						<div class="space-y-1.5">
							<label for="edit-adh-method" class="block text-xs font-semibold text-muted">
								Mode de règlement cotisation
							</label>
							<select
								id="edit-adh-method"
								bind:value={editAdhesionMethod}
								class="min-h-10 w-full rounded-[10px] border border-border bg-card px-3 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
							>
								<option value="especes">Espèces</option>
								<option value="cheque">Chèque</option>
								<option value="virement">Virement</option>
								<option value="stripe">Stripe</option>
								<option value="gratuit">Gratuit</option>
							</select>
						</div>
					{/if}
				</div>
			{/if}
		</form>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editMember = null)}>Annuler</Button>
		<Button type="submit" form="edit-member-form" variant="primary" loading={savingEdit}>
			Enregistrer
		</Button>
	{/snippet}
</Modal>

<!-- Modal Lien & QR d'adhésion directe en 1 clic -->
<Modal
	bind:open={adhesionLinkModalOpen}
	title="Lien & QR code d'adhésion directe"
	description="Partage ce lien ou affiche ce QR au foyer et lors des journées portes ouvertes."
	size="sm"
>
	<div class="space-y-4 text-center">
		{#if adhesionQrSvg}
			<div class="mx-auto inline-block rounded-2xl border border-border bg-white p-3.5 shadow-xs">
				<div class="size-48 [&>svg]:h-full [&>svg]:w-full">
					{@html adhesionQrSvg}
				</div>
			</div>
		{/if}

		<div class="rounded-[10px] border border-border bg-surface p-2.5 text-xs break-all font-mono text-ink">
			{adhesionDirectUrl}
		</div>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (adhesionLinkModalOpen = false)}>Fermer</Button>
		<Button variant="primary" onclick={copyAdhesionLink}>Copier le lien</Button>
	{/snippet}
</Modal>
