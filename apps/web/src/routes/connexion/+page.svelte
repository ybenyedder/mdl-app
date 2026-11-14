<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { loginSchema } from '$shared/schemas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type AuthTab = 'password' | 'magic';

	let activeTab = $state<AuthTab>('password');

	let email = $state('');
	let password = $state('');
	let totpCode = $state('');
	let showPassword = $state(false);
	let requiresTotp = $state(false);

	let magicEmail = $state('');
	let magicSent = $state(false);
	let magicServerMessage = $state('');
	let magicPreviewUrl = $state<string | null>(null);
	let magicTotpCode = $state('');

	let submitting = $state(false);
	let errorMessage = $state('');

	const magicTotpPending = $derived(page.url.searchParams.get('totp') === '1');

	const redirectTarget = $derived.by(() => {
		const raw = page.url.searchParams.get('redirect') || '';
		if (raw.startsWith('/') && !raw.startsWith('//')) {
			return raw;
		}
		return '/dashboard';
	});

	function switchTab(next: AuthTab) {
		activeTab = next;
		errorMessage = '';
	}

	async function handlePasswordLogin(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		const parsed = loginSchema.safeParse({
			email,
			password,
			totpCode: requiresTotp ? totpCode : undefined
		});

		if (!parsed.success) {
			errorMessage = parsed.error.issues[0]?.message || 'Vérifie tes informations de connexion.';
			return;
		}

		if (requiresTotp && !/^\d{6}$/.test(totpCode.trim())) {
			errorMessage = 'Saisis le code à 6 chiffres de ton application d’authentification.';
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: parsed.data.email,
					password: parsed.data.password,
					totpCode: requiresTotp ? totpCode.trim() : undefined
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				requiresTotp?: boolean;
				error?: string;
				message?: string;
			};

			if (payload.requiresTotp && !requiresTotp) {
				requiresTotp = true;
				toast.info(
					'Vérification 2FA requise',
					'Entre le code à 6 chiffres de ton application d’authentification.'
				);
				return;
			}

			if (!res.ok) {
				if (payload.requiresTotp) {
					requiresTotp = true;
				}
				errorMessage = payload.error || payload.message || 'Email ou mot de passe incorrect.';
				return;
			}

			toast.success('Connexion réussie', `Ravi de te revoir sur ${data.settings.mdlName}.`);
			await invalidateAll();
			await goto(redirectTarget);
		} catch {
			errorMessage = 'Impossible de joindre le serveur. Vérifie ta connexion.';
		} finally {
			submitting = false;
		}
	}

	async function handleMagicLink(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		const cleanEmail = magicEmail.trim();
		if (!cleanEmail || !cleanEmail.includes('@')) {
			errorMessage = 'Entre une adresse email valide.';
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/auth/magic', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: cleanEmail })
			});

			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
				previewMagicUrl?: string;
			};

			if (!res.ok) {
				errorMessage = payload.error || payload.message || "Impossible d'envoyer le lien magique.";
				return;
			}

			magicServerMessage =
				payload.message ||
				`Si un compte est associé à ${cleanEmail}, un lien de connexion valable 15 minutes vient d'y être envoyé.`;
			magicPreviewUrl = payload.previewMagicUrl || null;
			magicSent = true;
			toast.success(
				'Lien magique prêt',
				payload.previewMagicUrl
					? 'Lien de connexion généré.'
					: 'Consulte ta boîte mail pour te connecter en un clic.'
			);
		} catch {
			errorMessage = 'Impossible de joindre le serveur. Vérifie ta connexion.';
		} finally {
			submitting = false;
		}
	}

	async function handleMagicTotp(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		const cleanCode = magicTotpCode.trim();
		if (!/^\d{6}$/.test(cleanCode)) {
			errorMessage = 'Saisis le code à 6 chiffres de ton application d’authentification.';
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/auth/magic', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ totpCode: cleanCode })
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
			if (!res.ok) {
				errorMessage = payload.error || payload.message || 'Code 2FA invalide.';
				return;
			}
			toast.success('Connexion validée', `Ravi de te revoir sur ${data.settings.mdlName}.`);
			await invalidateAll();
			await goto(redirectTarget);
		} catch {
			errorMessage = 'Impossible de joindre le serveur. Vérifie ta connexion.';
		} finally {
			submitting = false;
		}
	}
</script>
<svelte:head>
	<title>Connexion · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-[400px] px-4 py-8 sm:py-16">
	<div class="animate-spring mb-6 space-y-1">
		<h1 class="text-[26px] font-semibold tracking-[-0.03em] text-ink">
			Connexion
		</h1>
		<p class="text-[13px] text-muted">
			{data.settings.mdlName} · {data.settings.schoolName}
		</p>
	</div>

	<Card padding="md" animate stagger={1} class="space-y-5">
		<div
			role="tablist"
			aria-label="Méthode de connexion"
			class="relative grid grid-cols-2 rounded-[10px] bg-surface-2 p-0.5"
		>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-[8px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
				style={`transform: translate3d(${activeTab === 'magic' ? '100%' : '0%'}, 0, 0);`}
			></div>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'password'}
				onclick={() => switchTab('password')}
				class={`relative z-10 min-h-9 cursor-pointer rounded-[8px] px-3 text-[13px] transition-colors ${
					activeTab === 'password' ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink'
				}`}
			>
				Mot de passe
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'magic'}
				onclick={() => switchTab('magic')}
				class={`relative z-10 min-h-9 cursor-pointer rounded-[8px] px-3 text-[13px] transition-colors ${
					activeTab === 'magic' ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink'
				}`}
			>
				Lien magique
			</button>
		</div>

		{#if errorMessage}
			<div
				role="alert"
				class="animate-spring rounded-[10px] border border-[#FF3B30]/25 bg-[#FF3B30]/8 px-3.5 py-2.5 text-[13px] font-medium text-[#FF3B30]"
			>
				{errorMessage}
			</div>
		{/if}

		{#if magicTotpPending}
			<form onsubmit={handleMagicTotp} class="space-y-4" novalidate>
				<div class="space-y-2 rounded-[12px] border border-border bg-surface p-3.5">
					<label for="magic-totp" class="block text-[13px] font-medium text-ink">
						Code de vérification 2FA (TOTP)
					</label>
					<input
						id="magic-totp"
						type="text"
						inputmode="numeric"
						pattern={'[0-9]{6}'}
						maxlength={6}
						bind:value={magicTotpCode}
						required
						autocomplete="one-time-code"
						placeholder="123456"
						class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-center font-mono text-lg font-semibold tracking-[0.35em] text-ink focus:border-brand focus:outline-none"
					/>
					<p class="text-[12px] text-muted">
						Lien validé. Saisis le code à 6 chiffres de ton application d'authentification.
					</p>
				</div>
				<Button type="submit" fullWidth size="md" loading={submitting}>
					Valider et accéder
				</Button>
				<Button
					type="button"
					variant="ghost"
					fullWidth
					onclick={() => goto('/connexion')}
				>
					Revenir à la connexion
				</Button>
			</form>
		{:else if activeTab === 'password'}
			<form onsubmit={handlePasswordLogin} class="space-y-4" novalidate>
				<div class="space-y-1.5">
					<label for="login-email" class="block text-[12px] font-medium text-muted">
						Adresse email
					</label>
					<input
						id="login-email"
						type="email"
						bind:value={email}
						required
						autocomplete="email"
						placeholder="prenom.nom@lycee.fr"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:bg-card focus:outline-none sm:text-sm"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="login-password" class="block text-[12px] font-medium text-muted">
						Mot de passe
					</label>
					<div class="relative">
						<input
							id="login-password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							required
							autocomplete="current-password"
							placeholder="••••••••••••"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface py-2 pr-11 pl-3.5 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:bg-card focus:outline-none sm:text-sm"
						/>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
							aria-pressed={showPassword}
							class="absolute inset-y-1 right-1 inline-flex w-9 cursor-pointer items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"
						>
							{#if showPassword}
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4 10 7a11.7 11.7 0 0 1-3.1 4.5M6.6 6.6A11.7 11.7 0 0 0 2 12c1 3 5 7 10 7a9.7 9.7 0 0 0 4.3-1" />
								</svg>
							{:else}
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				{#if requiresTotp}
					<div class="animate-spring space-y-2 rounded-[12px] border border-border bg-surface p-3.5">
						<label for="login-totp" class="block text-[13px] font-medium text-ink">
							Code de sécurité 2FA (TOTP)
						</label>
						<input
							id="login-totp"
							type="text"
							inputmode="numeric"
							pattern={'[0-9]{6}'}
							maxlength={6}
							bind:value={totpCode}
							required
							autocomplete="one-time-code"
							placeholder="123456"
							class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-center font-mono text-lg font-semibold tracking-[0.35em] text-ink focus:border-brand focus:outline-none"
						/>
						<p class="text-[12px] text-muted">
							Saisis le code temporaire à 6 chiffres de ton application d'authentification.
						</p>
					</div>
				{/if}

				<Button type="submit" fullWidth size="md" loading={submitting}>
					{requiresTotp ? 'Valider le code 2FA' : 'Se connecter'}
				</Button>
			</form>
		{:else}
			{#if magicSent}
				<div class="animate-spring space-y-3.5 rounded-[12px] border border-border bg-surface p-4 text-[13px]">
					<p class="font-semibold text-ink">Lien magique prêt</p>
					<p class="leading-relaxed text-muted">{magicServerMessage}</p>
					{#if magicPreviewUrl}
						<Button href={magicPreviewUrl} fullWidth size="md" variant="primary">
							Ouvrir le lien de connexion
						</Button>
					{/if}
					<Button
						type="button"
						variant="secondary"
						fullWidth
						onclick={() => {
							magicSent = false;
							magicPreviewUrl = null;
						}}
					>
						Renvoyer un lien
					</Button>
				</div>
			{:else}
				<form onsubmit={handleMagicLink} class="space-y-4" novalidate>
					<p class="text-[13px] leading-relaxed text-muted">
						Reçois un lien sécurisé par email pour te connecter sans mot de passe.
					</p>

					<div class="space-y-1.5">
						<label for="magic-email" class="block text-[12px] font-medium text-muted">
							Adresse email
						</label>
						<input
							id="magic-email"
							type="email"
							bind:value={magicEmail}
							required
							autocomplete="email"
							placeholder="prenom.nom@lycee.fr"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:bg-card focus:outline-none sm:text-sm"
						/>
					</div>

					<Button type="submit" fullWidth size="md" loading={submitting}>
						Envoyer mon lien magique
					</Button>
				</form>
			{/if}
		{/if}

		<div class="border-t border-border pt-4 text-center text-[13px] text-muted">
			<p>
				Pas encore membre ?
				<a href="/inscription" class="font-medium text-brand-ink hover:underline">
					Créer un compte
				</a>
			</p>
			<p class="mt-1.5 text-[12px]">
				<a href="/confidentialite" class="hover:text-ink hover:underline">
					Confidentialité & RGPD
				</a>
			</p>
		</div>
	</Card>
</div>
