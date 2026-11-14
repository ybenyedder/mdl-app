<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const officialLinks = [
		{
			title: 'Service-Public Associations (Loi 1901)',
			desc: 'Déclaration en préfecture, modification du bureau, statuts types et obligations comptables.',
			url: 'https://www.service-public.fr/associations'
		},
		{
			title: 'Éduscol — Maison des Lycéens (MDL)',
			desc: 'Cadre réglementaire de l’Éducation nationale, circulaire MDL et rôle du CPE / chef d’établissement.',
			url: 'https://eduscol.education.fr/'
		},
		{
			title: 'Annuaire officiel des établissements scolaires',
			desc: 'Rechercher les établissements publics de France et contacter leurs directions / CVL.',
			url: 'https://www.education.gouv.fr/annuaire'
		},
		{
			title: 'Le Compte Asso (Subventions & démarches)',
			desc: 'Immatriculation RNA/SIRET, demandes de subventions publiques et dossiers FDVA.',
			url: 'https://lecompteasso.associations.gouv.fr/'
		}
	];
</script>

<svelte:head>
	<title>Guides & ressources MDL · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="space-y-1.5">
		<Badge variant="brand">Ressources & PWA mobile</Badge>
		<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
			Guides pratiques {data.settings.mdlName}
		</h1>
		<p class="text-sm text-muted">
			Tout pour piloter la Maison des Lycéens : cadre légal Loi 1901, campagne pulls sans avance de trésorerie et installation mobile.
		</p>
	</header>

	<div class="grid gap-5 md:grid-cols-2">
		<Card class="space-y-3">
			<Badge variant="success">Méthode recommandée</Badge>
			<h2 class="text-lg font-bold text-ink">Lancer des pulls sans avance de trésorerie</h2>
			<ol class="list-decimal space-y-1.5 pl-4 text-sm text-muted">
				<li>Demande l'autorisation de campagne dans <a href="/passation" class="font-semibold text-brand hover:underline">Passation → Accord établissement</a>.</li>
				<li>Publie l'article en mode <strong>« Zéro avance »</strong> dans <a href="/boutique" class="font-semibold text-brand hover:underline">Boutique</a> avec les tailles XS→XXL.</li>
				<li>Récolte les précommandes (CB Stripe ou bureau MDL) jusqu'à la date limite.</li>
				<li>Exporte le tableau CSV exact par taille pour commander auprès de ton imprimeur uniquement ce qui est déjà payé.</li>
			</ol>
		</Card>

		<Card class="space-y-3">
			<Badge variant="brand">Application mobile (PWA)</Badge>
			<h2 class="text-lg font-bold text-ink">Installer l'app sur iPhone & Android</h2>
			<div class="space-y-2 text-sm text-muted">
				<p>
					L'espace <strong>{data.settings.mdlName}</strong> fonctionne comme une vraie application mobile (offline pour tes QR codes billets et scanner d'entrée) sans passer par un store :
				</p>
				<ul class="list-disc space-y-1 pl-4">
					<li><strong>Sur iPhone (Safari) :</strong> touche le bouton Partager (carré avec flèche) puis <em>« Sur l'écran d'accueil »</em>.</li>
					<li><strong>Sur Android (Chrome) :</strong> ouvre le menu ⋮ puis <em>« Installer l'application »</em>.</li>
				</ul>
			</div>
		</Card>
	</div>

	<Card class="space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h2 class="text-lg font-bold text-ink">Kit de démarrage Loi 1901 & passation</h2>
				<p class="text-xs text-muted">Raccourcis directs vers tes modules opérationnels sur la plateforme.</p>
			</div>
			<Button href="/adhesion" variant="secondary" size="sm">Tester la page d'adhésion 1-clic</Button>
		</div>

		<div class="grid gap-3 sm:grid-cols-3 text-sm">
			<a href="/reunions" class="rounded-[10px] border border-border bg-surface p-3.5 hover:border-brand/50 transition">
				<div class="font-semibold text-ink">Réunions & PV PDF</div>
				<p class="mt-1 text-xs text-muted">Ordre du jour, émargement bureau et comptes-rendus téléchargeables.</p>
			</a>
			<a href="/ag" class="rounded-[10px] border border-border bg-surface p-3.5 hover:border-brand/50 transition">
				<div class="font-semibold text-ink">Assemblées & Votes</div>
				<p class="mt-1 text-xs text-muted">Élections du bureau, quorum automatique et procès-verbal d'AG.</p>
			</a>
			<a href="/budget" class="rounded-[10px] border border-border bg-surface p-3.5 hover:border-brand/50 transition">
				<div class="font-semibold text-ink">Budget & Trésorerie</div>
				<p class="mt-1 text-xs text-muted">Suivi recettes/dépenses, catégories et export comptable CSV/PDF.</p>
			</a>
		</div>
	</Card>

	<Card class="space-y-4">
		<h2 class="text-lg font-bold text-ink">Liens officiels & réseau des MDL</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each officialLinks as link (link.url)}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex flex-col justify-between rounded-[10px] border border-border bg-surface p-3.5 hover:border-brand/50 transition"
				>
					<div>
						<div class="text-sm font-semibold text-ink">{link.title} ↗</div>
						<p class="mt-1 text-xs text-muted">{link.desc}</p>
					</div>
				</a>
			{/each}
		</div>
	</Card>
</div>
