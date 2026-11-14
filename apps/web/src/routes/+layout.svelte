<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { goto, invalidateAll, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		getRoleLabel,
		hasAnyPermission,
		hasPermission,
		syncDynamicRoles,
		type Role
	} from '$shared/permissions';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	interface BeforeInstallPromptEvent extends Event {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	}

	interface NavItem {
		label: string;
		href: string;
		icon:
			| 'home'
			| 'projects'
			| 'budget'
			| 'ag'
			| 'meetings'
			| 'polls'
			| 'tickets'
			| 'merch'
			| 'passation'
			| 'members'
			| 'guides'
			| 'admin';
	}

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	$effect.pre(() => {
		if (data.roles) {
			syncDynamicRoles(data.roles);
		}
	});

	const INSTALL_DISMISSED_KEY = 'mdl-pwa-install-dismissed';

	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let showInstallBanner = $state(false);
	let isIosSafari = $state(false);
	let showIosGuide = $state(false);
	let installingPwa = $state(false);

	let userMenuOpen = $state(false);
	let mobileDrawerOpen = $state(false);
	let loggingOut = $state(false);
	let logoLoadFailed = $state(false);
	let fallbackLogoFailed = $state(false);
	let userMenuEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void data.settings.logoUrl;
		logoLoadFailed = false;
		fallbackLogoFailed = false;
	});

	let sheetDragStartY = $state<number | null>(null);
	let sheetDragOffsetY = $state(0);

	onNavigate((navigation) => {
		userMenuOpen = false;
		mobileDrawerOpen = false;

		if (
			typeof document === 'undefined' ||
			!('startViewTransition' in document) ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
			navigation.from?.url.pathname === navigation.to?.url.pathname
		) {
			return;
		}

		return new Promise((resolve) => {
			(document as Document & { startViewTransition: (cb: () => Promise<void>) => void }).startViewTransition(
				async () => {
					resolve();
					await navigation.complete;
				}
			);
		});
	});

	$effect(() => {
		const root = document.documentElement;
		root.style.setProperty('--mdl-primary', data.settings.primaryColor || '#007aff');
		root.style.setProperty('--mdl-accent', data.settings.accentColor || '#5856d6');
	});

	onMount(() => {
		theme.init();

		if ('serviceWorker' in navigator && !dev) {
			navigator.serviceWorker.register('/sw.js').catch(() => {});
		}

		let dismissed = false;
		try {
			dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
		} catch {
			dismissed = false;
		}

		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

		const ua = navigator.userAgent;
		const isIos = /iphone|ipad|ipod/i.test(ua);
		const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
		if (isIos && isSafari && !isStandalone && !dismissed) {
			isIosSafari = true;
			showInstallBanner = true;
		}

		const handleBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			deferredPrompt = event as BeforeInstallPromptEvent;
			if (!isStandalone && !dismissed) {
				showInstallBanner = true;
			}
		};

		const handleAppInstalled = () => {
			showInstallBanner = false;
			deferredPrompt = null;
			showIosGuide = false;
			toast.success('Application installée', `${data.settings.mdlName} est disponible sur votre écran d’accueil.`);
		};

		const handleOutsideClick = (event: MouseEvent) => {
			if (userMenuOpen && userMenuEl && !userMenuEl.contains(event.target as Node)) {
				userMenuOpen = false;
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				userMenuOpen = false;
				mobileDrawerOpen = false;
			}
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);
		document.addEventListener('click', handleOutsideClick);
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
			document.removeEventListener('click', handleOutsideClick);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});

	function getNavItems(role: Role | undefined, isAdherent = false): NavItem[] {
		const items: NavItem[] = [{ label: 'Accueil', href: '/', icon: 'home' }];
		if (role && hasPermission(role, 'projects:read')) {
			items.push({ label: 'Projets', href: '/projets', icon: 'projects' });
		}
		if (role && hasPermission(role, 'budget:read')) {
			items.push({ label: 'Budget', href: '/budget', icon: 'budget' });
		}
		if (role && hasPermission(role, 'ag:read')) {
			items.push({ label: 'AG', href: '/ag', icon: 'ag' });
		}
		if (role && hasPermission(role, 'meetings:read')) {
			items.push({ label: 'Réunions', href: '/reunions', icon: 'meetings' });
		}
		if (!role || hasPermission(role, 'polls:read')) {
			items.push({ label: 'Sondages', href: '/sondages', icon: 'polls' });
		}
		items.push({ label: 'Billetterie', href: '/billetterie', icon: 'tickets' });
		items.push({ label: 'Boutique', href: '/boutique', icon: 'merch' });
		if (!role || !isAdherent) {
			items.push({ label: 'Adhérer', href: '/adhesion', icon: 'members' });
		}
		if (role && hasPermission(role, 'passation:read')) {
			items.push({ label: 'Passation', href: '/passation', icon: 'passation' });
		}
		if (role && hasPermission(role, 'members:read')) {
			items.push({ label: 'Membres', href: '/membres', icon: 'members' });
		}
		items.push({ label: 'Guides', href: '/ressources', icon: 'guides' });
		if (role && hasAnyPermission(role, ['admin:settings', 'admin:roles', 'audit:read'])) {
			items.push({ label: 'Admin', href: '/admin/parametres', icon: 'admin' });
		}
		return items;
	}

	const navItems = $derived(getNavItems(data.user?.role, Boolean(data.user?.isAdherent)));

	const mobilePrimaryItems = $derived.by(() => {
		const preferredOrder = ['/', '/projets', '/sondages', '/billetterie'];
		const picked: NavItem[] = [];
		for (const path of preferredOrder) {
			const match = navItems.find((item) => item.href === path);
			if (match) picked.push(match);
			if (picked.length === 3) break;
		}
		for (const item of navItems) {
			if (picked.length >= 3) break;
			if (!picked.some((p) => p.href === item.href)) picked.push(item);
		}
		return picked;
	});

	const hasMobileMore = $derived(navItems.length > 4 || Boolean(data.user));

	const userInitials = $derived.by(() => {
		if (!data.user) return '';
		const f = data.user.firstName.trim().charAt(0).toUpperCase();
		const l = data.user.lastName.trim().charAt(0).toUpperCase();
		return `${f}${l}` || 'U';
	});

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href + '/');
	}

	function handleDrawerTouchStart(event: TouchEvent) {
		if (event.touches.length !== 1) return;
		sheetDragStartY = event.touches[0].clientY;
		sheetDragOffsetY = 0;
	}

	function handleDrawerTouchMove(event: TouchEvent) {
		if (sheetDragStartY === null) return;
		const delta = event.touches[0].clientY - sheetDragStartY;
		if (delta > 0) sheetDragOffsetY = delta;
	}

	function handleDrawerTouchEnd() {
		if (sheetDragOffsetY > 90) {
			mobileDrawerOpen = false;
		}
		sheetDragStartY = null;
		sheetDragOffsetY = 0;
	}

	async function triggerInstall() {
		if (deferredPrompt) {
			installingPwa = true;
			try {
				await deferredPrompt.prompt();
				const choice = await deferredPrompt.userChoice;
				if (choice.outcome === 'accepted') {
					showInstallBanner = false;
					deferredPrompt = null;
				}
			} finally {
				installingPwa = false;
			}
			return;
		}
		if (isIosSafari) {
			showIosGuide = !showIosGuide;
		}
	}

	function dismissInstallBanner() {
		showInstallBanner = false;
		showIosGuide = false;
		try {
			localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
		} catch {
			// Ignore storage denial
		}
	}

	async function handleLogout() {
		if (loggingOut) return;
		loggingOut = true;
		userMenuOpen = false;
		mobileDrawerOpen = false;
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			await invalidateAll();
			toast.info('Déconnexion effectuée');
			await goto('/connexion');
		} catch {
			toast.error('Impossible de fermer la session');
		} finally {
			loggingOut = false;
		}
	}
</script>

<svelte:head>
	<title>{data.settings.mdlName} · {data.settings.schoolName}</title>
</svelte:head>

<div
	class="min-h-dvh flex flex-col bg-surface text-ink"
	style="--mdl-primary: {data.settings.primaryColor || '#007aff'}; --mdl-accent: {data.settings.accentColor || '#5856d6'};"
>
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-brand focus:px-3.5 focus:py-2 focus:text-xs focus:font-medium focus:text-white"
	>
		Aller au contenu principal
	</a>

	{#if (data.needsAdminBootstrap || (data.user?.permissions.includes('admin:settings') && !data.settings.setupCompleted)) && !page.url.pathname.startsWith('/setup')}
		<div class="border-b border-brand/30 bg-brand-soft text-ink">
			<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
				<p class="font-medium">
					{#if data.needsAdminBootstrap}
						Première mise en route : crée ton compte Admin / Président et situe ton lycée.
					{:else}
						Didacticiel de démarrage : finalise la ville ({data.settings.schoolCity || 'non renseignée'}), Stripe ou la boutique.
					{/if}
				</p>
				<a
					href="/setup"
					class="inline-flex min-h-7 items-center rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:brightness-105"
				>
					Ouvrir l'assistant →
				</a>
			</div>
		</div>
	{/if}

	{#if showInstallBanner}
		<div
			class="border-b border-border bg-card/95 backdrop-blur-md"
			role="region"
			aria-label="Installer l'application"
		>
			<div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-[13px] sm:px-6">
				<p class="min-w-0 truncate text-ink">
					<span class="font-medium">Installer {data.settings.mdlName}</span>
					<span class="hidden text-muted sm:inline"> · Accès rapide hors-ligne</span>
				</p>
				<div class="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onclick={triggerInstall}
						disabled={installingPwa}
						class="gpu-press inline-flex min-h-8 cursor-pointer items-center rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition hover:brightness-105 disabled:opacity-60"
					>
						{installingPwa ? 'Installation...' : isIosSafari ? 'Comment' : 'Installer'}
					</button>
					<button
						type="button"
						onclick={dismissInstallBanner}
						aria-label="Fermer la bannière d'installation"
						class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
					>
						<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>
			</div>
			{#if showIosGuide}
				<div class="mx-auto max-w-6xl border-t border-border px-4 py-2 text-xs text-muted sm:px-6">
					Touchez <strong class="font-medium text-ink">Partager</strong> puis <strong class="font-medium text-ink">Sur l’écran d’accueil</strong> dans Safari.
				</div>
			{/if}
		</div>
	{/if}

	<!-- En-tête minimaliste Apple HIG / Linear -->
	<header class="apple-glass sticky top-0 z-30 border-b border-border">
		<div class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
			<a
				href="/"
				class="group flex shrink-0 items-center gap-2.5 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-brand"
			>
				{#if data.settings.logoUrl && !logoLoadFailed}
					<img
						src={data.settings.logoUrl}
						alt={data.settings.mdlName}
						onerror={() => (logoLoadFailed = true)}
						class="size-7 shrink-0 rounded-[8px] border border-border object-cover apple-shadow-card"
					/>
				{:else if !fallbackLogoFailed}
					<img
						src="/logo.svg"
						alt={data.settings.mdlName}
						onerror={() => (fallbackLogoFailed = true)}
						class="size-7 shrink-0 rounded-[8px] border border-border object-cover apple-shadow-card"
					/>
				{:else}
					<span
						class="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-ink apple-shadow-card"
						aria-hidden="true"
					>
						<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 19V7.5L12 13l8-5.5V19" />
						</svg>
					</span>
				{/if}
				<span class="whitespace-nowrap">
					<span class="block text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink">
						{data.settings.mdlName}
					</span>
					{#if data.settings.schoolCity}
						<span class="block text-[10px] font-medium leading-tight text-muted">
							{data.settings.schoolCity}
						</span>
					{/if}
				</span>
			</a>

			<nav aria-label="Navigation principale" class="hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex">
				{#each navItems as item (item.href)}
					{@const active = isActive(item.href)}
					<a
						href={item.href}
						aria-current={active ? 'page' : undefined}
						class={`whitespace-nowrap rounded-[9px] px-2 py-1.5 text-[12.5px] transition-colors duration-150 ${
							active
								? 'bg-surface-2 font-semibold text-ink'
								: 'font-medium text-muted hover:text-ink'
						}`}
					>
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					onclick={() => theme.toggle()}
					aria-label={theme.isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
					aria-pressed={theme.isDark}
					class="gpu-press inline-flex size-8.5 cursor-pointer items-center justify-center rounded-[9px] text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
				>
					{#if theme.isDark}
						<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
							<circle cx="12" cy="12" r="4" />
							<path stroke-linecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
						</svg>
					{:else}
						<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z" />
						</svg>
					{/if}
				</button>

				{#if data.user}
					<div class="relative" bind:this={userMenuEl}>
						<button
							type="button"
							onclick={() => (userMenuOpen = !userMenuOpen)}
							aria-expanded={userMenuOpen}
							aria-haspopup="menu"
							class="gpu-press inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2.5 text-[13px] font-medium text-ink transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
						>
							<span
								class="flex size-6 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink"
								aria-hidden="true"
							>
								{userInitials}
							</span>
							<span class="hidden max-w-28 truncate sm:inline">{data.user.firstName}</span>
							<svg class={`size-3 text-muted transition-transform duration-150 ${userMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
							</svg>
						</button>

						{#if userMenuOpen}
							<div
								role="menu"
								aria-label="Menu utilisateur"
								class="animate-spring apple-shadow-elevated absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-card p-1.5"
							>
								<div class="border-b border-border px-3 py-2.5">
									<p class="truncate text-[14px] font-semibold text-ink">
										{data.user.firstName} {data.user.lastName}
									</p>
									<p class="truncate text-[12px] text-muted">
										{getRoleLabel(data.user.role, data.user.customTitle)}
										{#if data.user.classe}· {data.user.classe}{/if}
									</p>
								</div>
								<div class="py-1">
									<a
										role="menuitem"
										href="/dashboard"
										class="flex min-h-10 items-center justify-between rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-surface-2"
									>
										<span>Tableau de bord</span>
									</a>
									<a
										role="menuitem"
										href="/profil"
										class="flex min-h-10 items-center justify-between rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-surface-2"
									>
										<span>Profil & sécurité</span>
									</a>
									<a
										role="menuitem"
										href="/confidentialite"
										class="flex min-h-10 items-center justify-between rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-surface-2"
									>
										<span>Confidentialité RGPD</span>
									</a>
								</div>
								<div class="border-t border-border pt-1">
									<button
										role="menuitem"
										type="button"
										onclick={handleLogout}
										disabled={loggingOut}
										class="flex min-h-10 w-full cursor-pointer items-center rounded-[10px] px-3 py-1.5 text-left text-[13px] font-medium text-[#FF3B30] transition hover:bg-red-500/10"
									>
										{loggingOut ? 'Déconnexion...' : 'Se déconnecter'}
									</button>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<div class="flex shrink-0 items-center gap-1">
						<a
							href="/connexion"
							class="gpu-press inline-flex h-8.5 items-center justify-center rounded-[9px] px-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
						>
							Connexion
						</a>
						<a
							href="/inscription"
							class="gpu-press inline-flex h-8.5 items-center justify-center rounded-[9px] bg-[#18181b] px-3 text-[13px] font-medium text-white transition hover:bg-[#27272a] dark:bg-[#f4f4f5] dark:text-[#111113] dark:hover:bg-white"
						>
							Adhérer
						</a>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main id="main-content" class="flex-1 pb-24 md:pb-12">
		{@render children()}
	</main>

	<footer class="hidden border-t border-border py-6 text-[12px] text-muted md:block">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6">
			<p>
				<span class="font-medium text-ink">{data.settings.mdlName}</span> · {data.settings.schoolName} ({data.settings.schoolYear})
			</p>
			<div class="flex items-center gap-5">
				<a href="/billetterie" class="transition hover:text-ink">Billetterie</a>
				<a href="/sondages" class="transition hover:text-ink">Sondages</a>
				<a href="/confidentialite" class="transition hover:text-ink">Confidentialité & RGPD</a>
			</div>
		</div>
	</footer>

	<!-- Barre d'onglets iOS native collée en bas -->
	<nav
		aria-label="Navigation rapide mobile"
		class="apple-glass apple-shadow-dock fixed inset-x-0 bottom-0 z-40 border-t border-border md:hidden"
		style="padding-bottom: env(safe-area-inset-bottom);"
	>
		<div class="mx-auto grid h-[54px] max-w-md grid-cols-4 items-stretch">
			{#each mobilePrimaryItems as item (item.href)}
				{@const active = isActive(item.href)}
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class={`gpu-press flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
						active ? 'text-brand font-semibold' : 'text-muted font-medium hover:text-ink'
					}`}
				>
					{#if item.icon === 'home'}
						<svg class="size-[21px]" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={active ? '1.6' : '1.75'} aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="m3 10.5 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
						</svg>
					{:else if item.icon === 'projects'}
						<svg class="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={active ? '2' : '1.75'} aria-hidden="true">
							<rect x="3" y="4" width="6" height="16" rx="1.5" />
							<rect x="10" y="4" width="5" height="11" rx="1.5" />
							<rect x="16" y="4" width="5" height="14" rx="1.5" />
						</svg>
					{:else if item.icon === 'polls'}
						<svg class="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={active ? '2' : '1.75'} aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 19h16M7 15V9m5 6V5m5 10v-4" />
						</svg>
					{:else if item.icon === 'tickets'}
						<svg class="size-[21px]" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={active ? '1.6' : '1.75'} aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 9V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2.5 2.5 0 0 0 0 6v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 0 0-6Z" />
						</svg>
					{:else}
						<svg class="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
							<circle cx="12" cy="12" r="8" />
						</svg>
					{/if}
					<span class="truncate leading-none">{item.label}</span>
				</a>
			{/each}

			{#if hasMobileMore}
				<button
					type="button"
					onclick={() => (mobileDrawerOpen = !mobileDrawerOpen)}
					aria-expanded={mobileDrawerOpen}
					aria-controls="mobile-nav-drawer"
					class={`gpu-press flex cursor-pointer flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
						mobileDrawerOpen ? 'text-brand font-semibold' : 'text-muted font-medium hover:text-ink'
					}`}
				>
					<svg class="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
						<circle cx="6" cy="12" r="1.4" fill="currentColor" />
						<circle cx="12" cy="12" r="1.4" fill="currentColor" />
						<circle cx="18" cy="12" r="1.4" fill="currentColor" />
					</svg>
					<span class="leading-none">Plus</span>
				</button>
			{:else}
				<a
					href="/confidentialite"
					aria-current={isActive('/confidentialite') ? 'page' : undefined}
					class={`gpu-press flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
						isActive('/confidentialite') ? 'text-brand font-semibold' : 'text-muted font-medium hover:text-ink'
					}`}
				>
					<svg class="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4Z" />
					</svg>
					<span class="leading-none">RGPD</span>
				</a>
			{/if}
		</div>
	</nav>

	<!-- Bottom Sheet iOS groupé pour toutes les rubriques -->
	{#if mobileDrawerOpen}
		<div
			class="animate-backdrop fixed inset-0 z-50 flex items-end bg-black/40 md:hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Toutes les rubriques"
			id="mobile-nav-drawer"
		>
			<button
				type="button"
				class="absolute inset-0 cursor-default"
				aria-label="Fermer le menu"
				onclick={() => (mobileDrawerOpen = false)}
			></button>
			<div
				style={sheetDragOffsetY > 0
					? `transform: translate3d(0, ${sheetDragOffsetY}px, 0); transition: none; padding-bottom: max(1.25rem, env(safe-area-inset-bottom));`
					: 'padding-bottom: max(1.25rem, env(safe-area-inset-bottom));'}
				class="animate-sheet-up relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[22px] border-t border-border bg-surface px-4 pt-2.5 apple-shadow-elevated"
			>
				<div
					role="presentation"
					ontouchstart={handleDrawerTouchStart}
					ontouchmove={handleDrawerTouchMove}
					ontouchend={handleDrawerTouchEnd}
					class="pb-3"
				>
					<div class="mx-auto mb-3 h-1 w-9 rounded-full bg-muted/30" aria-hidden="true"></div>
					<div class="flex items-center justify-between px-1">
						<div>
							<p class="text-[16px] font-semibold tracking-[-0.02em] text-ink">{data.settings.mdlName}</p>
							<p class="text-[12px] text-muted">{data.settings.schoolName}</p>
						</div>
						<button
							type="button"
							onclick={() => (mobileDrawerOpen = false)}
							aria-label="Fermer le menu"
							class="gpu-press inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-muted"
						>
							<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>
				</div>

				<div class="ios-group divide-y divide-border">
					{#each navItems as item (item.href)}
						{@const active = isActive(item.href)}
						<a
							href={item.href}
							class="ios-row ios-row-interactive"
						>
							<div class="flex items-center gap-3">
								<svg class={`size-[18px] shrink-0 ${active ? 'text-brand' : 'text-muted'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
									{#if item.icon === 'home'}
										<path stroke-linecap="round" stroke-linejoin="round" d="m3 10.5 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
									{:else if item.icon === 'projects'}
										<rect x="3" y="4" width="6" height="16" rx="1.5" />
										<rect x="10" y="4" width="5" height="11" rx="1.5" />
										<rect x="16" y="4" width="5" height="14" rx="1.5" />
									{:else if item.icon === 'budget'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />
									{:else if item.icon === 'ag'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5 2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
									{:else if item.icon === 'meetings'}
										<rect x="3" y="5" width="18" height="16" rx="2" />
										<path stroke-linecap="round" stroke-linejoin="round" d="M16 3v4M8 3v4M3 10h18" />
									{:else if item.icon === 'polls'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 19h16M7 15V9m5 6V5m5 10v-4" />
									{:else if item.icon === 'tickets'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 9V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2.5 2.5 0 0 0 0 6v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 0 0-6Z" />
									{:else if item.icon === 'merch'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12l1 13H5L6 7Zm3-2a3 3 0 0 1 6 0" />
									{:else if item.icon === 'passation'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M7 7h10l-3-3m3 3-3 3m-4 4H7l3 3m-3-3 3-3" />
									{:else if item.icon === 'members'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
									{:else if item.icon === 'guides'}
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
									{:else}
										<circle cx="12" cy="12" r="3" />
										<path stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.4 1.1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
									{/if}
								</svg>
								<span class={`text-[15px] ${active ? 'font-semibold text-brand-ink' : 'font-normal text-ink'}`}>
									{item.label}
								</span>
							</div>
							<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
							</svg>
						</a>
					{/each}

					{#if data.user}
						<a href="/dashboard" class="ios-row ios-row-interactive">
							<div class="flex items-center gap-3">
								<svg class="size-[18px] shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
									<rect x="3" y="3" width="7" height="7" rx="1.5" />
									<rect x="14" y="3" width="7" height="7" rx="1.5" />
									<rect x="3" y="14" width="7" height="7" rx="1.5" />
									<rect x="14" y="14" width="7" height="7" rx="1.5" />
								</svg>
								<span class="text-[15px] text-ink">Tableau de bord</span>
							</div>
							<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
							</svg>
						</a>
					{/if}

					<a href="/confidentialite" class="ios-row ios-row-interactive">
						<div class="flex items-center gap-3">
							<svg class="size-[18px] shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4Z" />
							</svg>
							<span class="text-[15px] text-ink">Confidentialité RGPD</span>
						</div>
						<svg class="size-4 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
						</svg>
					</a>
				</div>

				{#if data.user}
					<div class="ios-group mt-3 divide-y divide-border">
						<a href="/profil" class="ios-row ios-row-interactive">
							<div class="flex min-w-0 items-center gap-3">
								<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink">
									{userInitials}
								</span>
								<div class="min-w-0">
									<p class="truncate text-[15px] font-medium text-ink">
										{data.user.firstName} {data.user.lastName}
									</p>
									<p class="truncate text-[12px] text-muted">{getRoleLabel(data.user.role)}</p>
								</div>
							</div>
							<svg class="size-4 shrink-0 text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
							</svg>
						</a>
						<button
							type="button"
							onclick={handleLogout}
							disabled={loggingOut}
							class="ios-row ios-row-interactive w-full cursor-pointer justify-center text-[15px] font-medium text-[#FF3B30]"
						>
							{loggingOut ? 'Déconnexion...' : 'Se déconnecter'}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<Toaster />
</div>
