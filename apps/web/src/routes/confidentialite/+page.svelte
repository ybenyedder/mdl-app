<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Politique de confidentialité (RGPD mineurs) · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-8 px-4 pt-6 pb-8 sm:px-6 sm:pt-10">
	<header class="space-y-3">
		<div class="flex flex-wrap items-center gap-2">
			<Badge variant="success" dot>RGPD • Lycéens 15–18 ans</Badge>
			<Badge variant="neutral">{data.settings.schoolName}</Badge>
		</div>
		<h1 class="text-[28px] font-semibold tracking-[-0.03em] text-ink sm:text-[34px]">
			Confidentialité & protection de tes données
		</h1>
		<p class="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
			Sur <strong>{data.settings.mdlName}</strong>, tes données ne sont ni un produit ni une source
			de publicité. Voici en français clair comment nous protégeons la vie privée des lycéens,
			y compris des élèves mineurs.
		</p>
	</header>

	<!-- Résumé visuel en 4 points -->
	<section aria-label="Engagements clés" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<Card padding="sm" class="space-y-1.5">
			<p class="text-xs font-bold uppercase tracking-wide text-brand-ink">100 % auto-hébergé</p>
			<p class="text-sm font-semibold text-ink">Serveur maîtrisé</p>
			<p class="text-xs leading-relaxed text-muted">Aucune donnée vendue ou envoyée à des régies pub.</p>
		</Card>
		<Card padding="sm" class="space-y-1.5">
			<p class="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Zéro tracker</p>
			<p class="text-sm font-semibold text-ink">Aucun pistage</p>
			<p class="text-xs leading-relaxed text-muted">Un seul cookie technique de session, zéro analytics tiers.</p>
		</Card>
		<Card padding="sm" class="space-y-1.5">
			<p class="text-xs font-bold uppercase tracking-wide text-brand-ink">Chiffrement</p>
			<p class="text-sm font-semibold text-ink">Données protégées</p>
			<p class="text-xs leading-relaxed text-muted">Emails chiffrés AES-256-GCM au repos, mots de passe Argon2.</p>
		</Card>
		<Card padding="sm" class="space-y-1.5">
			<p class="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Votes secrets</p>
			<p class="text-sm font-semibold text-ink">Anonymisation</p>
			<p class="text-xs leading-relaxed text-muted">Impossible de relier ton bulletin d'AG à ton nom.</p>
		</Card>
	</section>

	<div class="space-y-4">
		<Card padding="lg" as="section" class="space-y-2.5">
			<h2 class="text-lg font-bold text-ink">1. Hébergement souverain & auto-hébergé</h2>
			<p class="text-sm leading-relaxed text-muted">
				L'application est hébergée de manière autonome pour la Maison des Lycéens de
				<strong class="text-ink">{data.settings.schoolName}</strong>. Les bases de données et pièces
				justificatives restent sous le contrôle exclusif de l'association, sans exploitation commerciale.
			</p>
		</Card>

		<Card padding="lg" as="section" class="space-y-2.5">
			<h2 class="text-lg font-bold text-ink">2. Zéro tracker, zéro publicité, zéro cookie tiers</h2>
			<p class="text-sm leading-relaxed text-muted">
				Nous n'utilisons aucun outil de suivi publicitaire (pas de Google Analytics, pas de pixel
				social). Seuls sont utilisés :
			</p>
			<ul class="list-inside list-disc space-y-1 text-sm text-muted">
				<li>
					Le cookie technique <code class="rounded bg-surface px-1.5 py-0.5 text-xs text-ink">mdl_session</code>
					(<code class="text-xs">HttpOnly</code>, <code class="text-xs">SameSite=Strict</code>), indispensable pour rester connecté en sécurité.
				</li>
				<li>
					Le stockage local du navigateur pour mémoriser ton thème clair/sombre et tes billets hors ligne si tu utilises la PWA.
				</li>
			</ul>
		</Card>

		<Card padding="lg" as="section" class="space-y-2.5">
			<h2 class="text-lg font-bold text-ink">3. Quelles données sont collectées et comment sont-elles chiffrées ?</h2>
			<p class="text-sm leading-relaxed text-muted">
				Nous appliquons le principe de <strong class="text-ink">minimisation</strong> :
			</p>
			<ul class="list-inside list-disc space-y-1 text-sm text-muted">
				<li>Identité scolaire : prénom, nom et classe.</li>
				<li>Email personnel et, de manière optionnelle pour les mineurs, email du responsable légal : <strong class="text-ink">chiffrés au repos en AES-256-GCM</strong>.</li>
				<li>Mot de passe : haché de façon irréversible avec <strong class="text-ink">Argon2id</strong>, avec option 2FA TOTP.</li>
				<li>Billetterie : QR code signé cryptographiquement (Ed25519) pour empêcher la fraude sans exposer tes informations.</li>
			</ul>
		</Card>

		<Card padding="lg" as="section" class="space-y-2.5">
			<h2 class="text-lg font-bold text-ink">4. Anonymisation stricte des votes (AG & sondages)</h2>
			<p class="text-sm leading-relaxed text-muted">
				Lors des Assemblées Générales et des sondages du lycée, la vérification qu'un élève ne vote
				qu'une seule fois est séparée du choix exprimé. À la clôture et dès l'enregistrement du vote,
				les bulletins sont anonymisés : ni les membres du bureau, ni les professeurs référents, ni les
				administrateurs ne peuvent savoir ce que tu as voté.
			</p>
		</Card>

		<Card padding="lg" as="section" class="space-y-2.5">
			<h2 class="text-lg font-bold text-ink">5. Protection des lycéens mineurs (15–18 ans)</h2>
			<p class="text-sm leading-relaxed text-muted">
				Conformément au RGPD et aux recommandations de la CNIL pour les jeunes de 15 ans et plus :
			</p>
			<ul class="list-inside list-disc space-y-1 text-sm text-muted">
				<li>Les informations sont rédigées de façon simple et transparente.</li>
				<li>Aucune géolocalisation, aucune donnée biométrique et aucun profilage ne sont effectués.</li>
				<li>Tu peux renseigner l'email d'un parent ou responsable légal lors de l'inscription pour qu'il soit informé.</li>
			</ul>
		</Card>

		<Card padding="lg" as="section" class="space-y-3 border-brand/25 bg-brand-soft/40">
			<h2 class="text-lg font-bold text-ink">6. Tes droits : export en 1 clic & suppression sous 30 jours</h2>
			<p class="text-sm leading-relaxed text-ink">
				Tu restes maître de tes données à tout moment :
			</p>
			<ul class="list-inside list-disc space-y-1.5 text-sm text-muted">
				<li>
					<strong class="text-ink">Export en 1 clic (portabilité) :</strong> depuis ton espace personnel, télécharge l'ensemble de tes données au format JSON en un clic.
				</li>
				<li>
					<strong class="text-ink">Suppression sous 30 jours (droit à l'oubli) :</strong> tu peux demander la suppression de ton compte ; tes données personnelles sont immédiatement marquées pour effacement et définitivement supprimées ou anonymisées sous 30 jours maximum.
				</li>
				<li>
					<strong class="text-ink">Rectification :</strong> demande la correction de ta classe ou de ton email auprès du bureau de la MDL.
				</li>
			</ul>

			<div class="flex flex-wrap gap-3 pt-2">
				{#if data.user}
					<Button href="/dashboard" variant="primary" size="sm">
						Gérer mes données dans Mon espace
					</Button>
				{:else}
					<Button href="/connexion" variant="primary" size="sm">
						Me connecter pour exporter ou supprimer
					</Button>
				{/if}
				<Button href="/" variant="secondary" size="sm">
					Retour à l'accueil
				</Button>
			</div>
		</Card>
	</div>
</div>
