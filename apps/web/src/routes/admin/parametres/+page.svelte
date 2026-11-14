<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr, formatEuros } from '$shared/format';
	import {
		PERMISSION_GROUPS,
		ROLE_PRESETS,
		hasAnyPermission,
		hasPermission,
		slugifyRoleLabel,
		type Permission,
		type RoleDefinition,
		type RolePreset
	} from '$shared/permissions';
	import type { PageData } from './$types';

	type RegistrationMode = 'open' | 'school_code' | 'invite_only';

	interface AdminSettingsData {
		schoolName: string;
		schoolCity?: string;
		schoolPostalCode?: string;
		schoolDepartment?: string;
		schoolUai?: string | null;
		mdlName: string;
		primaryColor: string;
		accentColor: string;
		logoUrl: string | null;
		membershipFeeCents: number;
		schoolYear: string;
		legalRepresentative: string;
		registrationMode: RegistrationMode;
		hasSchoolCode: boolean;
		stripeEnabled?: boolean;
		stripePublishableKey?: string | null;
		stripeCurrency?: string;
		hasStripeSecretKey?: boolean;
		stripeSecretKeyHint?: string | null;
		hasStripeWebhookSecret?: boolean;
		merchSupplierName?: string;
		merchSupplierEmail?: string;
		merchSupplierUrl?: string;
		setupCompleted?: boolean;
		updatedAt: string | null;
	}

	interface AuditLogRow {
		id: number;
		actorUserId: number | null;
		actorRole: string;
		action: string;
		targetType: string;
		targetId: string | null;
		details: Record<string, unknown>;
		prevHash: string;
		entryHash: string;
		createdAt: string;
	}

	interface AuditChainStatus {
		valid: boolean;
		total: number;
		brokenAtId?: number;
	}

	let { data }: { data: PageData } = $props();

	const canEditSettings = $derived(
		data.user ? hasPermission(data.user.role, 'admin:settings') : false
	);
	const canManageRoles = $derived(
		data.user ? hasPermission(data.user.role, 'admin:roles') : false
	);
	const canReadAudit = $derived(
		data.user ? hasPermission(data.user.role, 'audit:read') : false
	);
	const canAccessPage = $derived(
		data.user
			? hasAnyPermission(data.user.role, ['admin:settings', 'admin:roles', 'audit:read'])
			: false
	);

	let loadingSettings = $state(true);
	let savingSettings = $state(false);
	let settingsError = $state('');

	let schoolName = $state('');
	let schoolCity = $state('');
	let schoolPostalCode = $state('');
	let schoolDepartment = $state('');
	let mdlName = $state('');
	let setupCompleted = $state(false);
	let primaryColor = $state('#4f46e5');
	let accentColor = $state('#06b6d4');
	let membershipFeeEur = $state('5');
	let schoolYear = $state('2026-2027');
	let legalRepresentative = $state('');
	let registrationMode = $state<RegistrationMode>('open');
	let schoolCode = $state('');
	let hasSchoolCode = $state(false);
	let clearSchoolCode = $state(false);
	let logoUrl = $state('');

	// Configuration Stripe CB
	let stripeEnabled = $state(false);
	let stripePublishableKey = $state('');
	let stripeSecretKey = $state('');
	let stripeWebhookSecret = $state('');
	let stripeCurrency = $state('eur');
	let hasStripeSecretKey = $state(false);
	let stripeSecretKeyHint = $state<string | null>(null);
	let hasStripeWebhookSecret = $state(false);
	let clearStripeSecretKey = $state(false);
	let clearStripeWebhookSecret = $state(false);
	let testingStripe = $state(false);
	let stripeTestResult = $state<{ ok: boolean; message: string; livemode?: boolean } | null>(null);

	// Journal d'audit SHA-256
	let loadingAudit = $state(false);
	let verifyingChain = $state(false);
	let auditLogs = $state<AuditLogRow[]>([]);
	let auditTotal = $state(0);
	let auditChain = $state<AuditChainStatus | null>(null);
	let lastVerifiedAt = $state<string | null>(null);
	let actionFilter = $state('');

	// Gestion des rôles personnalisés & permissions
	let loadingRoles = $state(false);
	let rolesList = $state<RoleDefinition[]>([]);
	let roleModalOpen = $state(false);
	let roleModalMode = $state<'create' | 'edit'>('create');
	let editingRoleSlug = $state<string | null>(null);
	let roleSlugInput = $state('');
	let roleSlugTouched = $state(false);
	let roleLabelInput = $state('');
	let roleDescriptionInput = $state('');
	let rolePermissionsInput = $state<Permission[]>([]);
	let savingRole = $state(false);
	let roleFormError = $state('');

	let deleteRoleTarget = $state<RoleDefinition | null>(null);
	let reassignRoleSlug = $state('adherent');
	let deletingRole = $state(false);
	let deleteRoleError = $state('');

	async function loadSettings() {
		loadingSettings = true;
		try {
			const res = await fetch('/api/admin/settings');
			const payload = (await res.json().catch(() => ({}))) as {
				settings?: AdminSettingsData;
			};
			if (res.ok && payload.settings) {
				const s = payload.settings;
				schoolName = s.schoolName;
				schoolCity = s.schoolCity || '';
				schoolPostalCode = s.schoolPostalCode || '';
				schoolDepartment = s.schoolDepartment || '';
				mdlName = s.mdlName;
				setupCompleted = Boolean(s.setupCompleted);
				primaryColor = s.primaryColor;
				accentColor = s.accentColor;
				membershipFeeEur = (s.membershipFeeCents / 100).toString();
				schoolYear = s.schoolYear;
				legalRepresentative = s.legalRepresentative || '';
				registrationMode = s.registrationMode;
				hasSchoolCode = s.hasSchoolCode;
				logoUrl = s.logoUrl || '';
				stripeEnabled = Boolean(s.stripeEnabled);
				stripePublishableKey = s.stripePublishableKey || '';
				stripeCurrency = s.stripeCurrency || 'eur';
				hasStripeSecretKey = Boolean(s.hasStripeSecretKey);
				stripeSecretKeyHint = s.stripeSecretKeyHint || null;
				hasStripeWebhookSecret = Boolean(s.hasStripeWebhookSecret);
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger les paramètres.');
		} finally {
			loadingSettings = false;
		}
	}

	async function loadAudit(manualVerify = false) {
		if (!canReadAudit) return;
		if (manualVerify) verifyingChain = true;
		else loadingAudit = true;

		try {
			const params = new URLSearchParams({ limit: '50', offset: '0' });
			if (actionFilter.trim()) params.set('action', actionFilter.trim());

			const res = await fetch(`/api/audit?${params.toString()}`);
			const payload = (await res.json().catch(() => ({}))) as {
				logs?: AuditLogRow[];
				total?: number;
				chain?: AuditChainStatus;
				error?: string;
			};

			if (!res.ok) {
				toast.error('Audit inaccessible', payload.error || 'Erreur serveur.');
				return;
			}

			auditLogs = payload.logs ?? [];
			auditTotal = payload.total ?? 0;
			auditChain = payload.chain ?? null;
			lastVerifiedAt = new Date().toISOString();

			if (manualVerify && payload.chain) {
				if (payload.chain.valid) {
					toast.success(
						'Chaîne SHA-256 intègre',
						`${payload.chain.total} entrée(s) vérifiée(s) sans altération.`
					);
				} else {
					toast.error(
						'Rupture d’intégrité détectée !',
						`Anomalie détectée à l'entrée #${payload.chain.brokenAtId ?? '?'}.`
					);
				}
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger le journal d’audit.');
		} finally {
			loadingAudit = false;
			verifyingChain = false;
		}
	}

	async function loadRoles() {
		if (!canManageRoles) return;
		loadingRoles = true;
		try {
			const res = await fetch('/api/admin/roles');
			const payload = (await res.json().catch(() => ({}))) as {
				roles?: RoleDefinition[];
				error?: string;
			};
			if (res.ok && payload.roles) {
				rolesList = payload.roles;
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger la liste des rôles.');
		} finally {
			loadingRoles = false;
		}
	}

	onMount(() => {
		if (canAccessPage) {
			loadSettings();
			if (canManageRoles) {
				loadRoles();
			}
			if (canReadAudit) {
				loadAudit(false);
			}
		} else {
			loadingSettings = false;
		}
	});

	function openCreateRoleModal() {
		roleModalMode = 'create';
		editingRoleSlug = null;
		roleLabelInput = '';
		roleSlugInput = '';
		roleSlugTouched = false;
		roleDescriptionInput = '';
		rolePermissionsInput = ['projects:read', 'polls:read', 'tickets:buy'];
		roleFormError = '';
		roleModalOpen = true;
	}

	function openEditRoleModal(role: RoleDefinition) {
		roleModalMode = 'edit';
		editingRoleSlug = role.slug;
		roleLabelInput = role.label;
		roleSlugInput = role.slug;
		roleSlugTouched = true;
		roleDescriptionInput = role.description;
		rolePermissionsInput = [...role.permissions];
		roleFormError = '';
		roleModalOpen = true;
	}

	function handleRoleLabelInput(value: string) {
		roleLabelInput = value;
		if (roleModalMode === 'create' && !roleSlugTouched) {
			roleSlugInput = slugifyRoleLabel(value);
		}
	}

	function togglePermission(perm: Permission) {
		if (
			editingRoleSlug === 'president' &&
			(perm === 'admin:roles' || perm === 'admin:settings')
		) {
			return;
		}
		if (rolePermissionsInput.includes(perm)) {
			rolePermissionsInput = rolePermissionsInput.filter((p) => p !== perm);
		} else {
			rolePermissionsInput = [...rolePermissionsInput, perm];
		}
	}

	function toggleGroupPermissions(groupPermissions: readonly { key: Permission }[]) {
		const keys = groupPermissions.map((item) => item.key);
		const allSelected = keys.every((k) => rolePermissionsInput.includes(k));
		if (allSelected) {
			rolePermissionsInput = rolePermissionsInput.filter((p) => {
				if (
					editingRoleSlug === 'president' &&
					(p === 'admin:roles' || p === 'admin:settings')
				) {
					return true;
				}
				return !keys.includes(p);
			});
		} else {
			const next = new Set<Permission>(rolePermissionsInput);
			for (const k of keys) next.add(k);
			rolePermissionsInput = Array.from(next);
		}
	}

	function applyRoleTemplate(sourceSlug: string) {
		const source = rolesList.find((r) => r.slug === sourceSlug);
		if (!source) return;
		const next = new Set<Permission>(source.permissions);
		if (editingRoleSlug === 'president') {
			next.add('admin:roles');
			next.add('admin:settings');
		}
		rolePermissionsInput = Array.from(next);
	}

	function applyRolePreset(preset: RolePreset) {
		if (roleModalMode === 'create') {
			roleLabelInput = preset.label;
			roleSlugInput = preset.slug;
			roleSlugTouched = false;
			roleDescriptionInput = preset.description;
		}
		rolePermissionsInput = [...preset.permissions];
	}

	async function handleSaveRole(event: SubmitEvent) {
		event.preventDefault();
		if (savingRole) return;
		roleFormError = '';

		const label = roleLabelInput.trim();
		if (label.length < 2) {
			roleFormError = 'Indique un nom de rôle d’au moins 2 caractères.';
			return;
		}

		savingRole = true;
		try {
			const url =
				roleModalMode === 'create'
					? '/api/admin/roles'
					: `/api/admin/roles/${encodeURIComponent(editingRoleSlug || '')}`;
			const method = roleModalMode === 'create' ? 'POST' : 'PATCH';
			const body: Record<string, unknown> = {
				label,
				description: roleDescriptionInput.trim(),
				permissions: rolePermissionsInput
			};
			if (roleModalMode === 'create' && roleSlugInput.trim()) {
				body.slug = roleSlugInput.trim();
			}

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				roleFormError = payload.error || payload.message || 'Enregistrement impossible.';
				return;
			}

			roleModalOpen = false;
			await Promise.all([loadRoles(), invalidateAll()]);
			if (canReadAudit) {
				await loadAudit(false);
			}
			toast.success(
				roleModalMode === 'create' ? 'Rôle créé' : 'Rôle mis à jour',
				`« ${label} » (${rolePermissionsInput.length} permissions) est actif.`
			);
		} catch {
			roleFormError = 'Erreur réseau lors de la sauvegarde du rôle.';
		} finally {
			savingRole = false;
		}
	}

	function openDeleteRoleModal(role: RoleDefinition) {
		deleteRoleTarget = role;
		const fallback =
			rolesList.find((r) => r.slug === 'adherent' && r.slug !== role.slug) ??
			rolesList.find((r) => r.slug === 'invite' && r.slug !== role.slug) ??
			rolesList.find((r) => r.slug !== role.slug);
		reassignRoleSlug = fallback?.slug ?? '';
		deleteRoleError = '';
	}

	async function confirmDeleteRole() {
		if (!deleteRoleTarget || deletingRole) return;
		deletingRole = true;
		deleteRoleError = '';
		try {
			const res = await fetch(
				`/api/admin/roles/${encodeURIComponent(deleteRoleTarget.slug)}?reassignTo=${encodeURIComponent(reassignRoleSlug)}`,
				{ method: 'DELETE' }
			);
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
				reassignedUsers?: number;
			};
			if (!res.ok) {
				deleteRoleError = payload.error || payload.message || 'Suppression impossible.';
				return;
			}

			const deletedLabel = deleteRoleTarget.label;
			deleteRoleTarget = null;
			await Promise.all([loadRoles(), invalidateAll()]);
			if (canReadAudit) {
				await loadAudit(false);
			}
			toast.success(
				'Rôle supprimé',
				payload.reassignedUsers
					? `« ${deletedLabel} » supprimé (${payload.reassignedUsers} membre(s) réaffecté(s)).`
					: `« ${deletedLabel} » a été supprimé.`
			);
		} catch {
			deleteRoleError = 'Erreur réseau lors de la suppression.';
		} finally {
			deletingRole = false;
		}
	}

	function parseEurToCents(raw: string | number): number {
		const num = Number.parseFloat(String(raw ?? '').replace(',', '.').trim());
		if (!Number.isFinite(num) || num < 0) return 0;
		return Math.round(num * 100);
	}

	async function handleSaveSettings(event: SubmitEvent) {
		event.preventDefault();
		if (!canEditSettings || savingSettings) return;
		settingsError = '';

		const feeCents = parseEurToCents(membershipFeeEur);

		if (registrationMode === 'school_code' && !hasSchoolCode && !schoolCode.trim()) {
			settingsError = 'Saisis un code lycée pour activer le mode "Code établissement".';
			return;
		}

		savingSettings = true;
		try {
			const body: Record<string, unknown> = {
				schoolName: schoolName.trim(),
				schoolCity: schoolCity.trim(),
				schoolPostalCode: schoolPostalCode.trim(),
				schoolDepartment: schoolDepartment.trim(),
				mdlName: mdlName.trim(),
				primaryColor,
				accentColor,
				logoUrl: logoUrl.trim() || null,
				membershipFeeCents: feeCents,
				schoolYear: schoolYear.trim(),
				legalRepresentative: legalRepresentative.trim(),
				registrationMode,
				stripeEnabled,
				stripePublishableKey: stripePublishableKey.trim() || null,
				stripeCurrency: stripeCurrency.trim() || 'eur',
				setupCompleted: true
			};

			if (clearSchoolCode) {
				body.schoolCode = null;
			} else if (schoolCode.trim()) {
				body.schoolCode = schoolCode.trim();
			}

			if (clearStripeSecretKey) {
				body.stripeSecretKey = null;
			} else if (stripeSecretKey.trim()) {
				body.stripeSecretKey = stripeSecretKey.trim();
			}

			if (clearStripeWebhookSecret) {
				body.stripeWebhookSecret = null;
			} else if (stripeWebhookSecret.trim()) {
				body.stripeWebhookSecret = stripeWebhookSecret.trim();
			}

			const res = await fetch('/api/admin/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const payload = (await res.json().catch(() => ({}))) as {
				settings?: AdminSettingsData;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.settings) {
				settingsError = payload.error || payload.message || 'Impossible de sauvegarder les paramètres.';
				return;
			}

			hasSchoolCode = payload.settings.hasSchoolCode;
			schoolCode = '';
			clearSchoolCode = false;
			stripeEnabled = Boolean(payload.settings.stripeEnabled);
			stripePublishableKey = payload.settings.stripePublishableKey || '';
			stripeCurrency = payload.settings.stripeCurrency || 'eur';
			hasStripeSecretKey = Boolean(payload.settings.hasStripeSecretKey);
			stripeSecretKeyHint = payload.settings.stripeSecretKeyHint || null;
			hasStripeWebhookSecret = Boolean(payload.settings.hasStripeWebhookSecret);
			stripeSecretKey = '';
			stripeWebhookSecret = '';
			clearStripeSecretKey = false;
			clearStripeWebhookSecret = false;
			stripeTestResult = null;
			await invalidateAll();
			if (canReadAudit) {
				await loadAudit(false);
			}
			toast.success('Paramètres mis à jour', 'Les réglages du lycée et de Stripe sont enregistrés.');
		} catch {
			settingsError = 'Erreur réseau lors de l’enregistrement.';
		} finally {
			savingSettings = false;
		}
	}

	async function handleTestStripe() {
		if (!canEditSettings || testingStripe) return;
		testingStripe = true;
		stripeTestResult = null;
		try {
			const res = await fetch('/api/admin/stripe/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					secretKey: stripeSecretKey.trim() || undefined
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				livemode?: boolean;
				message?: string;
				error?: string;
			};
			if (res.ok && payload.ok) {
				stripeTestResult = {
					ok: true,
					livemode: payload.livemode,
					message: payload.message || (payload.livemode ? 'Connexion Stripe Live OK' : 'Connexion Stripe Test OK')
				};
				toast.success('Stripe opérationnel', stripeTestResult.message);
			} else {
				stripeTestResult = {
					ok: false,
					message: payload.error || payload.message || 'Clé Stripe invalide ou refusée.'
				};
				toast.error('Test Stripe échoué', stripeTestResult.message);
			}
		} catch {
			stripeTestResult = { ok: false, message: 'Erreur réseau lors du test Stripe.' };
		} finally {
			testingStripe = false;
		}
	}

	async function copyWebhookUrl() {
		const url = typeof window !== 'undefined' ? `${window.location.origin}/api/stripe/webhook` : '/api/stripe/webhook';
		try {
			await navigator.clipboard.writeText(url);
			toast.success('URL Webhook copiée', url);
		} catch {
			toast.info('URL Webhook', url);
		}
	}
</script>

<svelte:head>
	<title>Paramètres & audit · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
			Paramètres établissement & audit SHA-256
		</h1>
		<p class="mt-1.5 text-sm text-muted">
			Identité visuelle du lycée, cotisation annuelle, contrôle des inscriptions et journal cryptographique chaîné.
		</p>
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connexion requise</h2>
			<Button href="/connexion?redirect=/admin/parametres" variant="primary">Se connecter</Button>
		</Card>
	{:else if !canAccessPage}
		<Card padding="lg" class="text-center">
			<p class="text-base font-semibold text-ink">
				Accès réservé à l'administration MDL (président, trésorier ou professeur référent).
			</p>
		</Card>
	{:else}
		<!-- Lien compact vers l'assistant de démarrage -->
		{#if canEditSettings}
			<div class="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border bg-surface px-3.5 py-2 text-xs">
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-medium text-ink">Assistant de configuration</span>
					<Badge size="sm" variant={setupCompleted ? 'success' : 'warning'}>
						{setupCompleted ? 'Configuré' : 'À compléter'}
					</Badge>
				</div>
				<a href="/setup" class="font-semibold text-brand hover:underline">
					{setupCompleted ? 'Rouvrir (/setup) →' : 'Lancer (/setup) →'}
				</a>
			</div>
		{/if}

		<!-- Paramètres du lycée -->
		{#if canEditSettings}
			<Card class="space-y-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-lg font-bold text-ink">Identité & inscription du lycée</h2>
					<div class="flex items-center gap-2 text-xs">
						<span
							class="inline-block size-4 rounded-full border border-border"
							style={`background:${primaryColor}`}
							aria-hidden="true"
						></span>
						<span
							class="inline-block size-4 rounded-full border border-border"
							style={`background:${accentColor}`}
							aria-hidden="true"
						></span>
						<span class="text-muted">Aperçu palette</span>
					</div>
				</div>

				{#if loadingSettings}
					<Skeleton variant="text" lines={5} />
				{:else}
					<form onsubmit={handleSaveSettings} class="space-y-4">
						{#if settingsError}
							<div
								role="alert"
								class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
							>
								{settingsError}
							</div>
						{/if}

						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-1.5">
								<label for="set-school" class="block text-sm font-semibold text-ink">
									Nom du lycée
								</label>
								<input
									id="set-school"
									type="text"
									bind:value={schoolName}
									required
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="space-y-1.5">
								<label for="set-mdl" class="block text-sm font-semibold text-ink">
									Nom de la MDL
								</label>
								<input
									id="set-mdl"
									type="text"
									bind:value={mdlName}
									required
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="space-y-1.5">
								<label for="set-city" class="block text-sm font-semibold text-ink">
									Ville / Commune du lycée
								</label>
								<input
									id="set-city"
									type="text"
									bind:value={schoolCity}
									placeholder="Ex : Cagnes-sur-Mer"
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-1.5">
									<label for="set-cp" class="block text-sm font-semibold text-ink">
										Code postal
									</label>
									<input
										id="set-cp"
										type="text"
										bind:value={schoolPostalCode}
										placeholder="Ex : 06800"
										class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									/>
								</div>
								<div class="space-y-1.5">
									<label for="set-dept" class="block text-sm font-semibold text-ink">
										Département / Académie
									</label>
									<input
										id="set-dept"
										type="text"
										bind:value={schoolDepartment}
										placeholder="Ex : Alpes-Maritimes"
										class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									/>
								</div>
							</div>

							<div class="space-y-1.5">
								<label for="set-year" class="block text-sm font-semibold text-ink">
									Année scolaire
								</label>
								<input
									id="set-year"
									type="text"
									bind:value={schoolYear}
									required
									placeholder="2026-2027"
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="space-y-1.5">
								<label for="set-fee" class="block text-sm font-semibold text-ink">
									Cotisation annuelle (€) — <span class="text-xs font-normal text-muted">{formatEuros(parseEurToCents(membershipFeeEur))}</span>
								</label>
								<input
									id="set-fee"
									type="number"
									step="0.5"
									min="0"
									bind:value={membershipFeeEur}
									required
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="space-y-1.5">
								<label for="set-primary" class="block text-sm font-semibold text-ink">
									Couleur principale
								</label>
								<div class="flex items-center gap-2">
									<input
										id="set-primary"
										type="color"
										bind:value={primaryColor}
										class="h-11 w-14 cursor-pointer rounded-[10px] border border-border bg-surface p-1"
									/>
									<input
										type="text"
										aria-label="Code hex couleur principale"
										bind:value={primaryColor}
										pattern={'^#[0-9a-fA-F]{6}$'}
										class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									/>
								</div>
							</div>

							<div class="space-y-1.5">
								<label for="set-accent" class="block text-sm font-semibold text-ink">
									Couleur secondaire / accent
								</label>
								<div class="flex items-center gap-2">
									<input
										id="set-accent"
										type="color"
										bind:value={accentColor}
										class="h-11 w-14 cursor-pointer rounded-[10px] border border-border bg-surface p-1"
									/>
									<input
										type="text"
										aria-label="Code hex couleur accent"
										bind:value={accentColor}
										pattern={'^#[0-9a-fA-F]{6}$'}
										class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
									/>
								</div>
							</div>

								<div class="space-y-1.5 sm:col-span-2">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<label for="set-logo" class="block text-sm font-semibold text-ink">
											Logo de la MDL (URL directe ou <code class="font-mono text-xs">/logo.svg</code>)
										</label>
										{#if logoUrl}
											<button
												type="button"
												onclick={() => (logoUrl = '/logo.svg')}
												class="text-xs font-semibold text-brand hover:underline"
											>
												Utiliser le logo MDL par défaut
											</button>
										{/if}
									</div>
									<div class="flex items-center gap-2.5">
										<img
											src={logoUrl.trim() || '/logo.svg'}
											alt="Aperçu logo"
											onerror={(e) => {
												(e.currentTarget as HTMLImageElement).src = '/logo.svg';
											}}
											class="size-11 shrink-0 rounded-[10px] border border-border bg-surface object-cover"
										/>
										<input
											id="set-logo"
											type="text"
											bind:value={logoUrl}
											placeholder="/logo.svg ou https://.../logo-mdl.png"
											class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
										/>
									</div>
									<p class="text-[11px] text-muted">
										Laisse vide pour afficher le logo MDL officiel. Évite les liens Google/Brave Images : utilise l'adresse directe du fichier (<code class="font-mono">.png</code>, <code class="font-mono">.jpg</code>, <code class="font-mono">.svg</code>).
									</p>
								</div>

							<div class="space-y-1.5">
								<label for="set-rep" class="block text-sm font-semibold text-ink">
									Représentant légal / Référent
								</label>
								<input
									id="set-rep"
									type="text"
									bind:value={legalRepresentative}
									placeholder="Nom du président ou CPE référent"
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								/>
							</div>

							<div class="space-y-1.5">
								<label for="set-reg-mode" class="block text-sm font-semibold text-ink">
									Mode d'inscription élèves
								</label>
								<select
									id="set-reg-mode"
									bind:value={registrationMode}
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
								>
									<option value="open">Ouvert (tout élève peut s'inscrire)</option>
									<option value="school_code">Code établissement requis</option>
									<option value="invite_only">Sur invitation uniquement</option>
								</select>
							</div>
						</div>

						<div class="rounded-[10px] border border-border bg-surface p-3.5 space-y-2.5">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<label for="set-school-code" class="text-sm font-semibold text-ink">
									Code secret du lycée (haché HMAC côté serveur)
								</label>
								<Badge size="sm" variant={hasSchoolCode ? 'success' : 'neutral'}>
									{hasSchoolCode ? 'Code configuré' : 'Aucun code défini'}
								</Badge>
							</div>
							<input
								id="set-school-code"
								type="text"
								bind:value={schoolCode}
								disabled={clearSchoolCode}
								placeholder={hasSchoolCode ? 'Saisir un nouveau code pour le remplacer...' : 'Ex : LYCEE-2026'}
								class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none disabled:opacity-50"
							/>
							{#if hasSchoolCode && registrationMode !== 'school_code'}
								<label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
									<input type="checkbox" bind:checked={clearSchoolCode} class="size-4 accent-brand" />
									Supprimer le code établissement actuel
								</label>
							{/if}
						</div>

						<!-- Paiement en ligne Stripe (CB) -->
						<div id="stripe" class="rounded-[12px] border border-border bg-surface p-4 space-y-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h3 class="text-sm font-bold text-ink">Paiement en ligne Stripe (Carte bancaire)</h3>
									<p class="text-xs text-muted">
										Les clés secrètes sont chiffrées en AES-256-GCM en base de données. Utilisé pour la billetterie, la boutique et l'adhésion 1-clic.
									</p>
								</div>
								<Badge size="sm" variant={stripeEnabled && hasStripeSecretKey ? 'success' : hasStripeSecretKey ? 'warning' : 'neutral'}>
									{stripeEnabled && hasStripeSecretKey
										? 'CB Stripe active'
										: hasStripeSecretKey
											? 'Clé configurée (désactivée)'
											: 'Non configuré'}
								</Badge>
							</div>

							<label class="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer">
								<input type="checkbox" bind:checked={stripeEnabled} class="size-4 accent-brand" />
								Activer le paiement par carte bancaire Stripe sur le site
							</label>

							<div class="grid gap-4 sm:grid-cols-2">
								<div class="space-y-1.5">
									<label for="set-stripe-pk" class="block text-xs font-semibold text-ink">
										Clé publique Stripe (pk_test_... ou pk_live_...)
									</label>
									<input
										id="set-stripe-pk"
										type="text"
										bind:value={stripePublishableKey}
										placeholder="pk_test_..."
										class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none"
									/>
								</div>

								<div class="space-y-1.5">
									<label for="set-stripe-currency" class="block text-xs font-semibold text-ink">
										Devise Stripe
									</label>
									<select
										id="set-stripe-currency"
										bind:value={stripeCurrency}
										class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
									>
										<option value="eur">EUR (€)</option>
										<option value="chf">CHF</option>
									</select>
								</div>
							</div>

							<div class="grid gap-4 sm:grid-cols-2">
								<div class="space-y-1.5">
									<div class="flex items-center justify-between gap-2">
										<label for="set-stripe-sk" class="block text-xs font-semibold text-ink">
											Clé secrète Stripe (sk_test_... / sk_live_...)
										</label>
										{#if stripeSecretKeyHint}
											<span class="font-mono text-[11px] text-muted">{stripeSecretKeyHint}</span>
										{/if}
									</div>
									<input
										id="set-stripe-sk"
										type="password"
										autocomplete="off"
										bind:value={stripeSecretKey}
										disabled={clearStripeSecretKey}
										placeholder={hasStripeSecretKey ? 'Laisser vide pour conserver la clé enregistrée' : 'sk_test_...'}
										class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
									/>
									{#if hasStripeSecretKey}
										<label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
											<input type="checkbox" bind:checked={clearStripeSecretKey} class="size-3.5 accent-brand" />
											Effacer la clé secrète enregistrée
										</label>
									{/if}
								</div>

								<div class="space-y-1.5">
									<div class="flex items-center justify-between gap-2">
										<label for="set-stripe-whsec" class="block text-xs font-semibold text-ink">
											Secret Webhook Stripe (whsec_...)
										</label>
										<span class="text-[11px] text-muted">
											{hasStripeWebhookSecret ? 'Enregistré' : 'Optionnel en local'}
										</span>
									</div>
									<input
										id="set-stripe-whsec"
										type="password"
										autocomplete="off"
										bind:value={stripeWebhookSecret}
										disabled={clearStripeWebhookSecret}
										placeholder={hasStripeWebhookSecret ? 'Laisser vide pour conserver le secret' : 'whsec_...'}
										class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
									/>
									{#if hasStripeWebhookSecret}
										<label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
											<input type="checkbox" bind:checked={clearStripeWebhookSecret} class="size-3.5 accent-brand" />
											Effacer le secret webhook
										</label>
									{/if}
								</div>
							</div>

							<div class="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border bg-card px-3 py-2.5 text-xs">
								<div class="min-w-0 flex-1">
									<span class="font-semibold text-ink">Endpoint Webhook :</span>
									<code class="ml-1 font-mono text-muted break-all">/api/stripe/webhook</code>
									<span class="ml-1 text-muted">(événement : checkout.session.completed)</span>
								</div>
								<div class="flex items-center gap-2">
									<Button type="button" size="sm" variant="ghost" onclick={copyWebhookUrl}>
										Copier l'URL
									</Button>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										loading={testingStripe}
										onclick={handleTestStripe}
										disabled={!hasStripeSecretKey && !stripeSecretKey.trim()}
									>
										Tester la clé Stripe
									</Button>
								</div>
							</div>

							{#if stripeTestResult}
								<p class={`text-xs font-medium ${stripeTestResult.ok ? 'text-emerald-400' : 'text-danger'}`}>
									{stripeTestResult.message}
								</p>
							{/if}
						</div>

						<div class="flex justify-end">
							<Button type="submit" variant="primary" loading={savingSettings}>
								Enregistrer les paramètres
							</Button>
						</div>
					</form>
				{/if}
			</Card>
		{/if}

		<!-- Gestion des rôles & permissions -->
		{#if canManageRoles}
			<Card id="roles" class="space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 class="text-lg font-bold text-ink">Rôles & permissions</h2>
						<p class="mt-1 text-xs text-muted">
							Crée des rôles sur mesure (ex : Responsable cafétéria, Club radio), ajuste leurs permissions ou supprime un rôle personnalisé.
						</p>
					</div>
					<Button variant="primary" onclick={openCreateRoleModal}>
						+ Créer un rôle
					</Button>
				</div>

				{#if loadingRoles}
					<Skeleton variant="text" lines={5} />
				{:else if rolesList.length === 0}
					<p class="py-6 text-center text-sm text-muted">Aucun rôle configuré.</p>
				{:else}
					<div class="grid gap-3 md:grid-cols-2">
						{#each rolesList as role (role.slug)}
							<div class="flex flex-col justify-between gap-3 rounded-[14px] border border-border bg-surface p-4">
								<div class="space-y-1.5">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<div class="flex flex-wrap items-center gap-2">
											<h3 class="text-sm font-bold text-ink">{role.label}</h3>
											<Badge size="sm" variant={role.isSystem ? 'neutral' : 'brand'}>
												{role.isSystem ? 'Système' : 'Personnalisé'}
											</Badge>
											{#if role.isBureau}
												<Badge size="sm" variant="success">Bureau</Badge>
											{/if}
										</div>
										<span class="font-mono text-[11px] text-muted">{role.slug}</span>
									</div>
									{#if role.description}
										<p class="text-xs text-muted">{role.description}</p>
									{/if}
									<p class="text-xs font-medium text-muted">
										{role.permissions.length} permission{role.permissions.length > 1 ? 's' : ''} · {role.memberCount ?? 0} membre{(role.memberCount ?? 0) > 1 ? 's' : ''}
									</p>
								</div>

								<div class="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-3">
									<Button
										size="sm"
										variant="secondary"
										onclick={() => openEditRoleModal(role)}
									>
										Modifier permissions
									</Button>
									{#if role.slug !== 'president' && role.slug !== data.user?.role}
										<Button
											size="sm"
											variant="danger"
											onclick={() => openDeleteRoleModal(role)}
										>
											Supprimer
										</Button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		{/if}

		<!-- Journal d'audit SHA-256 -->
		{#if canReadAudit}
			<Card class="space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="text-lg font-bold text-ink">Journal d'audit SHA-256</h2>
							{#if auditChain}
								<Badge variant={auditChain.valid ? 'success' : 'danger'} dot>
									{auditChain.valid
										? `Chaîne intègre (${auditChain.total} entrées)`
										: `Rupture #${auditChain.brokenAtId ?? '?'}`}
								</Badge>
							{/if}
						</div>
						<p class="mt-1 text-xs text-muted">
							Chaque action critique est chaînée cryptographiquement (<code class="font-mono">entryHash = SHA256(prevHash + payload)</code>).
							{#if lastVerifiedAt}
								Dernière vérification : {formatDateTimeFr(lastVerifiedAt)}.
							{/if}
						</p>
					</div>

					<Button
						variant="secondary"
						loading={verifyingChain}
						onclick={() => loadAudit(true)}
					>
						Vérifier l'intégrité de la chaîne
					</Button>
				</div>

				<div class="flex flex-wrap items-center gap-2.5">
					<label for="audit-action-filter" class="sr-only">Filtrer par action</label>
					<input
						id="audit-action-filter"
						type="text"
						bind:value={actionFilter}
						placeholder="Filtrer par action (ex : ticket:scan, admin.settings_updated)..."
						class="min-h-10 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-1.5 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					/>
					<Button size="sm" variant="secondary" onclick={() => loadAudit(false)}>
						Filtrer
					</Button>
				</div>

				{#if loadingAudit}
					<Skeleton variant="text" lines={6} />
				{:else if auditLogs.length === 0}
					<p class="py-6 text-center text-sm text-muted">Aucune entrée d'audit correspondante.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full border-collapse text-left text-xs">
							<thead>
								<tr class="border-b border-border uppercase tracking-wider text-muted">
									<th class="py-2 pr-3">#</th>
									<th class="py-2 pr-3">Date</th>
									<th class="py-2 pr-3">Acteur</th>
									<th class="py-2 pr-3">Action</th>
									<th class="py-2 pr-3">Cible</th>
									<th class="py-2">Empreinte SHA-256</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border/70">
								{#each auditLogs as row (row.id)}
									<tr>
										<td class="py-2.5 pr-3 font-mono text-muted">{row.id}</td>
										<td class="py-2.5 pr-3 whitespace-nowrap text-muted">
											{formatDateTimeFr(row.createdAt)}
										</td>
										<td class="py-2.5 pr-3">
											<span class="font-semibold text-ink">{row.actorRole}</span>
											{#if row.actorUserId}
												<span class="text-muted"> #{row.actorUserId}</span>
											{/if}
										</td>
										<td class="py-2.5 pr-3 font-mono font-semibold text-ink">
											{row.action}
										</td>
										<td class="py-2.5 pr-3 text-muted">
											{row.targetType}{row.targetId ? ` #${row.targetId}` : ''}
										</td>
										<td class="py-2.5 font-mono text-[11px] text-muted" title={row.entryHash}>
											{row.entryHash.slice(0, 14)}…
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-xs text-muted">
						Affichage des {auditLogs.length} entrées les plus récentes sur {auditTotal}.
					</p>
				{/if}
			</Card>
		{/if}
	{/if}
</div>

<!-- Modal création / édition d'un rôle -->
<Modal
	bind:open={roleModalOpen}
	title={roleModalMode === 'create' ? 'Créer un nouveau rôle' : `Modifier « ${roleLabelInput || editingRoleSlug} »`}
	description={roleModalMode === 'create'
		? 'Définis le nom du rôle et coche les permissions autorisées.'
		: 'Les membres ayant ce rôle recevront ces permissions immédiatement.'}
	size="lg"
>
	<form id="role-editor-form" onsubmit={handleSaveRole} class="space-y-4">
		{#if roleFormError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{roleFormError}
			</div>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="role-label" class="block text-sm font-semibold text-ink">Nom du rôle</label>
				<input
					id="role-label"
					type="text"
					value={roleLabelInput}
					oninput={(e) => handleRoleLabelInput((e.currentTarget as HTMLInputElement).value)}
					required
					minlength={2}
					maxlength={60}
					placeholder="Ex : Responsable cafétéria"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="role-slug" class="block text-sm font-semibold text-ink">
					Identifiant technique
				</label>
				<input
					id="role-slug"
					type="text"
					bind:value={roleSlugInput}
					oninput={() => (roleSlugTouched = true)}
					disabled={roleModalMode === 'edit'}
					pattern={'^[a-z][a-z0-9_]*$'}
					minlength={2}
					maxlength={40}
					placeholder="responsable_cafeteria"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-60"
				/>
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="role-desc" class="block text-sm font-semibold text-ink">
				Description (optionnelle)
			</label>
			<input
				id="role-desc"
				type="text"
				bind:value={roleDescriptionInput}
				maxlength={300}
				placeholder="Ex : Gère les ventes cafétéria, les stocks et le scan à l'entrée."
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</div>

		{#if roleModalMode === 'create'}
			<div class="space-y-2 rounded-[10px] border border-brand/25 bg-brand/5 px-3.5 py-2.5">
				<span class="block text-xs font-semibold text-ink">
					Modèles MDL prêts à l’emploi (remplissage en 1 clic)
				</span>
				<div class="flex flex-wrap gap-1.5">
					{#each ROLE_PRESETS as preset (preset.slug)}
						<button
							type="button"
							onclick={() => applyRolePreset(preset)}
							class="cursor-pointer rounded-full border border-brand/30 bg-card px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white"
						>
							+ {preset.label}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-2.5">
			<span class="text-xs font-semibold text-muted">
				Copier un modèle de permissions ({rolePermissionsInput.length} sélectionnée{rolePermissionsInput.length > 1 ? 's' : ''})
			</span>
			<div class="flex flex-wrap gap-1.5">
				{#each rolesList as tpl (tpl.slug)}
					<button
						type="button"
						onclick={() => applyRoleTemplate(tpl.slug)}
						class="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink transition hover:border-brand hover:text-brand"
					>
						{tpl.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			{#each PERMISSION_GROUPS as group (group.id)}
				{@const allGroupSelected = group.permissions.every((p) => rolePermissionsInput.includes(p.key))}
				<div class="space-y-2 rounded-[12px] border border-border bg-surface p-3">
					<div class="flex items-center justify-between gap-2 border-b border-border/70 pb-1.5">
						<span class="text-xs font-bold uppercase tracking-wider text-ink">
							{group.label}
						</span>
						<button
							type="button"
							onclick={() => toggleGroupPermissions(group.permissions)}
							class="cursor-pointer text-xs font-semibold text-brand hover:underline"
						>
							{allGroupSelected ? 'Tout retirer' : 'Tout cocher'}
						</button>
					</div>
					<div class="space-y-1.5">
						{#each group.permissions as perm (perm.key)}
							{@const locked =
								editingRoleSlug === 'president' &&
								(perm.key === 'admin:roles' || perm.key === 'admin:settings')}
							<label class="flex items-start gap-2 text-xs text-ink cursor-pointer">
								<input
									type="checkbox"
									checked={rolePermissionsInput.includes(perm.key)}
									disabled={locked}
									onchange={() => togglePermission(perm.key)}
									class="mt-0.5 size-4 shrink-0 accent-brand disabled:opacity-60"
								/>
								<span>
									{perm.label}
									<span class="block font-mono text-[10px] text-muted">{perm.key}</span>
								</span>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (roleModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="role-editor-form" variant="primary" loading={savingRole}>
			{roleModalMode === 'create' ? 'Créer le rôle' : 'Enregistrer les permissions'}
		</Button>
	{/snippet}
</Modal>

<!-- Modal confirmation suppression d'un rôle -->
<Modal
	open={deleteRoleTarget !== null}
	onclose={() => (deleteRoleTarget = null)}
	title={deleteRoleTarget ? `Supprimer « ${deleteRoleTarget.label} »` : 'Supprimer le rôle'}
	description="Action définitive. Les membres et invitations liés seront réaffectés automatiquement."
	size="sm"
>
	{#if deleteRoleTarget}
		<div class="space-y-4">
			{#if deleteRoleError}
				<div
					role="alert"
					class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
				>
					{deleteRoleError}
				</div>
			{/if}

			<p class="text-sm text-ink">
				Ce rôle est actuellement attribué à <strong>{deleteRoleTarget.memberCount ?? 0} membre(s)</strong>. Choisis le rôle vers lequel les basculer automatiquement avant la suppression :
			</p>

			<div class="space-y-1.5">
				<label for="reassign-role" class="block text-sm font-semibold text-ink">
					Rôle de réaffectation
				</label>
				<select
					id="reassign-role"
					bind:value={reassignRoleSlug}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				>
					{#each rolesList as candidate (candidate.slug)}
						{#if candidate.slug !== deleteRoleTarget.slug}
							<option value={candidate.slug}>{candidate.label}</option>
						{/if}
					{/each}
				</select>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (deleteRoleTarget = null)}>Annuler</Button>
		<Button variant="danger" loading={deletingRole} onclick={confirmDeleteRole}>
			Supprimer ce rôle
		</Button>
	{/snippet}
</Modal>
