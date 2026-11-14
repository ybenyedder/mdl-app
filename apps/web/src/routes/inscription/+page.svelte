<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatEuros } from '$shared/format';
	import { registerSchema } from '$shared/schemas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let firstName = $state('');
	let lastName = $state('');
	let classe = $state('');
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let schoolCode = $state('');
	let legalGuardianEmail = $state('');
	let rgpdConsent = $state(false);

	let submitting = $state(false);
	let errorMessage = $state('');

	const inviteToken = $derived(page.url.searchParams.get('invite')?.trim() || '');
	const needsSchoolCode = $derived(
		data.settings.registrationMode === 'school_code' && !inviteToken
	);
	const isInviteOnly = $derived(
		data.settings.registrationMode === 'invite_only' && !inviteToken
	);
	const passwordLengthValid = $derived(password.length >= 10);

	async function handleRegister(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		if (needsSchoolCode && !schoolCode.trim()) {
			errorMessage = 'Le code lycée est requis pour créer un compte.';
			return;
		}

		const parsed = registerSchema.safeParse({
			firstName,
			lastName,
			classe,
			email,
			password,
			schoolCode: needsSchoolCode ? schoolCode : undefined,
			legalGuardianEmail: legalGuardianEmail.trim(),
			rgpdConsent
		});

		if (!parsed.success) {
			errorMessage = parsed.error.issues[0]?.message || 'Vérifie les champs du formulaire.';
			return;
		}

		submitting = true;
		try {
			const requestBody = inviteToken
				? { ...parsed.data, inviteToken }
				: parsed.data;

			const res = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody)
			});

			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				errorMessage = payload.error || payload.message || "Impossible de finaliser l'inscription.";
				return;
			}

			toast.success('Compte créé', `Bienvenue sur ${data.settings.mdlName}`);
			await invalidateAll();
			await goto('/dashboard');
		} catch {
			errorMessage = 'Impossible de joindre le serveur. Vérifie ta connexion.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Inscription · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-lg px-4 pt-6 pb-8 sm:pt-10">
	<div class="mb-6 text-center">
		<div class="mb-2 flex justify-center">
			<Badge variant="brand">
				{data.settings.schoolName} • {data.settings.schoolYear}
			</Badge>
		</div>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
			Rejoindre {data.settings.mdlName}
		</h1>
		<p class="mt-2 text-sm text-muted">
			Crée ton espace lycéen en 30 secondes. Cotisation annuelle :
			<strong class="text-ink">
				{data.settings.membershipFeeCents === 0
					? 'Gratuite'
					: formatEuros(data.settings.membershipFeeCents)}
			</strong>.
		</p>
	</div>

	<Card padding="lg" class="space-y-5">
		{#if isInviteOnly}
			<div class="space-y-3 rounded-[10px] border border-amber-500/35 bg-amber-500/10 p-4 text-sm">
				<p class="font-bold text-amber-900 dark:text-amber-300">
					Inscriptions sur invitation uniquement
				</p>
				<p class="leading-relaxed text-ink">
					L'établissement a activé le mode par invitation. Rapproche-toi du bureau de la MDL pour recevoir ton lien personnel par email.
				</p>
				<Button href="/connexion" variant="secondary" fullWidth>
					J'ai déjà un compte · Me connecter
				</Button>
			</div>
		{:else}
			{#if errorMessage}
				<div
					role="alert"
					class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
				>
					{errorMessage}
				</div>
			{/if}

			<form onsubmit={handleRegister} class="space-y-4" novalidate>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="reg-first-name" class="block text-sm font-semibold text-ink">
							Prénom
						</label>
						<input
							id="reg-first-name"
							type="text"
							bind:value={firstName}
							required
							autocomplete="given-name"
							placeholder="Camille"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-base text-ink sm:text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="reg-last-name" class="block text-sm font-semibold text-ink">
							Nom
						</label>
						<input
							id="reg-last-name"
							type="text"
							bind:value={lastName}
							required
							autocomplete="family-name"
							placeholder="Laurent"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-base text-ink sm:text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none"
						/>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="reg-classe" class="block text-sm font-semibold text-ink">
						Classe
					</label>
					<input
						id="reg-classe"
						type="text"
						bind:value={classe}
						required
						list="classes-suggestions"
						placeholder="Ex : 1ère G2, Tle STMG1, 2nde 4"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-base text-ink sm:text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none"
					/>
					<datalist id="classes-suggestions">
						<option value="2nde 1"></option>
						<option value="1ère G1"></option>
						<option value="1ère STMG1"></option>
						<option value="Tle G1"></option>
						<option value="Tle STMG1"></option>
					</datalist>
				</div>

				<div class="space-y-1.5">
					<label for="reg-email" class="block text-sm font-semibold text-ink">
						Adresse email
					</label>
					<input
						id="reg-email"
						type="email"
						bind:value={email}
						required
						autocomplete="email"
						placeholder="prenom.nom@lycee.fr"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-base text-ink sm:text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none"
					/>
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between gap-2">
						<label for="reg-password" class="block text-sm font-semibold text-ink">
							Mot de passe
						</label>
						<span
							class={`text-xs font-medium ${
								password.length === 0
									? 'text-muted'
									: passwordLengthValid
										? 'text-emerald-700 dark:text-emerald-300'
										: 'text-amber-700 dark:text-amber-300'
							}`}
						>
							{password.length}/10 caractères min.
						</span>
					</div>
					<div class="relative">
						<input
							id="reg-password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							required
							minlength={10}
							autocomplete="new-password"
							placeholder="Au moins 10 caractères"
							class="min-h-11 w-full rounded-[10px] border border-border bg-surface py-2 pr-11 pl-3.5 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:bg-card focus:outline-none sm:text-sm"
						/>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
							aria-pressed={showPassword}
							class="absolute inset-y-1 right-1 inline-flex w-9 cursor-pointer items-center justify-center rounded-[8px] text-muted hover:text-ink"
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

				{#if needsSchoolCode}
					<div class="animate-spring space-y-1.5 rounded-[12px] border border-border bg-surface p-3.5">
						<label for="reg-school-code" class="block text-[13px] font-medium text-ink">
							Code lycée
						</label>
						<input
							id="reg-school-code"
							type="text"
							bind:value={schoolCode}
							required
							autocomplete="off"
							placeholder="Code communiqué par la MDL"
							class="min-h-11 w-full rounded-[10px] border border-border bg-card px-3.5 py-2 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none sm:text-sm"
						/>
						<p class="text-[12px] text-muted">
							Demande le code d'accès au bureau de la MDL ou à la vie scolaire.
						</p>
					</div>
				{/if}

				<div class="space-y-1.5">
					<label for="reg-guardian-email" class="block text-[12px] font-medium text-muted">
						Email du responsable légal (optionnel, mineurs)
					</label>
					<input
						id="reg-guardian-email"
						type="email"
						bind:value={legalGuardianEmail}
						autocomplete="off"
						placeholder="parent.tuteur@exemple.fr"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink placeholder:text-muted/60 focus:border-brand focus:bg-card focus:outline-none sm:text-sm"
					/>
					<p class="text-[12px] text-muted">
						Chiffré au repos. Permet d'informer un parent ou tuteur si tu es mineur(e).
					</p>
				</div>

				<div class="rounded-[12px] border border-border bg-surface p-3.5">
					<label class="flex cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							bind:checked={rgpdConsent}
							required
							class="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border accent-brand"
						/>
						<span class="text-[12px] leading-relaxed text-ink">
							J'accepte que mes informations soient utilisées pour gérer mon adhésion à la MDL et j'ai pris connaissance de la
							<a
								href="/confidentialite"
								class="font-medium text-brand-ink underline underline-offset-2"
							>
								politique de confidentialité (RGPD mineurs)
							</a>.
						</span>
					</label>
				</div>

				<Button type="submit" fullWidth size="md" loading={submitting}>
					Créer mon compte lycéen
				</Button>
			</form>
		{/if}

		<div class="border-t border-border pt-4 text-center text-[13px] text-muted">
			Déjà inscrit(e) ?
			<a href="/connexion" class="font-medium text-brand-ink hover:underline">
				Se connecter
			</a>
		</div>
	</Card>
</div>
