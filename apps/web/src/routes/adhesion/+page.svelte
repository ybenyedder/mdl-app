<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatEuros } from '$shared/format';
	import type { PageData } from './$types';

	type AdhesionPaymentMethod = 'stripe' | 'especes' | 'virement' | 'cheque' | 'gratuit';

	interface AdhesionInfo {
		schoolName: string;
		mdlName: string;
		schoolYear: string;
		membershipFeeCents: number;
		registrationMode: 'open' | 'school_code' | 'invite_only';
		stripeEnabled: boolean;
		user: {
			id: number;
			firstName: string;
			lastName: string;
			email: string;
			classe: string;
			isAdherent: boolean;
		} | null;
	}

	let { data }: { data: PageData } = $props();

	let loading = $state(true);
	let info = $state<AdhesionInfo | null>(null);

	let firstName = $state('');
	let lastName = $state('');
	let classe = $state('');
	let email = $state('');
	let password = $state('');
	let rgpdConsent = $state(false);
	let paymentMethod = $state<AdhesionPaymentMethod>('especes');

	let submitting = $state(false);
	let formError = $state('');
	let completedState = $state<'none' | 'activated' | 'pending'>('none');
	let completedMethod = $state<AdhesionPaymentMethod>('especes');

	async function loadAdhesionInfo() {
		loading = true;
		try {
			const res = await fetch('/api/adhesion');
			const payload = (await res.json().catch(() => ({}))) as AdhesionInfo & { ok?: boolean };
			if (res.ok && payload.ok) {
				info = payload;
				if (payload.membershipFeeCents === 0) {
					paymentMethod = 'gratuit';
				} else if (payload.stripeEnabled) {
					paymentMethod = 'stripe';
				} else {
					paymentMethod = 'especes';
				}
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger les informations d’adhésion.');
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const stripeStatus = params.get('stripe_status');
		const sessionId = params.get('session_id');

		if (stripeStatus === 'cancel') {
			toast.info('Paiement annulé', 'Ton adhésion par carte n’a pas été finalisée.');
		} else if (stripeStatus === 'success' && sessionId) {
			try {
				const vRes = await fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`);
				const vData = (await vRes.json().catch(() => ({}))) as { paid?: boolean; error?: string };
				if (vRes.ok && vData.paid) {
					completedState = 'activated';
					completedMethod = 'stripe';
					await invalidateAll();
					toast.success('Adhésion activée !', 'Bienvenue officiellement à la MDL.');
				} else if (vData.error) {
					toast.warning('Vérification paiement', vData.error);
				}
			} catch {
				// Ignorer
			}
		}

		await loadAdhesionInfo();
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!info || submitting) return;
		formError = '';

		const payloadBody: Record<string, unknown> = {
			paymentMethod: info.membershipFeeCents === 0 ? 'gratuit' : paymentMethod
		};

		if (!info.user) {
			if (!firstName.trim() || !lastName.trim() || !classe.trim() || !email.trim() || !password) {
				formError = 'Tous les champs d’identité et le mot de passe sont requis.';
				return;
			}
			if (password.length < 10) {
				formError = 'Le mot de passe doit contenir au moins 10 caractères.';
				return;
			}
			if (!rgpdConsent) {
				formError = 'Tu dois accepter la charte RGPD pour adhérer.';
				return;
			}
			payloadBody.firstName = firstName.trim();
			payloadBody.lastName = lastName.trim();
			payloadBody.classe = classe.trim();
			payloadBody.email = email.trim();
			payloadBody.password = password;
			payloadBody.rgpdConsent = rgpdConsent;
		}

		submitting = true;
		try {
			const res = await fetch('/api/adhesion', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payloadBody)
			});
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				alreadyAdherent?: boolean;
				activated?: boolean;
				pendingValidation?: boolean;
				checkoutUrl?: string;
				paymentMethod?: AdhesionPaymentMethod;
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				formError = payload.error || payload.message || 'Impossible de traiter ton adhésion.';
				return;
			}

			if (payload.checkoutUrl) {
				toast.info('Redirection vers Stripe...', 'Finalise le paiement sécurisé de ta cotisation.');
				window.location.href = payload.checkoutUrl;
				return;
			}

			if (payload.alreadyAdherent || payload.activated) {
				completedState = 'activated';
				completedMethod = payload.paymentMethod ?? paymentMethod;
				await invalidateAll();
				await loadAdhesionInfo();
				toast.success('Adhésion active !');
				return;
			}

			if (payload.pendingValidation) {
				completedState = 'pending';
				completedMethod = payload.paymentMethod ?? paymentMethod;
				await invalidateAll();
				await loadAdhesionInfo();
				toast.success('Demande enregistrée !', 'Règle ta cotisation au bureau MDL pour activation.');
			}
		} catch {
			formError = 'Erreur réseau lors de l’adhésion.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Adhésion directe · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="space-y-1.5 text-center">
		<Badge variant="brand">Adhésion {info?.schoolYear ?? data.settings.schoolYear}</Badge>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[32px]">
			Adhérer à {data.settings.mdlName}
		</h1>
		<p class="text-sm text-muted">
			Rejoins la Maison des Lycéens en 1 minute pour profiter des tarifs réduits billetterie, de la boutique et des votes.
		</p>
	</header>

	{#if loading}
		<Skeleton variant="card" height="280px" />
	{:else if info}
		{#if info.user?.isAdherent || completedState === 'activated'}
			<Card padding="lg" class="text-center space-y-4">
				<Badge variant="success" dot>Adhérent actif · {info.schoolYear}</Badge>
				<h2 class="text-xl font-bold text-ink">
					Ton adhésion à {info.mdlName} est validée !
				</h2>
				<p class="text-sm text-muted">
					Tu bénéficies automatiquement du tarif adhérent en billetterie et de l'accès complet aux espaces membres.
				</p>
				<div class="flex flex-wrap justify-center gap-3 pt-2">
					<Button href="/billetterie" variant="primary">Voir la billetterie</Button>
					<Button href="/boutique" variant="secondary">Voir la boutique</Button>
				</div>
			</Card>
		{:else if completedState === 'pending'}
			<Card padding="lg" class="text-center space-y-4">
				<Badge variant="warning" dot>En attente de règlement ({completedMethod})</Badge>
				<h2 class="text-xl font-bold text-ink">Pré-adhésion enregistrée !</h2>
				<p class="text-sm text-muted">
					Passe au foyer / bureau MDL régler ta cotisation de <strong>{formatEuros(info.membershipFeeCents)}</strong> par <strong>{completedMethod}</strong> pour activer instantanément ta carte adhérent.
				</p>
				<div class="flex flex-wrap justify-center gap-3 pt-2">
					<Button href="/" variant="primary">Retour à l'accueil</Button>
				</div>
			</Card>
		{:else if !info.user && info.registrationMode === 'invite_only'}
			<Card padding="lg" class="text-center space-y-3">
				<h2 class="text-lg font-bold text-ink">Adhésion sur invitation uniquement</h2>
				<p class="text-sm text-muted">
					Demande un lien d'invitation au bureau MDL ou connecte-toi si tu as déjà un compte élève.
				</p>
				<Button href="/connexion?redirect=/adhesion" variant="primary">Se connecter</Button>
			</Card>
		{:else}
			<Card class="space-y-5">
				<div class="flex items-center justify-between rounded-[12px] border border-border bg-surface px-4 py-3">
					<div>
						<div class="text-xs text-muted">Cotisation annuelle {info.schoolYear}</div>
						<div class="text-sm font-semibold text-ink">{info.schoolName}</div>
					</div>
					<div class="text-xl font-bold tabular-nums text-ink">
						{info.membershipFeeCents === 0 ? 'Gratuite' : formatEuros(info.membershipFeeCents)}
					</div>
				</div>

				<form onsubmit={handleSubmit} class="space-y-4">
					{#if formError}
						<div role="alert" class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-sm text-danger">
							{formError}
						</div>
					{/if}

					{#if info.user}
						<div class="rounded-[10px] border border-border bg-surface p-3.5 text-sm space-y-1">
							<div class="font-semibold text-ink">
								Connecté en tant que {info.user.firstName} {info.user.lastName}
							</div>
							<div class="text-xs text-muted">
								Classe : {info.user.classe || 'Non renseignée'} · {info.user.email}
							</div>
						</div>
					{:else}
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="space-y-1.5">
								<label for="adh-fn" class="block text-sm font-semibold text-ink">Prénom</label>
								<input
									id="adh-fn"
									type="text"
									required
									bind:value={firstName}
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
								/>
							</div>
							<div class="space-y-1.5">
								<label for="adh-ln" class="block text-sm font-semibold text-ink">Nom</label>
								<input
									id="adh-ln"
									type="text"
									required
									bind:value={lastName}
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
								/>
							</div>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<div class="space-y-1.5">
								<label for="adh-classe" class="block text-sm font-semibold text-ink">Classe</label>
								<input
									id="adh-classe"
									type="text"
									required
									bind:value={classe}
									placeholder="Ex : 2nde 4"
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
								/>
							</div>
							<div class="space-y-1.5">
								<label for="adh-email" class="block text-sm font-semibold text-ink">Email</label>
								<input
									id="adh-email"
									type="email"
									required
									bind:value={email}
									class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
								/>
							</div>
						</div>

						<div class="space-y-1.5">
							<label for="adh-pwd" class="block text-sm font-semibold text-ink">
								Mot de passe du compte élève (10 caractères min.)
							</label>
							<input
								id="adh-pwd"
								type="password"
								required
								minlength="10"
								bind:value={password}
								class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
							/>
						</div>
					{/if}

					{#if info.membershipFeeCents > 0}
						<div class="space-y-1.5">
							<label for="adh-method" class="block text-sm font-semibold text-ink">
								Mode de règlement de la cotisation
							</label>
							<select
								id="adh-method"
								bind:value={paymentMethod}
								class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
							>
								{#if info.stripeEnabled}
									<option value="stripe">Carte bancaire en ligne (Stripe — activation immédiate)</option>
								{/if}
								<option value="especes">Espèces au bureau MDL</option>
								<option value="virement">Virement bancaire</option>
								<option value="cheque">Chèque à l'ordre de la MDL</option>
							</select>
						</div>
					{/if}

					{#if !info.user}
						<label class="flex items-start gap-2.5 text-xs text-muted cursor-pointer">
							<input type="checkbox" bind:checked={rgpdConsent} required class="mt-0.5 size-4 accent-brand" />
							<span>
								J'accepte le traitement de mes données par la MDL dans le strict respect du RGPD (chiffrement local, aucun tracking tiers).
							</span>
						</label>
					{/if}

					<Button type="submit" variant="primary" fullWidth loading={submitting}>
						{#if info.membershipFeeCents === 0}
							Activer mon adhésion gratuitement
						{:else if paymentMethod === 'stripe'}
							Payer {formatEuros(info.membershipFeeCents)} par CB & adhérer
						{:else}
							Enregistrer mon adhésion ({formatEuros(info.membershipFeeCents)} sur place)
						{/if}
					</Button>
				</form>

				{#if !info.user}
					<p class="text-center text-xs text-muted">
						Déjà un compte élève ?
						<a href="/connexion?redirect=/adhesion" class="font-semibold text-brand hover:underline">
							Connecte-toi ici
						</a>
					</p>
				{/if}
			</Card>
		{/if}
	{/if}
</div>
