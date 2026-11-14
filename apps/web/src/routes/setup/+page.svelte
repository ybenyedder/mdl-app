<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import QRCode from 'qrcode';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatEuros } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	type RegistrationMode = 'open' | 'school_code' | 'invite_only';

	interface SchoolHit {
		uai: string;
		name: string;
		city: string;
		postalCode: string;
		department: string;
		academy: string;
		address: string;
	}

	interface SetupChecklist {
		hasAdmin: boolean;
		hasLocation: boolean;
		hasBranding: boolean;
		hasStripe: boolean;
		hasSupplier: boolean;
		hasEvents: boolean;
		hasMerch: boolean;
		hasMeetings: boolean;
	}

	let { data }: { data: PageData } = $props();

	let loading = $state(true);
	let needsAdminBootstrap = $state(false);
	let setupCompleted = $state(false);
	let checklist = $state<SetupChecklist | null>(null);
	let step = $state(1);

	// Étape 1 : Compte Admin + Localisation lycée
	let adminFirstName = $state('');
	let adminLastName = $state('');
	let adminEmail = $state('');
	let adminPassword = $state('');

	let schoolQuery = $state('');
	let searchingSchools = $state(false);
	let schoolHits = $state<SchoolHit[]>([]);
	let schoolSearchNote = $state('');

	let schoolName = $state('');
	let schoolCity = $state('');
	let schoolPostalCode = $state('');
	let schoolDepartment = $state('');
	let schoolUai = $state<string | null>(null);
	let mdlName = $state('');
	let legalRepresentative = $state('');

	// Étape 2 : Identité & Logo
	let primaryColor = $state('#1d4ed8');
	let accentColor = $state('#f59e0b');
	let logoUrl = $state('');
	let schoolYear = $state('2026-2027');

	// Étape 3 : Adhésions & Inscription
	let membershipFeeEur = $state('5');
	let registrationMode = $state<RegistrationMode>('open');
	let schoolCode = $state('');

	// Étape 4 : Stripe & Fournisseur Boutique
	let stripeEnabled = $state(false);
	let stripePublishableKey = $state('');
	let stripeSecretKey = $state('');
	let stripeWebhookSecret = $state('');
	let testingStripe = $state(false);
	let stripeTestMsg = $state<{ ok: boolean; text: string } | null>(null);

	let merchSupplierName = $state('');
	let merchSupplierEmail = $state('');
	let merchSupplierUrl = $state('');

	// Étape 5 : Kit démarrage & QR
	let createStarterKit = $state(true);
	let saving = $state(false);
	let saveError = $state('');
	let adhesionQrSvg = $state('');

	const canEdit = $derived(
		needsAdminBootstrap || (data.user ? hasPermission(data.user.role, 'admin:settings') : false)
	);

	const colorPresets = [
		{ name: 'Bleu Académie', primary: '#1d4ed8', accent: '#f59e0b' },
		{ name: 'Indigo Épuré', primary: '#4f46e5', accent: '#06b6d4' },
		{ name: 'Émeraude', primary: '#047857', accent: '#10b981' },
		{ name: 'Terracotta', primary: '#b45309', accent: '#f97316' },
		{ name: 'Ardoise Pro', primary: '#0f172a', accent: '#3b82f6' }
	];

	const stepsMeta = [
		{ id: 1, title: 'Lycée & Admin', subtitle: 'Lieu & compte Président' },
		{ id: 2, title: 'Couleurs & Logo', subtitle: 'Identité visuelle' },
		{ id: 3, title: 'Adhésions', subtitle: 'Cotisation & accès' },
		{ id: 4, title: 'Stripe & Merch', subtitle: 'CB & vrai fournisseur' },
		{ id: 5, title: 'Lancement', subtitle: 'Checklist & QR Code' }
	];

	function parseEurToCents(raw: string): number {
		const num = Number.parseFloat(String(raw).replace(',', '.').trim());
		if (!Number.isFinite(num) || num < 0) return 0;
		return Math.round(num * 100);
	}

	async function loadSetupState() {
		loading = true;
		try {
			const res = await fetch('/api/setup');
			const payload = (await res.json().catch(() => ({}))) as {
				needsAdminBootstrap?: boolean;
				setupCompleted?: boolean;
				checklist?: SetupChecklist;
				school?: {
					schoolName: string;
					schoolCity: string;
					schoolPostalCode: string;
					schoolDepartment: string;
					schoolUai: string | null;
					mdlName: string;
					legalRepresentative: string;
					primaryColor: string;
					accentColor: string;
					logoUrl: string | null;
					membershipFeeCents: number;
					schoolYear: string;
					registrationMode: RegistrationMode;
					stripeEnabled: boolean;
					stripePublishableKey: string | null;
					merchSupplierName: string;
					merchSupplierEmail: string;
					merchSupplierUrl: string;
				};
			};

			if (res.ok && payload.school) {
				needsAdminBootstrap = Boolean(payload.needsAdminBootstrap);
				setupCompleted = Boolean(payload.setupCompleted);
				checklist = payload.checklist ?? null;
				const s = payload.school;
				schoolName = s.schoolName;
				schoolCity = s.schoolCity || '';
				schoolPostalCode = s.schoolPostalCode || '';
				schoolDepartment = s.schoolDepartment || '';
				schoolUai = s.schoolUai || null;
				mdlName = s.mdlName;
				legalRepresentative = s.legalRepresentative || '';
				primaryColor = s.primaryColor || '#1d4ed8';
				accentColor = s.accentColor || '#f59e0b';
				logoUrl = s.logoUrl || '';
				membershipFeeEur = ((s.membershipFeeCents ?? 500) / 100).toString();
				schoolYear = s.schoolYear || '2026-2027';
				registrationMode = s.registrationMode || 'open';
				stripeEnabled = Boolean(s.stripeEnabled);
				stripePublishableKey = s.stripePublishableKey || '';
				merchSupplierName = s.merchSupplierName || '';
				merchSupplierEmail = s.merchSupplierEmail || '';
				merchSupplierUrl = s.merchSupplierUrl || '';
				createStarterKit = Boolean(payload.needsAdminBootstrap || !payload.checklist?.hasMerch);
			}

			if (typeof window !== 'undefined') {
				const adhUrl = `${window.location.origin}/adhesion`;
				adhesionQrSvg = await QRCode.toString(adhUrl, { type: 'svg', margin: 2, width: 180 });
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger l’assistant.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadSetupState();
	});

	async function searchOfficialSchools() {
		if (schoolQuery.trim().length < 2 || searchingSchools) return;
		searchingSchools = true;
		schoolSearchNote = '';
		try {
			const res = await fetch(`/api/schools/search?q=${encodeURIComponent(schoolQuery.trim())}`);
			const payload = (await res.json().catch(() => ({}))) as {
				results?: SchoolHit[];
				source?: string;
			};
			schoolHits = payload.results ?? [];
			if (schoolHits.length === 0) {
				schoolSearchNote =
					payload.source === 'offline'
						? 'Annuaire en ligne indisponible hors-ligne : saisis simplement ton lycée manuellement ci-dessous.'
						: 'Aucun lycée trouvé pour cette recherche, saisis-le directement ci-dessous.';
			}
		} catch {
			schoolSearchNote = 'Recherche indisponible : saisis ton lycée manuellement ci-dessous.';
		} finally {
			searchingSchools = false;
		}
	}

	function selectSchoolHit(hit: SchoolHit) {
		schoolName = hit.name;
		schoolCity = hit.city;
		schoolPostalCode = hit.postalCode;
		schoolDepartment = hit.department || hit.academy;
		schoolUai = hit.uai || null;
		const shortName = hit.name.replace(/^Lycée\s+(général\s+et\s+technologique\s+|polyvalent\s+|professionnel\s+)?/i, '').trim();
		mdlName = `MDL ${shortName || hit.city}`.slice(0, 80);
		schoolHits = [];
		toast.success('Établissement sélectionné', `${hit.name} (${hit.city})`);
	}

	async function testStripeKey() {
		if (testingStripe || !stripeSecretKey.trim()) return;
		testingStripe = true;
		stripeTestMsg = null;
		try {
			const res = await fetch('/api/admin/stripe/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secretKey: stripeSecretKey.trim() })
			});
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				message?: string;
				error?: string;
			};
			stripeTestMsg = {
				ok: Boolean(res.ok && payload.ok),
				text: payload.message || payload.error || 'Réponse inattendue de Stripe.'
			};
		} catch {
			stripeTestMsg = { ok: false, text: 'Erreur réseau lors du test Stripe.' };
		} finally {
			testingStripe = false;
		}
	}

	async function handleFinishSetup() {
		if (saving) return;
		saveError = '';

		if (!schoolName.trim() || !schoolCity.trim() || !mdlName.trim()) {
			saveError = 'Renseigne le nom du lycée, la ville (ex : Cagnes-sur-Mer) et le nom de la MDL.';
			step = 1;
			return;
		}

		if (needsAdminBootstrap) {
			if (!adminFirstName.trim() || !adminLastName.trim() || !adminEmail.trim() || adminPassword.length < 10) {
				saveError = 'Complète ton compte Président / Admin (email + mot de passe 10 caractères min.).';
				step = 1;
				return;
			}
		}

		if (registrationMode === 'school_code' && !schoolCode.trim()) {
			saveError = 'Saisis un code secret d’établissement pour le mode Code lycée.';
			step = 3;
			return;
		}

		saving = true;
		try {
			const body: Record<string, unknown> = {
				schoolName: schoolName.trim(),
				schoolCity: schoolCity.trim(),
				schoolPostalCode: schoolPostalCode.trim(),
				schoolDepartment: schoolDepartment.trim(),
				schoolUai,
				mdlName: mdlName.trim(),
				legalRepresentative: legalRepresentative.trim(),
				primaryColor,
				accentColor,
				logoUrl: logoUrl.trim() || null,
				membershipFeeCents: parseEurToCents(membershipFeeEur),
				schoolYear: schoolYear.trim(),
				registrationMode,
				stripeEnabled,
				stripePublishableKey: stripePublishableKey.trim() || null,
				merchSupplierName: merchSupplierName.trim(),
				merchSupplierEmail: merchSupplierEmail.trim(),
				merchSupplierUrl: merchSupplierUrl.trim(),
				createStarterKit,
				markCompleted: true
			};

			if (needsAdminBootstrap) {
				body.admin = {
					firstName: adminFirstName.trim(),
					lastName: adminLastName.trim(),
					email: adminEmail.trim(),
					password: adminPassword
				};
			}

			if (schoolCode.trim()) {
				body.schoolCode = schoolCode.trim();
			}
			if (stripeSecretKey.trim()) {
				body.stripeSecretKey = stripeSecretKey.trim();
			}
			if (stripeWebhookSecret.trim()) {
				body.stripeWebhookSecret = stripeWebhookSecret.trim();
			}

			const res = await fetch('/api/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.ok) {
				saveError = payload.error || payload.message || 'Impossible d’enregistrer la configuration.';
				return;
			}

			await invalidateAll();
			toast.success(
				'Plateforme configurée !',
				`${mdlName.trim()} (${schoolCity.trim()}) est prête.`
			);
			await goto('/admin/parametres');
		} catch {
			saveError = 'Erreur réseau lors de l’enregistrement.';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Didacticiel & configuration · {mdlName || data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-2">
			<Badge variant={needsAdminBootstrap ? 'warning' : setupCompleted ? 'success' : 'brand'} dot>
				{needsAdminBootstrap
					? 'Première installation'
					: setupCompleted
						? 'Configuration active'
						: 'Assistant de démarrage'}
			</Badge>
			{#if schoolCity}
				<Badge variant="neutral">{schoolName} · {schoolCity}</Badge>
			{/if}
		</div>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[32px]">
			Configurer votre MDL en 5 étapes
		</h1>
		<p class="text-sm text-muted">
			Didacticiel guidé pour héberger la plateforme, situer le lycée (ex : Lycée Renoir, Cagnes-sur-Mer), brancher Stripe et paramétrer la boutique.
		</p>
	</header>

	{#if loading}
		<Skeleton variant="card" height="320px" />
	{:else if !canEdit}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Accès réservé à l'administrateur</h2>
			<p class="text-sm text-muted">
				L'établissement a déjà un compte Président configuré. Connecte-toi avec un compte administrateur pour relancer le didacticiel.
			</p>
			<Button href="/connexion?redirect=/setup" variant="primary">Se connecter en Admin</Button>
		</Card>
	{:else}
		<!-- Barre d'étapes cliquable -->
		<nav aria-label="Étapes du didacticiel" class="grid grid-cols-2 gap-2 sm:grid-cols-5">
			{#each stepsMeta as s (s.id)}
				<button
					type="button"
					onclick={() => (step = s.id)}
					class={`cursor-pointer rounded-[12px] border p-2.5 text-left transition ${
						step === s.id
							? 'border-brand bg-brand-soft ring-1 ring-brand'
							: 'border-border bg-card hover:border-brand/40'
					}`}
				>
					<div class="text-[11px] font-bold uppercase tracking-wider text-muted">
						Étape {s.id}
					</div>
					<div class="text-xs font-semibold text-ink">{s.title}</div>
					<div class="text-[11px] text-muted truncate">{s.subtitle}</div>
				</button>
			{/each}
		</nav>

		{#if saveError}
			<div role="alert" class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm font-medium text-danger">
				{saveError}
			</div>
		{/if}

		<!-- ÉTAPE 1 -->
		{#if step === 1}
			<Card class="space-y-5">
				<div class="rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-xs text-ink">
					<strong>Didacticiel :</strong> Recherche directement ton lycée dans l'annuaire officiel de l'Éducation nationale (ou saisis manuellement ta ville, ex : <em>Lycée Auguste Renoir, Cagnes-sur-Mer</em>).
				</div>

				{#if needsAdminBootstrap}
					<div class="rounded-[12px] border border-amber-500/35 bg-amber-500/10 p-4 space-y-3">
						<div>
							<h2 class="text-sm font-bold text-ink">
								Création du compte Administrateur / Président (hébergement neuf)
							</h2>
							<p class="text-xs text-muted">
								Ce premier compte recevra automatiquement tous les droits d'administration de la MDL.
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<input
								type="text"
								placeholder="Prénom (ex : Camille)"
								bind:value={adminFirstName}
								class="min-h-11 rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink"
							/>
							<input
								type="text"
								placeholder="Nom (ex : Laurent)"
								bind:value={adminLastName}
								class="min-h-11 rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink"
							/>
							<input
								type="email"
								placeholder="Email admin (ex : president@mdl.fr)"
								bind:value={adminEmail}
								class="min-h-11 rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink"
							/>
							<input
								type="password"
								placeholder="Mot de passe (10 caractères min.)"
								bind:value={adminPassword}
								class="min-h-11 rounded-[10px] border border-border bg-card px-3.5 py-2 text-sm text-ink"
							/>
						</div>
					</div>
				{/if}

				<div class="space-y-2">
					<label for="school-search" class="block text-sm font-semibold text-ink">
						Trouver ton lycée dans l'annuaire officiel (France)
					</label>
					<div class="flex gap-2">
						<input
							id="school-search"
							type="search"
							bind:value={schoolQuery}
							placeholder="Ex : Renoir Cagnes-sur-Mer, Moulin 06..."
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									searchOfficialSchools();
								}
							}}
							class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
						<Button type="button" variant="secondary" loading={searchingSchools} onclick={searchOfficialSchools}>
							Rechercher
						</Button>
					</div>
					{#if schoolSearchNote}
						<p class="text-xs text-muted">{schoolSearchNote}</p>
					{/if}
					{#if schoolHits.length > 0}
						<ul class="divide-y divide-border rounded-[10px] border border-border bg-surface">
							{#each schoolHits as hit (hit.uai || hit.name + hit.postalCode)}
								<li>
									<button
										type="button"
										onclick={() => selectSchoolHit(hit)}
										class="w-full cursor-pointer px-3.5 py-2.5 text-left hover:bg-card transition"
									>
										<div class="text-sm font-semibold text-ink">{hit.name}</div>
										<div class="text-xs text-muted">
											{hit.postalCode} {hit.city} · {hit.department || hit.academy} · UAI {hit.uai}
										</div>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="wiz-school" class="block text-sm font-semibold text-ink">Nom du lycée</label>
						<input
							id="wiz-school"
							type="text"
							bind:value={schoolName}
							placeholder="Ex : Lycée Auguste Renoir"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-city" class="block text-sm font-semibold text-ink">Ville / Commune</label>
						<input
							id="wiz-city"
							type="text"
							bind:value={schoolCity}
							placeholder="Ex : Cagnes-sur-Mer"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-cp" class="block text-sm font-semibold text-ink">Code postal</label>
						<input
							id="wiz-cp"
							type="text"
							bind:value={schoolPostalCode}
							placeholder="Ex : 06800"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-dept" class="block text-sm font-semibold text-ink">Département / Académie</label>
						<input
							id="wiz-dept"
							type="text"
							bind:value={schoolDepartment}
							placeholder="Ex : Alpes-Maritimes (Nice)"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-mdl" class="block text-sm font-semibold text-ink">Nom de la MDL</label>
						<input
							id="wiz-mdl"
							type="text"
							bind:value={mdlName}
							placeholder="Ex : MDL Renoir"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-rep" class="block text-sm font-semibold text-ink">Chef d'établissement / Référent</label>
						<input
							id="wiz-rep"
							type="text"
							bind:value={legalRepresentative}
							placeholder="Nom du proviseur ou CPE référent"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
				</div>
			</Card>
		{/if}

		<!-- ÉTAPE 2 -->
		{#if step === 2}
			<Card class="space-y-5">
				<div class="rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-xs text-ink">
					<strong>Didacticiel :</strong> Choisis les couleurs officielles de ton lycée et le lien vers votre logo PNG/SVG. Tout le site et l'application mobile PWA prennent immédiatement ces couleurs.
				</div>

				<div class="space-y-2">
					<span class="block text-sm font-semibold text-ink">Palettes rapides</span>
					<div class="flex flex-wrap gap-2">
						{#each colorPresets as preset (preset.name)}
							<button
								type="button"
								onclick={() => {
									primaryColor = preset.primary;
									accentColor = preset.accent;
								}}
								class="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:border-brand"
							>
								<span class="size-3.5 rounded-full" style={`background:${preset.primary}`}></span>
								<span class="size-3.5 rounded-full" style={`background:${preset.accent}`}></span>
								{preset.name}
							</button>
						{/each}
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="wiz-pcol" class="block text-sm font-semibold text-ink">Couleur principale</label>
						<div class="flex items-center gap-2">
							<input id="wiz-pcol" type="color" bind:value={primaryColor} class="h-11 w-14 cursor-pointer rounded-[8px] border border-border bg-surface p-1" />
							<input type="text" bind:value={primaryColor} class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3 font-mono text-sm text-ink" />
						</div>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-acol" class="block text-sm font-semibold text-ink">Couleur secondaire</label>
						<div class="flex items-center gap-2">
							<input id="wiz-acol" type="color" bind:value={accentColor} class="h-11 w-14 cursor-pointer rounded-[8px] border border-border bg-surface p-1" />
							<input type="text" bind:value={accentColor} class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3 font-mono text-sm text-ink" />
						</div>
					</div>
					<div class="space-y-1.5">
						<label for="wiz-logo" class="block text-sm font-semibold text-ink">Logo de la MDL (URL optionnelle)</label>
						<input id="wiz-logo" type="text" bind:value={logoUrl} placeholder="https://.../logo-mdl.png" class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink" />
					</div>
					<div class="space-y-1.5">
						<label for="wiz-year" class="block text-sm font-semibold text-ink">Année scolaire</label>
						<input id="wiz-year" type="text" bind:value={schoolYear} class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink" />
					</div>
				</div>

				<div class="rounded-[12px] border border-border bg-surface p-4 flex items-center justify-between gap-3">
					<div class="flex items-center gap-3">
						<span class="flex size-10 items-center justify-center rounded-[10px] text-sm font-bold text-white" style={`background:${primaryColor}`}>
							{mdlName.slice(0, 3).toUpperCase() || 'MDL'}
						</span>
						<div>
							<div class="font-bold text-ink">{mdlName || 'Ma MDL'}</div>
							<div class="text-xs text-muted">{schoolName}{schoolCity ? ` · ${schoolCity}` : ''}</div>
						</div>
					</div>
					<span class="rounded-full px-3 py-1 text-xs font-semibold text-white" style={`background:${accentColor}`}>
						Aperçu actif
					</span>
				</div>
			</Card>
		{/if}

		<!-- ÉTAPE 3 -->
		{#if step === 3}
			<Card class="space-y-5">
				<div class="rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-xs text-ink">
					<strong>Didacticiel :</strong> Définis le tarif de la cotisation annuelle et si les élèves peuvent s'inscrire librement, avec un code lycée communiqué au foyer, ou uniquement sur invitation.
				</div>

				<div class="space-y-2">
					<span class="block text-sm font-semibold text-ink">Cotisation annuelle (€)</span>
					<div class="flex flex-wrap gap-2">
						{#each ['0', '5', '10', '15'] as eur (eur)}
							<button
								type="button"
								onclick={() => (membershipFeeEur = eur)}
								class={`cursor-pointer rounded-[8px] border px-3.5 py-2 text-xs font-semibold ${
									membershipFeeEur === eur
										? 'border-brand bg-brand-soft text-ink ring-1 ring-brand'
										: 'border-border bg-surface text-muted'
								}`}
							>
								{eur === '0' ? 'Gratuit (0 €)' : `${eur} €`}
							</button>
						{/each}
						<input
							type="text"
							bind:value={membershipFeeEur}
							aria-label="Montant cotisation en euros"
							class="min-h-10 w-28 rounded-[8px] border border-border bg-surface px-3 text-sm text-ink"
						/>
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="wiz-regmode" class="block text-sm font-semibold text-ink">Mode d'inscription des élèves</label>
						<select
							id="wiz-regmode"
							bind:value={registrationMode}
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
						>
							<option value="open">Ouvert à tout le lycée</option>
							<option value="school_code">Code secret du lycée requis</option>
							<option value="invite_only">Sur invitation par email uniquement</option>
						</select>
					</div>

					<div class="space-y-1.5">
						<label for="wiz-code" class="block text-sm font-semibold text-ink">
							Code secret du lycée {registrationMode === 'school_code' ? '(requis)' : '(optionnel)'}
						</label>
						<input
							id="wiz-code"
							type="text"
							bind:value={schoolCode}
							placeholder="Ex : RENOIR-2026"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
						/>
					</div>
				</div>
			</Card>
		{/if}

		<!-- ÉTAPE 4 -->
		{#if step === 4}
			<Card class="space-y-5">
				<div class="space-y-3 rounded-[12px] border border-border bg-surface p-4">
					<div>
						<h2 class="text-sm font-bold text-ink">1. Paiement CB Stripe (optionnel)</h2>
						<ol class="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-muted">
							<li>Crée un compte associatif gratuit sur <strong>dashboard.stripe.com</strong>.</li>
							<li>Ouvre <strong>Développeurs → Clés API</strong> et copie ta clé publique (<code>pk_...</code>) et secrète (<code>sk_...</code>).</li>
							<li>En production HTTPS, ajoute le webhook <code>/api/stripe/webhook</code> sur <code>checkout.session.completed</code>.</li>
						</ol>
					</div>

					<label class="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
						<input type="checkbox" bind:checked={stripeEnabled} class="size-4 accent-brand" />
						Activer les paiements CB Stripe (billetterie, boutique, adhésion)
					</label>

					<div class="grid gap-3 sm:grid-cols-2">
						<input
							type="text"
							bind:value={stripePublishableKey}
							placeholder="Clé publique pk_test_... ou pk_live_..."
							class="min-h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
						<input
							type="password"
							bind:value={stripeSecretKey}
							placeholder="Clé secrète sk_test_... ou sk_live_..."
							class="min-h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
					</div>

					<div class="flex flex-wrap items-center justify-between gap-2">
						<input
							type="password"
							bind:value={stripeWebhookSecret}
							placeholder="Secret webhook whsec_... (optionnel en local)"
							class="min-h-10 min-w-[240px] flex-1 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							loading={testingStripe}
							disabled={!stripeSecretKey.trim()}
							onclick={testStripeKey}
						>
							Tester la clé Stripe
						</Button>
					</div>
					{#if stripeTestMsg}
						<p class={`text-xs font-medium ${stripeTestMsg.ok ? 'text-emerald-500' : 'text-danger'}`}>
							{stripeTestMsg.text}
						</p>
					{/if}
				</div>

				<div class="space-y-3 rounded-[12px] border border-border bg-surface p-4">
					<div>
						<h2 class="text-sm font-bold text-ink">2. Vrai fournisseur textile de votre boutique (optionnel)</h2>
						<p class="mt-1 text-xs text-muted">
							La boutique fonctionne en <strong>précommandes zéro avance de trésorerie</strong> : elle agrège automatiquement toutes les tailles XS→XXL et génère un <strong>bon de commande officiel</strong> prêt à envoyer à votre imprimeur/brodeur réel (atelier local près de {schoolCity || 'votre lycée'}, sérigraphe, Stanley/Stella, Wordans, Printful…).
						</p>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						<input
							type="text"
							bind:value={merchSupplierName}
							placeholder="Nom fournisseur (ex : Atelier Azur)"
							class="min-h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
						<input
							type="email"
							bind:value={merchSupplierEmail}
							placeholder="Email devis/commandes fournisseur"
							class="min-h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
						<input
							type="url"
							bind:value={merchSupplierUrl}
							placeholder="Site / catalogue (https://...)"
							class="min-h-11 rounded-[10px] border border-border bg-card px-3 text-sm text-ink"
						/>
					</div>
				</div>
			</Card>
		{/if}

		<!-- ÉTAPE 5 -->
		{#if step === 5}
			<Card class="space-y-5">
				<div class="grid gap-5 sm:grid-cols-3 sm:items-center">
					<div class="sm:col-span-2 space-y-3">
						<h2 class="text-lg font-bold text-ink">Prêt pour le lancement !</h2>
						<ul class="space-y-1.5 text-sm text-ink">
							<li>✓ Lycée : <strong>{schoolName}</strong> ({schoolPostalCode} {schoolCity})</li>
							<li>✓ Association : <strong>{mdlName}</strong> · Année {schoolYear}</li>
							<li>✓ Cotisation : <strong>{formatEuros(parseEurToCents(membershipFeeEur))}</strong> ({registrationMode})</li>
							<li>✓ Stripe CB : <strong>{stripeEnabled ? 'Activé' : 'Paiement bureau MDL (espèces/virement)'}</strong></li>
							<li>✓ Fournisseur boutique : <strong>{merchSupplierName || 'À définir plus tard'}</strong></li>
						</ul>

						<label class="flex items-start gap-2.5 rounded-[10px] border border-border bg-surface p-3 text-xs text-ink cursor-pointer">
							<input type="checkbox" bind:checked={createStarterKit} class="mt-0.5 size-4 accent-brand" />
							<span>
								<strong>Générer le kit de démarrage</strong> (1 pull de promo exemple, 1 événement d'accueil public et 1 réunion de bureau prêts à modifier si la base est vide).
							</span>
						</label>
					</div>

					{#if adhesionQrSvg}
						<div class="rounded-[12px] border border-border bg-surface p-3 text-center space-y-2">
							<div class="mx-auto inline-block rounded-xl bg-white p-2">
								<div class="size-32 [&>svg]:h-full [&>svg]:w-full">{@html adhesionQrSvg}</div>
							</div>
							<div class="text-[11px] font-semibold text-ink">QR d'adhésion directe (/adhesion)</div>
						</div>
					{/if}
				</div>
			</Card>
		{/if}

		<!-- Navigation bas de didacticiel -->
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				{#if step > 1}
					<Button type="button" variant="secondary" onclick={() => (step -= 1)}>
						← Étape précédente
					</Button>
				{/if}
				{#if checklist}
					<span class="text-xs text-muted">
						{checklist.hasLocation ? 'Lieu OK' : 'Lieu à compléter'} · {checklist.hasEvents ? 'Événements prêts' : '0 événement'}
					</span>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				{#if step < 5}
					<Button type="button" variant="primary" onclick={() => (step += 1)}>
						Étape suivante →
					</Button>
				{:else}
					<Button type="button" variant="primary" loading={saving} onclick={handleFinishSetup}>
						Finaliser & enregistrer la configuration
					</Button>
				{/if}
			</div>
		</div>
	{/if}
</div>
