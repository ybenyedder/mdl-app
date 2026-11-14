<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr } from '$shared/format';
	import { getRoleLabel } from '$shared/permissions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// 2FA TOTP
	let totpSetupModalOpen = $state(false);
	let totpSecret = $state('');
	let totpQrSvg = $state('');
	let totpCode = $state('');
	let totpLoading = $state(false);
	let totpError = $state('');

	let totpDisableOpen = $state(false);
	let totpDisablePassword = $state('');
	let totpDisabling = $state(false);
	let totpDisableError = $state('');

	// Sessions & RGPD
	let loggingOutAll = $state(false);
	let exportingRgpd = $state(false);

	let deleteModalOpen = $state(false);
	let deletePassword = $state('');
	let deletingAccount = $state(false);
	let deleteError = $state('');
	let deletionInfo = $state<{
		deletionRequestedAt: string | null;
		scheduledDeletionAt: string | null;
	} | null>(null);

	async function startTotpSetup() {
		totpLoading = true;
		totpError = '';
		totpCode = '';
		try {
			const res = await fetch('/api/auth/totp', { method: 'POST' });
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				secret?: string;
				qrSvg?: string;
				error?: string;
				message?: string;
			};
			if (!res.ok || !payload.qrSvg || !payload.secret) {
				toast.error('Configuration 2FA impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}
			totpSecret = payload.secret;
			totpQrSvg = payload.qrSvg;
			totpSetupModalOpen = true;
		} catch {
			toast.error('Erreur réseau');
		} finally {
			totpLoading = false;
		}
	}

	async function activateTotp(event: SubmitEvent) {
		event.preventDefault();
		totpError = '';
		if (!/^\d{6}$/.test(totpCode.trim())) {
			totpError = 'Saisis le code à 6 chiffres généré par ton application.';
			return;
		}
		totpLoading = true;
		try {
			const res = await fetch('/api/auth/totp', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: totpCode.trim() })
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
			if (!res.ok) {
				totpError = payload.error || payload.message || 'Code TOTP invalide.';
				return;
			}
			totpSetupModalOpen = false;
			await invalidateAll();
			toast.success('Double authentification activée', 'Ton compte est protégé par TOTP.');
		} catch {
			totpError = 'Erreur réseau.';
		} finally {
			totpLoading = false;
		}
	}

	async function disableTotp(event: SubmitEvent) {
		event.preventDefault();
		totpDisableError = '';
		if (!totpDisablePassword) {
			totpDisableError = 'Mot de passe requis pour désactiver la 2FA.';
			return;
		}
		totpDisabling = true;
		try {
			const res = await fetch('/api/auth/totp', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: totpDisablePassword })
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
			if (!res.ok) {
				totpDisableError = payload.error || payload.message || 'Mot de passe incorrect.';
				return;
			}
			totpDisableOpen = false;
			totpDisablePassword = '';
			await invalidateAll();
			toast.success('2FA désactivée');
		} catch {
			totpDisableError = 'Erreur réseau.';
		} finally {
			totpDisabling = false;
		}
	}

	async function logoutAllDevices() {
		if (loggingOutAll) return;
		loggingOutAll = true;
		try {
			const res = await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ allDevices: true })
			});
			if (!res.ok) {
				toast.error('Erreur lors de la déconnexion globale');
				return;
			}
			await invalidateAll();
			toast.success('Toutes les sessions fermées', 'Reconnecte-toi sur cet appareil.');
			await goto('/connexion');
		} catch {
			toast.error('Erreur réseau');
		} finally {
			loggingOutAll = false;
		}
	}

	async function downloadRgpdExport() {
		if (exportingRgpd) return;
		exportingRgpd = true;
		try {
			const res = await fetch('/api/rgpd/export');
			if (!res.ok) {
				toast.error('Export RGPD impossible');
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `mdl-rgpd-export-${data.user?.id ?? 'moi'}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Export RGPD téléchargé', 'Archive JSON complète conforme Art. 15 & 20.');
		} catch {
			toast.error('Erreur réseau');
		} finally {
			exportingRgpd = false;
		}
	}

	async function requestAccountDeletion(event: SubmitEvent) {
		event.preventDefault();
		deleteError = '';
		deletingAccount = true;
		try {
			const res = await fetch('/api/rgpd/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cancel: false,
					password: deletePassword || undefined
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				deletionRequestedAt?: string;
				scheduledDeletionAt?: string;
				message?: string;
				error?: string;
			};
			if (!res.ok) {
				deleteError = payload.error || payload.message || 'Demande impossible.';
				return;
			}
			deletionInfo = {
				deletionRequestedAt: payload.deletionRequestedAt ?? new Date().toISOString(),
				scheduledDeletionAt: payload.scheduledDeletionAt ?? null
			};
			deleteModalOpen = false;
			deletePassword = '';
			toast.warning('Suppression programmée (30 jours)', payload.message || '');
		} catch {
			deleteError = 'Erreur réseau.';
		} finally {
			deletingAccount = false;
		}
	}

	async function cancelDeletionRequest() {
		deletingAccount = true;
		try {
			const res = await fetch('/api/rgpd/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cancel: true })
			});
			if (!res.ok) {
				toast.error('Annulation impossible');
				return;
			}
			deletionInfo = null;
			toast.success('Demande de suppression annulée');
		} catch {
			toast.error('Erreur réseau');
		} finally {
			deletingAccount = false;
		}
	}
</script>

<svelte:head>
	<title>Mon profil & sécurité · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
			Mon profil & données RGPD
		</h1>
		<p class="mt-1.5 text-sm text-muted">
			Informations personnelles, sécurité 2FA TOTP, gestion des sessions et exercice de tes droits RGPD.
		</p>
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Connecte-toi pour accéder à ton profil</h2>
			<Button href="/connexion?redirect=/profil" variant="primary">Se connecter</Button>
		</Card>
	{:else}
		<!-- Informations profil -->
		<Card class="space-y-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-bold text-ink">
						{data.user.firstName} {data.user.lastName}
					</h2>
					<p class="text-sm text-muted">{data.user.email}</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Badge variant="brand">
						{getRoleLabel(data.user.role, data.user.customTitle)}
					</Badge>
					<Badge variant={data.user.isAdherent ? 'success' : 'warning'} dot>
						{data.user.isAdherent ? 'Adhérent actif' : 'Adhésion en attente'}
					</Badge>
				</div>
			</div>

			<dl class="grid gap-3 border-t border-border pt-4 sm:grid-cols-3 text-sm">
				<div class="rounded-[10px] bg-surface p-3">
					<dt class="text-xs text-muted">Classe</dt>
					<dd class="mt-0.5 font-semibold text-ink">{data.user.classe || 'Non renseignée'}</dd>
				</div>
				<div class="rounded-[10px] bg-surface p-3">
					<dt class="text-xs text-muted">Rôle technique</dt>
					<dd class="mt-0.5 font-semibold text-ink">{getRoleLabel(data.user.role)}</dd>
				</div>
				<div class="rounded-[10px] bg-surface p-3">
					<dt class="text-xs text-muted">Double authentification</dt>
					<dd class="mt-0.5 font-semibold text-ink">
						{data.user.totpEnabled ? 'Activée (TOTP)' : 'Désactivée'}
					</dd>
				</div>
			</dl>
		</Card>

		<!-- Sécurité : 2FA TOTP + Déconnexion globale -->
		<div class="grid gap-5 md:grid-cols-2">
			<Card class="flex flex-col justify-between gap-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-base font-bold text-ink">Double authentification (2FA TOTP)</h2>
						<Badge variant={data.user.totpEnabled ? 'success' : 'neutral'} dot>
							{data.user.totpEnabled ? 'Active' : 'Inactive'}
						</Badge>
					</div>
					<p class="text-sm text-muted">
						Protège ton compte (recommandé pour le bureau et le trésorier) avec un code à 6 chiffres depuis FreeOTP, Aegis ou Google Authenticator.
					</p>
				</div>

				{#if data.user.totpEnabled}
					<Button
						variant="secondary"
						onclick={() => {
							totpDisableError = '';
							totpDisablePassword = '';
							totpDisableOpen = true;
						}}
					>
						Désactiver la 2FA
					</Button>
				{:else}
					<Button variant="primary" loading={totpLoading} onclick={startTotpSetup}>
						Configurer la 2FA (QR code)
					</Button>
				{/if}
			</Card>

			<Card class="flex flex-col justify-between gap-4">
				<div class="space-y-2">
					<h2 class="text-base font-bold text-ink">Appareils connectés</h2>
					<p class="text-sm text-muted">
						Tu as oublié de fermer ta session sur un ordinateur du CDI ou un téléphone prêté ? Révoque immédiatement toutes tes sessions actives.
					</p>
				</div>
				<Button variant="secondary" loading={loggingOutAll} onclick={logoutAllDevices}>
					Déconnecter tous les appareils
				</Button>
			</Card>
		</div>

		<!-- Droits RGPD -->
		<Card class="space-y-5">
			<div>
				<h2 class="text-lg font-bold text-ink">Mes droits RGPD</h2>
				<p class="mt-1 text-sm text-muted">
					Conformément au RGPD et à la protection des mineurs, tu peux récupérer l'intégralité de tes données ou demander l'effacement de ton compte.
				</p>
			</div>

			{#if deletionInfo?.deletionRequestedAt}
				<div class="rounded-[10px] border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
					<p class="text-sm font-bold text-amber-950 dark:text-amber-200">
						Demande de suppression enregistrée
					</p>
					<p class="text-xs text-ink">
						Demandée le {formatDateTimeFr(deletionInfo.deletionRequestedAt)}.
						{#if deletionInfo.scheduledDeletionAt}
							Suppression définitive prévue le {formatDateTimeFr(deletionInfo.scheduledDeletionAt)} (délai de rétractation de 30 jours).
						{/if}
					</p>
					<Button size="sm" variant="secondary" loading={deletingAccount} onclick={cancelDeletionRequest}>
						Annuler la demande de suppression
					</Button>
				</div>
			{/if}

			<div class="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
				<div>
					<p class="text-sm font-semibold text-ink">Export RGPD en 1 clic</p>
					<p class="text-xs text-muted">
						Télécharge un fichier JSON contenant ton profil, tes projets, tes billets et tes brouillons Parcoursup.
					</p>
				</div>
				<Button variant="primary" loading={exportingRgpd} onclick={downloadRgpdExport}>
					Export RGPD 1 clic
				</Button>
			</div>

			<div class="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
				<div>
					<p class="text-sm font-semibold text-red-700 dark:text-red-300">
						Supprimer mon compte (délai de grâce 30 jours)
					</p>
					<p class="text-xs text-muted">
						Programme la suppression de tes données personnelles. Tu peux annuler pendant 30 jours.
					</p>
				</div>
				<Button
					variant="danger"
					onclick={() => {
						deleteError = '';
						deletePassword = '';
						deleteModalOpen = true;
					}}
				>
					Demander la suppression
				</Button>
			</div>
		</Card>
	{/if}
</div>

<!-- Modal activation 2FA TOTP -->
<Modal
	bind:open={totpSetupModalOpen}
	title="Activer la double authentification (2FA)"
	description="Scanne ce QR code dans ton application TOTP puis saisis le code à 6 chiffres."
	size="md"
>
	<form id="totp-activate-form" onsubmit={activateTotp} class="space-y-4">
		{#if totpError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{totpError}
			</div>
		{/if}

		{#if totpQrSvg}
			<div class="text-center space-y-2">
				<div class="mx-auto inline-block rounded-2xl border border-border bg-white p-3">
					<div class="size-48 [&>svg]:h-full [&>svg]:w-full">
						{@html totpQrSvg}
					</div>
				</div>
				<p class="text-xs text-muted">
					Clé manuelle : <code class="font-mono font-bold text-ink select-all">{totpSecret}</code>
				</p>
			</div>
		{/if}

		<div class="space-y-1.5">
			<label for="totp-verify-code" class="block text-sm font-semibold text-ink">
				Code de vérification à 6 chiffres
			</label>
			<input
				id="totp-verify-code"
				type="text"
				inputmode="numeric"
				pattern={'[0-9]{6}'}
				maxlength={6}
				bind:value={totpCode}
				required
				placeholder="123456"
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-center font-mono text-lg font-bold tracking-[0.35em] text-ink focus:border-brand focus:outline-none"
			/>
		</div>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (totpSetupModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="totp-activate-form" variant="primary" loading={totpLoading}>
			Activer la 2FA
		</Button>
	{/snippet}
</Modal>

<!-- Modal désactivation 2FA -->
<Modal
	bind:open={totpDisableOpen}
	title="Désactiver la double authentification"
	description="Confirme avec ton mot de passe actuel."
	size="sm"
>
	<form id="totp-disable-form" onsubmit={disableTotp} class="space-y-3">
		{#if totpDisableError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{totpDisableError}
			</div>
		{/if}
		<div class="space-y-1.5">
			<label for="totp-disable-pwd" class="block text-sm font-semibold text-ink">Mot de passe</label>
			<input
				id="totp-disable-pwd"
				type="password"
				bind:value={totpDisablePassword}
				required
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (totpDisableOpen = false)}>Annuler</Button>
		<Button type="submit" form="totp-disable-form" variant="danger" loading={totpDisabling}>
			Désactiver la 2FA
		</Button>
	{/snippet}
</Modal>

<!-- Modal demande suppression RGPD 30 j -->
<Modal
	bind:open={deleteModalOpen}
	title="Programmer la suppression du compte"
	description="Tes données seront conservées en attente 30 jours avant effacement définitif."
	size="sm"
>
	<form id="rgpd-delete-form" onsubmit={requestAccountDeletion} class="space-y-3">
		{#if deleteError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{deleteError}
			</div>
		{/if}
		<p class="text-xs leading-relaxed text-muted">
			Tu pourras annuler cette demande à tout moment pendant 30 jours depuis cette page.
		</p>
		<div class="space-y-1.5">
			<label for="rgpd-del-pwd" class="block text-sm font-semibold text-ink">
				Mot de passe (si défini sur le compte)
			</label>
			<input
				id="rgpd-del-pwd"
				type="password"
				bind:value={deletePassword}
				placeholder="Laisse vide si connexion par lien magique"
				class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (deleteModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="rgpd-delete-form" variant="danger" loading={deletingAccount}>
			Confirmer (30 jours)
		</Button>
	{/snippet}
</Modal>
