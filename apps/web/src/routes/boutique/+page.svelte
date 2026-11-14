<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateTimeFr, formatEuros } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import { MERCH_CATEGORIES, MERCH_ORDER_STATUSES } from '$shared/schemas';
	import type { PageData } from './$types';

	type MerchCategory = (typeof MERCH_CATEGORIES)[number];
	type MerchOrderStatus = (typeof MERCH_ORDER_STATUSES)[number];
	type PaymentMethod = 'stripe' | 'especes' | 'virement' | 'cheque' | 'gratuit';
	type PaymentStatus = 'en_attente' | 'paye' | 'annule';

	interface MerchItem {
		id: number;
		projectId: number | null;
		title: string;
		description: string;
		category: MerchCategory;
		imageUrl: string | null;
		priceCents: number;
		supplierCostCents?: number;
		supplierName?: string;
		supplierEmail?: string;
		supplierUrl?: string;
		supplierReference?: string;
		sizes: string[];
		isActive: boolean;
		zeroAdvanceMode: boolean;
		closesAt: string | null;
		orderedCount: number;
		paidCount: number;
		collectedCents?: number;
		estimatedSupplierCostCents?: number;
		estimatedMarginCents?: number;
		sizeCounts?: Record<string, number>;
		createdAt: string;
	}

	interface MerchOrder {
		id: number;
		itemId: number;
		itemTitle: string;
		itemCategory?: MerchCategory;
		buyerUserId?: number | null;
		buyerName: string;
		buyerEmail?: string;
		buyerClasse: string;
		size: string;
		quantity: number;
		unitPriceCents: number;
		totalCents: number;
		paymentMethod: PaymentMethod;
		paymentStatus: PaymentStatus;
		orderStatus: MerchOrderStatus;
		lookupCode: string;
		createdAt: string;
	}

	const GUEST_ORDER_LOOKUPS_KEY = 'mdl-guest-merch-lookups-v1';

	let { data }: { data: PageData } = $props();

	const canManageMerch = $derived(
		data.user ? hasPermission(data.user.role, 'merch:manage') : false
	);
	const canBuyLoggedIn = $derived(
		data.user ? hasPermission(data.user.role, 'merch:buy') : true
	);

	let activeTab = $state<'catalog' | 'my_orders' | 'admin'>('catalog');
	let loadingCatalog = $state(true);
	let loadingOrders = $state(false);
	let loadingAdminOrders = $state(false);

	let stripeEnabled = $state(false);
	let items = $state<MerchItem[]>([]);
	let myOrders = $state<MerchOrder[]>([]);
	let adminOrders = $state<MerchOrder[]>([]);

	// Modal précommande
	let orderModalOpen = $state(false);
	let selectedItem = $state<MerchItem | null>(null);
	let selectedSize = $state('M');
	let quantity = $state(1);
	let buyerName = $state('');
	let buyerEmail = $state('');
	let buyerClasse = $state('');
	let paymentMethod = $state<PaymentMethod>('especes');
	let ordering = $state(false);
	let orderError = $state('');
	let issuedOrder = $state<MerchOrder | null>(null);

	// Modal création article (admin)
	let createModalOpen = $state(false);
	let creatingItem = $state(false);
	let createItemError = $state('');
	let newTitle = $state('');
	let newDescription = $state('');
	let newCategory = $state<MerchCategory>('pull');
	let newPriceEur = $state('28');
	let newSupplierCostEur = $state('17');
	let newSupplierName = $state('');
	let newSupplierEmail = $state('');
	let newSupplierUrl = $state('');
	let newSupplierRef = $state('');
	let newSizesRaw = $state('XS, S, M, L, XL, XXL');
	let newZeroAdvance = $state(true);
	let newClosesAt = $state('');

	// Modal Bon de commande fournisseur réel
	let poItem = $state<MerchItem | null>(null);
	function buildPurchaseOrderText(item: MerchItem): string {
		const sizeLines = item.sizes
			.map((sz) => `  - Taille ${sz} : ${item.sizeCounts?.[sz] ?? 0} pièce(s)`)
			.join('\n');
		const totalCost = (item.supplierCostCents ?? 0) * item.orderedCount;
		return [
			`BON DE COMMANDE — ${data.settings.mdlName}`,
			`Établissement : ${data.settings.schoolName}${data.settings.schoolCity ? ` (${data.settings.schoolCity})` : ''}`,
			`Fournisseur : ${item.supplierName || data.settings.merchSupplierName || 'À préciser'}`,
			item.supplierReference ? `Référence produit : ${item.supplierReference}` : null,
			`Article : ${item.title}`,
			'',
			`Récapitulatif des tailles (${item.orderedCount} pièces au total) :`,
			sizeLines,
			'',
			`Coût unitaire convenu : ${formatEuros(item.supplierCostCents ?? 0)}`,
			`Montant total estimé : ${formatEuros(totalCost)}`
		]
			.filter((l) => l !== null)
			.join('\n');
	}

	// Filtres admin commandes
	let adminSearch = $state('');
	let adminStatusFilter = $state<'all' | MerchOrderStatus>('all');
	let updatingOrderId = $state<number | null>(null);

	const categoryLabels: Record<MerchCategory, string> = {
		pull: 'Pull de promo',
		tshirt: 'T-shirt',
		maillot: 'Maillot / Sport',
		goodies: 'Goodies & Pack',
		yearbook: 'Yearbook',
		autre: 'Autre'
	};

	const orderStatusLabels: Record<MerchOrderStatus, string> = {
		precommande: 'Précommandé',
		payee: 'Payé',
		commandee_fournisseur: 'Commandé fournisseur',
		recue: 'Reçu au lycée',
		distribuee: 'Distribué',
		annulee: 'Annulé'
	};

	const orderStatusVariant: Record<
		MerchOrderStatus,
		'neutral' | 'warning' | 'success' | 'brand' | 'danger'
	> = {
		precommande: 'warning',
		payee: 'brand',
		commandee_fournisseur: 'brand',
		recue: 'success',
		distribuee: 'success',
		annulee: 'danger'
	};

	const paymentMethodLabels: Record<PaymentMethod, string> = {
		especes: 'Espèces (bureau MDL)',
		virement: 'Virement bancaire',
		cheque: 'Chèque (ordre MDL)',
		stripe: 'Carte bancaire (Stripe)',
		gratuit: 'Gratuit'
	};

	const currentOrderTotalCents = $derived(
		selectedItem ? selectedItem.priceCents * Math.max(1, quantity) : 0
	);

	$effect(() => {
		if (currentOrderTotalCents === 0) {
			paymentMethod = 'gratuit';
		} else if (paymentMethod === 'gratuit') {
			paymentMethod = stripeEnabled ? 'stripe' : 'especes';
		}
	});

	const filteredAdminOrders = $derived.by(() => {
		const q = adminSearch.trim().toLowerCase();
		return adminOrders.filter((ord) => {
			if (adminStatusFilter !== 'all' && ord.orderStatus !== adminStatusFilter) return false;
			if (!q) return true;
			return (
				ord.buyerName.toLowerCase().includes(q) ||
				ord.buyerClasse.toLowerCase().includes(q) ||
				ord.itemTitle.toLowerCase().includes(q) ||
				ord.lookupCode.toLowerCase().includes(q) ||
				(ord.buyerEmail?.toLowerCase().includes(q) ?? false)
			);
		});
	});

	function parseEurToCents(raw: string | number): number {
		const normalized = String(raw ?? '').replace(',', '.').trim();
		const num = Number.parseFloat(normalized);
		if (!Number.isFinite(num) || num < 0) return 0;
		return Math.round(num * 100);
	}

	function saveGuestLookup(code: string) {
		try {
			const raw = window.localStorage.getItem(GUEST_ORDER_LOOKUPS_KEY);
			const existing = raw ? (JSON.parse(raw) as string[]) : [];
			const next = Array.from(new Set([code, ...existing])).slice(0, 12);
			window.localStorage.setItem(GUEST_ORDER_LOOKUPS_KEY, JSON.stringify(next));
		} catch {
			// Ignorer
		}
	}

	async function loadCatalog() {
		loadingCatalog = true;
		try {
			const res = await fetch('/api/merch');
			const payload = (await res.json().catch(() => ({}))) as {
				items?: MerchItem[];
				stripeEnabled?: boolean;
			};
			if (res.ok && payload.items) {
				items = payload.items;
				stripeEnabled = Boolean(payload.stripeEnabled);
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger la boutique.');
		} finally {
			loadingCatalog = false;
		}
	}

	async function loadMyOrders() {
		if (!data.user) return;
		loadingOrders = true;
		try {
			const res = await fetch('/api/merch/orders');
			const payload = (await res.json().catch(() => ({}))) as { orders?: MerchOrder[] };
			if (res.ok && payload.orders) {
				myOrders = payload.orders;
			}
		} catch {
			// Ignorer
		} finally {
			loadingOrders = false;
		}
	}

	async function loadAdminOrders() {
		if (!canManageMerch) return;
		loadingAdminOrders = true;
		try {
			const res = await fetch('/api/merch/orders?scope=all');
			const payload = (await res.json().catch(() => ({}))) as { orders?: MerchOrder[] };
			if (res.ok && payload.orders) {
				adminOrders = payload.orders;
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger les précommandes.');
		} finally {
			loadingAdminOrders = false;
		}
	}

	async function loadOrderByLookup(code: string): Promise<MerchOrder | null> {
		try {
			const res = await fetch(`/api/merch/orders?lookup=${encodeURIComponent(code)}`);
			const payload = (await res.json().catch(() => ({}))) as { order?: MerchOrder };
			if (res.ok && payload.order) {
				const ord = payload.order;
				myOrders = [ord, ...myOrders.filter((o) => o.id !== ord.id)];
				return ord;
			}
		} catch {
			// Ignorer
		}
		return null;
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const stripeStatus = params.get('stripe_status');
		const sessionId = params.get('session_id');
		const lookup = params.get('lookup');

		if (stripeStatus === 'cancel') {
			toast.info('Paiement annulé', 'Ta précommande CB n’a pas été finalisée.');
		} else if (stripeStatus === 'success' && sessionId) {
			try {
				const vRes = await fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`);
				const vData = (await vRes.json().catch(() => ({}))) as { paid?: boolean; error?: string };
				if (vRes.ok && vData.paid) {
					toast.success('Paiement confirmé !', 'Ta précommande est enregistrée et validée.');
				} else if (vData.error) {
					toast.warning('Vérification Stripe', vData.error);
				}
			} catch {
				// Ignorer
			}
		}

		await loadCatalog();

		if (lookup) {
			saveGuestLookup(lookup);
			const ord = await loadOrderByLookup(lookup);
			if (ord) {
				issuedOrder = ord;
				orderModalOpen = true;
				activeTab = 'my_orders';
			} else {
				toast.warning('Lien introuvable', 'Aucune précommande trouvée pour ce code.');
			}
		}

		if (data.user) {
			await loadMyOrders();
			if (canManageMerch) {
				await loadAdminOrders();
			}
		} else {
			try {
				const raw = window.localStorage.getItem(GUEST_ORDER_LOOKUPS_KEY);
				const codes = raw ? (JSON.parse(raw) as string[]) : [];
				for (const code of codes) {
					if (code !== lookup) {
						await loadOrderByLookup(code);
					}
				}
			} catch {
				// Ignorer
			}
		}
	});

	function openOrderModal(item: MerchItem) {
		selectedItem = item;
		issuedOrder = null;
		orderError = '';
		selectedSize = item.sizes[2] ?? item.sizes[0] ?? 'Unique';
		quantity = 1;
		buyerName = data.user ? `${data.user.firstName} ${data.user.lastName}`.trim() : '';
		buyerEmail = data.user?.email ?? '';
		buyerClasse = data.user?.classe ?? '';
		paymentMethod = item.priceCents === 0 ? 'gratuit' : stripeEnabled ? 'stripe' : 'especes';
		orderModalOpen = true;
	}

	async function handleCreateOrder(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedItem || ordering) return;
		orderError = '';

		if (!buyerName.trim() || !buyerEmail.trim() || !buyerClasse.trim()) {
			orderError = 'Renseigne ton nom complet, ton email et ta classe.';
			return;
		}

		ordering = true;
		try {
			const res = await fetch('/api/merch/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					itemId: selectedItem.id,
					buyerName: buyerName.trim(),
					buyerEmail: buyerEmail.trim(),
					buyerClasse: buyerClasse.trim(),
					size: selectedSize,
					quantity: Number(quantity),
					paymentMethod: currentOrderTotalCents === 0 ? 'gratuit' : paymentMethod
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				order?: MerchOrder;
				checkoutUrl?: string | null;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.order) {
				orderError = payload.error || payload.message || 'Impossible d’enregistrer la précommande.';
				return;
			}

			saveGuestLookup(payload.order.lookupCode);

			if (payload.checkoutUrl) {
				toast.info('Redirection vers Stripe...', 'Finalise le paiement sécurisé par carte.');
				window.location.href = payload.checkoutUrl;
				return;
			}

			issuedOrder = payload.order;
			myOrders = [payload.order, ...myOrders];
			await loadCatalog();
			if (canManageMerch) {
				await loadAdminOrders();
			}
			toast.success('Précommande enregistrée !', `Référence ${payload.order.lookupCode}`);
		} catch {
			orderError = 'Erreur réseau lors de la précommande.';
		} finally {
			ordering = false;
		}
	}

	async function handleCreateItem(event: SubmitEvent) {
		event.preventDefault();
		if (!canManageMerch || creatingItem) return;
		createItemError = '';

		const sizes = newSizesRaw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		if (!newTitle.trim() || sizes.length === 0) {
			createItemError = 'Renseigne un nom d’article et au moins une taille.';
			return;
		}

		creatingItem = true;
		try {
			const res = await fetch('/api/merch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: newTitle.trim(),
					description: newDescription.trim(),
					category: newCategory,
					priceCents: parseEurToCents(newPriceEur),
					supplierCostCents: parseEurToCents(newSupplierCostEur),
					supplierName: newSupplierName.trim() || data.settings.merchSupplierName || '',
					supplierEmail: newSupplierEmail.trim() || data.settings.merchSupplierEmail || '',
					supplierUrl: newSupplierUrl.trim() || data.settings.merchSupplierUrl || '',
					supplierReference: newSupplierRef.trim(),
					sizes,
					zeroAdvanceMode: newZeroAdvance,
					closesAt: newClosesAt ? new Date(newClosesAt).toISOString() : null
				})
			});
			const payload = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
			};
			if (!res.ok) {
				createItemError = payload.error || payload.message || 'Erreur lors de la création.';
				return;
			}

			createModalOpen = false;
			newTitle = '';
			newDescription = '';
			newClosesAt = '';
			await loadCatalog();
			toast.success('Article ajouté à la boutique');
		} catch {
			createItemError = 'Erreur réseau.';
		} finally {
			creatingItem = false;
		}
	}

	async function toggleItemActive(item: MerchItem) {
		if (!canManageMerch) return;
		try {
			const res = await fetch(`/api/merch/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isActive: !item.isActive })
			});
			if (res.ok) {
				await loadCatalog();
				toast.success(item.isActive ? 'Précommandes fermées' : 'Précommandes rouvertes');
			}
		} catch {
			toast.error('Erreur réseau');
		}
	}

	async function updateOrder(
		orderId: number,
		patch: { paymentStatus?: PaymentStatus; orderStatus?: MerchOrderStatus }
	) {
		if (!canManageMerch || updatingOrderId !== null) return;
		updatingOrderId = orderId;
		try {
			const res = await fetch(`/api/merch/orders/${orderId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (res.ok) {
				await Promise.all([loadAdminOrders(), loadCatalog()]);
				toast.success('Commande mise à jour');
			}
		} catch {
			toast.error('Erreur réseau');
		} finally {
			updatingOrderId = null;
		}
	}

	function exportSupplierCsv() {
		const rows = [
			['Code', 'Article', 'Taille', 'Quantite', 'Eleve', 'Classe', 'Email', 'Paiement', 'Statut Paiement', 'Statut Commande', 'Total EUR']
		];
		for (const ord of filteredAdminOrders) {
			rows.push([
				ord.lookupCode,
				ord.itemTitle,
				ord.size,
				String(ord.quantity),
				ord.buyerName,
				ord.buyerClasse,
				ord.buyerEmail ?? '',
				ord.paymentMethod,
				ord.paymentStatus,
				ord.orderStatus,
				(ord.totalCents / 100).toFixed(2)
			]);
		}
		const csv = rows
			.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
			.join('\n');
		const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `commandes-boutique-mdl-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head>
	<title>Boutique & précommandes · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Boutique & précommandes
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Pulls de promo, maillots et packs {data.settings.mdlName}. Précommandes groupées sans avance de trésorerie.
			</p>
		</div>

		{#if canManageMerch}
			<Button variant="primary" onclick={() => (createModalOpen = true)}>
				+ Nouvel article
			</Button>
		{/if}
	</header>

	<div
		role="tablist"
		aria-label="Sections boutique"
		class="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-2 p-0.5 sm:inline-flex"
	>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'catalog'}
			onclick={() => (activeTab = 'catalog')}
			class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition ${
				activeTab === 'catalog' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
			}`}
		>
			Catalogue ({items.length})
		</button>

		{#if data.user || myOrders.length > 0}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'my_orders'}
				onclick={() => (activeTab = 'my_orders')}
				class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition ${
					activeTab === 'my_orders' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
				}`}
			>
				Mes précommandes ({myOrders.length})
			</button>
		{/if}

		{#if canManageMerch}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'admin'}
				onclick={() => (activeTab = 'admin')}
				class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition ${
					activeTab === 'admin' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
				}`}
			>
				Suivi fournisseur & marges ({adminOrders.length})
			</button>
		{/if}
	</div>

	{#if activeTab === 'catalog'}
		{#if loadingCatalog}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Skeleton variant="card" height="250px" />
				<Skeleton variant="card" height="250px" />
			</div>
		{:else if items.length === 0}
			<Card padding="lg" class="text-center space-y-2">
				<p class="text-base font-bold text-ink">Aucun article en précommande pour le moment</p>
				<p class="text-sm text-muted">
					Dès que le bureau ouvre une campagne (pulls de promo, t-shirts, packs), elle apparaît ici.
				</p>
			</Card>
		{:else}
			<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each items as item (item.id)}
					{@const closedByDate = item.closesAt ? new Date(item.closesAt).getTime() < Date.now() : false}
					{@const unavailable = !item.isActive || closedByDate}
					<Card hover as="article" class="flex flex-col justify-between gap-4">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<Badge variant="brand">{categoryLabels[item.category]}</Badge>
								<div class="flex items-center gap-1.5">
									{#if item.zeroAdvanceMode}
										<Badge variant="success">Zéro avance</Badge>
									{/if}
									{#if !item.isActive}
										<Badge variant="neutral">Fermé</Badge>
									{/if}
								</div>
							</div>

							<div>
								<div class="flex items-baseline justify-between gap-2">
									<h2 class="text-lg font-bold text-ink leading-snug">{item.title}</h2>
									<span class="shrink-0 text-lg font-semibold tabular-nums text-ink">
										{formatEuros(item.priceCents)}
									</span>
								</div>
								{#if item.description}
									<p class="mt-1.5 text-sm leading-relaxed text-muted">{item.description}</p>
								{/if}
							</div>

							<div class="flex flex-wrap gap-1.5">
								{#each item.sizes as sz (sz)}
									<span class="rounded-[6px] border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink">
										{sz}
									</span>
								{/each}
							</div>

							<div class="flex items-center justify-between border-t border-border pt-2.5 text-xs text-muted">
								<span>{item.orderedCount} précommandé(s)</span>
								{#if item.closesAt}
									<span>Clôture : {formatDateTimeFr(item.closesAt)}</span>
								{/if}
							</div>
						</div>

						<div class="space-y-2">
							<Button
								variant={unavailable ? 'secondary' : 'primary'}
								disabled={unavailable || (data.user ? !canBuyLoggedIn : false)}
								fullWidth
								onclick={() => openOrderModal(item)}
							>
								{unavailable ? 'Précommandes fermées' : 'Précommander'}
							</Button>

							{#if canManageMerch}
								<Button
									variant="ghost"
									size="sm"
									fullWidth
									onclick={() => toggleItemActive(item)}
								>
									{item.isActive ? 'Fermer les précommandes' : 'Rouvrir les précommandes'}
								</Button>
							{/if}
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'my_orders'}
		{#if loadingOrders}
			<Skeleton variant="card" height="180px" />
		{:else if myOrders.length === 0}
			<Card padding="lg" class="text-center space-y-3">
				<p class="text-base font-bold text-ink">Aucune précommande</p>
				<Button variant="primary" onclick={() => (activeTab = 'catalog')}>Voir le catalogue</Button>
			</Card>
		{:else}
			<div class="grid gap-4 md:grid-cols-2">
				{#each myOrders as ord (ord.id)}
					<Card class="space-y-2.5">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<Badge variant={orderStatusVariant[ord.orderStatus]}>
								{orderStatusLabels[ord.orderStatus]}
							</Badge>
							<span class="font-mono text-xs text-muted">{ord.lookupCode}</span>
						</div>
						<h3 class="text-base font-bold text-ink">{ord.itemTitle}</h3>
						<p class="text-xs text-muted">
							Taille <strong class="text-ink">{ord.size}</strong> · Quantité <strong class="text-ink">{ord.quantity}</strong> · Total <strong class="text-ink">{formatEuros(ord.totalCents)}</strong>
						</p>
						<p class="text-xs text-muted">
							Paiement : {paymentMethodLabels[ord.paymentMethod]} ({ord.paymentStatus === 'paye' ? 'réglé' : ord.paymentStatus === 'annule' ? 'annulé' : 'en attente'})
						</p>
					</Card>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'admin' && canManageMerch}
		<div class="rounded-[12px] border border-border bg-card p-3.5 text-xs text-muted">
			<strong class="text-ink">Fonctionnement avec votre vrai fournisseur textile :</strong> la plateforme ne vend pas de textile en direct (0 % de commission). Vous collectez les précommandes auprès des élèves, puis générez en 1 clic le <strong>bon de commande exact par taille</strong> à envoyer à votre imprimeur/brodeur local ou atelier en ligne.
		</div>

		<!-- Récap fournisseur & marges par article -->
		<div class="grid gap-4 md:grid-cols-2">
			{#each items as item (item.id)}
				<Card class="space-y-3">
					<div class="flex items-start justify-between gap-2">
						<div>
							<h3 class="text-base font-bold text-ink">{item.title}</h3>
							<p class="text-xs text-muted">
								Prix vente {formatEuros(item.priceCents)} · Coût fournisseur {formatEuros(item.supplierCostCents ?? 0)}
							</p>
							{#if item.supplierName || data.settings.merchSupplierName}
								<p class="text-[11px] text-muted mt-0.5">
									Fournisseur : <strong class="text-ink">{item.supplierName || data.settings.merchSupplierName}</strong>
									{#if item.supplierReference} · Réf {item.supplierReference}{/if}
								</p>
							{/if}
						</div>
						<Badge variant={item.zeroAdvanceMode ? 'success' : 'neutral'}>
							{item.zeroAdvanceMode ? '0 avance trésorerie' : 'Stock classique'}
						</Badge>
					</div>

					<div class="grid grid-cols-3 gap-2 rounded-[10px] border border-border bg-surface p-2.5 text-center text-xs">
						<div>
							<div class="text-muted">Commandés</div>
							<div class="text-sm font-bold tabular-nums text-ink">{item.orderedCount}</div>
						</div>
						<div>
							<div class="text-muted">Encaissé</div>
							<div class="text-sm font-bold tabular-nums text-ink">
								{formatEuros(item.collectedCents ?? 0)}
							</div>
						</div>
						<div>
							<div class="text-muted">Marge estimée</div>
							<div class="text-sm font-bold tabular-nums text-emerald-500">
								{formatEuros(item.estimatedMarginCents ?? 0)}
							</div>
						</div>
					</div>

					<div class="space-y-2">
						<div class="text-xs font-semibold text-ink">Répartition fournisseur par taille :</div>
						<div class="flex flex-wrap gap-1.5">
							{#each item.sizes as sz (sz)}
								<span class="rounded-[6px] border border-border bg-surface px-2 py-1 text-xs font-mono text-ink">
									{sz}: {item.sizeCounts?.[sz] ?? 0}
								</span>
							{/each}
						</div>
						<Button type="button" size="sm" variant="secondary" onclick={() => (poItem = item)}>
							Préparer le bon de commande fournisseur
						</Button>
					</div>
				</Card>
			{/each}
		</div>

		<Card class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-1 flex-wrap items-center gap-2">
					<input
						type="search"
						bind:value={adminSearch}
						placeholder="Rechercher élève, classe, référence..."
						class="min-h-10 min-w-[220px] flex-1 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-brand focus:outline-none"
					/>
					<select
						bind:value={adminStatusFilter}
						class="min-h-10 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-brand focus:outline-none"
					>
						<option value="all">Tous les statuts</option>
						{#each MERCH_ORDER_STATUSES as st (st)}
							<option value={st}>{orderStatusLabels[st]}</option>
						{/each}
					</select>
				</div>
				<Button variant="secondary" size="sm" onclick={exportSupplierCsv}>
					Export CSV fournisseur
				</Button>
			</div>

			{#if loadingAdminOrders}
				<Skeleton variant="text" lines={4} />
			{:else if filteredAdminOrders.length === 0}
				<p class="py-4 text-center text-sm text-muted">Aucune précommande correspondante.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead class="border-b border-border text-[11px] uppercase text-muted">
							<tr>
								<th class="py-2 pr-3">Élève</th>
								<th class="py-2 pr-3">Article & taille</th>
								<th class="py-2 pr-3">Total</th>
								<th class="py-2 pr-3">Paiement</th>
								<th class="py-2">Suivi</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each filteredAdminOrders as ord (ord.id)}
								<tr>
									<td class="py-2.5 pr-3">
										<div class="font-semibold text-ink">{ord.buyerName}</div>
										<div class="text-muted">{ord.buyerClasse} · {ord.lookupCode}</div>
									</td>
									<td class="py-2.5 pr-3">
										<div class="font-medium text-ink">{ord.itemTitle}</div>
										<div class="text-muted">Taille {ord.size} × {ord.quantity}</div>
									</td>
									<td class="py-2.5 pr-3 font-semibold tabular-nums text-ink">
										{formatEuros(ord.totalCents)}
									</td>
									<td class="py-2.5 pr-3">
										<select
											aria-label="Statut paiement"
											value={ord.paymentStatus}
											disabled={updatingOrderId === ord.id}
											onchange={(e) =>
												updateOrder(ord.id, {
													paymentStatus: (e.currentTarget as HTMLSelectElement).value as PaymentStatus
												})}
											class="rounded-[8px] border border-border bg-surface px-2 py-1 text-xs text-ink"
										>
											<option value="en_attente">En attente ({ord.paymentMethod})</option>
											<option value="paye">Payé</option>
											<option value="annule">Annulé</option>
										</select>
									</td>
									<td class="py-2.5">
										<select
											aria-label="Statut commande"
											value={ord.orderStatus}
											disabled={updatingOrderId === ord.id}
											onchange={(e) =>
												updateOrder(ord.id, {
													orderStatus: (e.currentTarget as HTMLSelectElement).value as MerchOrderStatus
												})}
											class="rounded-[8px] border border-border bg-surface px-2 py-1 text-xs text-ink"
										>
											{#each MERCH_ORDER_STATUSES as st (st)}
												<option value={st}>{orderStatusLabels[st]}</option>
											{/each}
										</select>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{/if}
</div>

<!-- Modal Précommande -->
<Modal
	bind:open={orderModalOpen}
	title={issuedOrder ? 'Précommande confirmée !' : selectedItem?.title || 'Précommander'}
	description={issuedOrder
		? `Référence ${issuedOrder.lookupCode}`
		: selectedItem
			? `Prix unitaire : ${formatEuros(selectedItem.priceCents)}`
			: undefined}
	size="md"
>
	{#if issuedOrder}
		<div class="space-y-4 text-center">
			<Badge variant={orderStatusVariant[issuedOrder.orderStatus]}>
				{orderStatusLabels[issuedOrder.orderStatus]}
			</Badge>
			<div class="rounded-[10px] border border-border bg-surface p-3.5 text-sm space-y-1">
				<div class="font-semibold text-ink">{issuedOrder.itemTitle}</div>
				<div class="text-muted">
					Taille {issuedOrder.size} · Quantité {issuedOrder.quantity} · {formatEuros(issuedOrder.totalCents)}
				</div>
			</div>
			<div class="rounded-[10px] border border-border bg-surface p-2.5 text-xs text-left space-y-1">
				<div class="font-semibold text-ink">Lien direct de suivi (sans compte) :</div>
				<div class="flex items-center justify-between gap-2">
					<code class="truncate font-mono text-[11px] text-muted">
						/boutique?lookup={issuedOrder.lookupCode}
					</code>
					<button
						type="button"
						class="shrink-0 font-semibold text-brand hover:underline cursor-pointer"
						onclick={async () => {
							const url = `${window.location.origin}/boutique?lookup=${issuedOrder?.lookupCode}`;
							try {
								await navigator.clipboard.writeText(url);
								toast.success('Lien copié');
							} catch {
								toast.info('Lien suivi', url);
							}
						}}
					>
						Copier
					</button>
				</div>
			</div>
			<Button
				variant="primary"
				onclick={() => {
					orderModalOpen = false;
					activeTab = 'my_orders';
				}}
			>
				Voir mes précommandes
			</Button>
		</div>
	{:else if selectedItem}
		<form id="merch-order-form" onsubmit={handleCreateOrder} class="space-y-4">
			{#if !data.user}
				<div class="rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2 text-xs text-ink">
					Précommande express sans compte : conserve ton lien de référence à l'étape suivante.
				</div>
			{/if}

			{#if orderError}
				<div role="alert" class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-sm text-danger">
					{orderError}
				</div>
			{/if}

			<div class="space-y-1.5">
				<span class="block text-sm font-semibold text-ink">Choisis ta taille</span>
				<div class="flex flex-wrap gap-2">
					{#each selectedItem.sizes as sz (sz)}
						<button
							type="button"
							onclick={() => (selectedSize = sz)}
							class={`min-h-10 min-w-12 cursor-pointer rounded-[8px] border px-3 text-sm font-semibold transition ${
								selectedSize === sz
									? 'border-brand bg-brand-soft text-ink ring-1 ring-brand'
									: 'border-border bg-surface text-muted hover:text-ink'
							}`}
						>
							{sz}
						</button>
					{/each}
				</div>
			</div>

			<div class="grid gap-3 sm:grid-cols-3">
				<div class="space-y-1.5">
					<label for="ord-qty" class="block text-sm font-semibold text-ink">Quantité</label>
					<input
						id="ord-qty"
						type="number"
						min="1"
						max="10"
						bind:value={quantity}
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
					/>
				</div>
				<div class="space-y-1.5 sm:col-span-2">
					<label for="ord-name" class="block text-sm font-semibold text-ink">Nom complet</label>
					<input
						id="ord-name"
						type="text"
						required
						bind:value={buyerName}
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
					/>
				</div>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="ord-classe" class="block text-sm font-semibold text-ink">Classe</label>
					<input
						id="ord-classe"
						type="text"
						required
						bind:value={buyerClasse}
						placeholder="Ex : Terminale G1"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="ord-email" class="block text-sm font-semibold text-ink">Email</label>
					<input
						id="ord-email"
						type="email"
						required
						bind:value={buyerEmail}
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<label for="ord-pay" class="block text-sm font-semibold text-ink">Mode de paiement</label>
				{#if currentOrderTotalCents === 0}
					<div class="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-500">
						Gratuit (0,00 €)
					</div>
				{:else}
					<select
						id="ord-pay"
						bind:value={paymentMethod}
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
					>
						{#if stripeEnabled}
							<option value="stripe">{paymentMethodLabels.stripe}</option>
						{/if}
						<option value="especes">{paymentMethodLabels.especes}</option>
						<option value="virement">{paymentMethodLabels.virement}</option>
						<option value="cheque">{paymentMethodLabels.cheque}</option>
					</select>
				{/if}
			</div>

			<div class="flex items-center justify-between rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm">
				<span class="text-muted">Total ({quantity} × {selectedSize})</span>
				<span class="text-base font-bold tabular-nums text-ink">{formatEuros(currentOrderTotalCents)}</span>
			</div>
		</form>
	{/if}

	{#snippet footer()}
		{#if !issuedOrder && selectedItem}
			<Button variant="secondary" onclick={() => (orderModalOpen = false)}>Annuler</Button>
			<Button type="submit" form="merch-order-form" variant="primary" loading={ordering}>
				{paymentMethod === 'stripe' && currentOrderTotalCents > 0
					? `Payer ${formatEuros(currentOrderTotalCents)} par CB`
					: 'Valider la précommande'}
			</Button>
		{/if}
	{/snippet}
</Modal>

<!-- Modal Création article (admin) -->
<Modal bind:open={createModalOpen} title="Nouvel article boutique" size="md">
	<form id="create-merch-form" onsubmit={handleCreateItem} class="space-y-4">
		{#if createItemError}
			<div role="alert" class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-sm text-danger">
				{createItemError}
			</div>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="new-m-title" class="block text-sm font-semibold text-ink">Nom de l'article</label>
				<input
					id="new-m-title"
					type="text"
					required
					bind:value={newTitle}
					placeholder="Ex : Sweat de promo 2027"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-cat" class="block text-sm font-semibold text-ink">Catégorie</label>
				<select
					id="new-m-cat"
					bind:value={newCategory}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink"
				>
					{#each MERCH_CATEGORIES as cat (cat)}
						<option value={cat}>{categoryLabels[cat]}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="new-m-desc" class="block text-sm font-semibold text-ink">Description</label>
			<textarea
				id="new-m-desc"
				rows="2"
				bind:value={newDescription}
				class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
			></textarea>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="new-m-price" class="block text-sm font-semibold text-ink">Prix de vente (€)</label>
				<input
					id="new-m-price"
					type="text"
					bind:value={newPriceEur}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-cost" class="block text-sm font-semibold text-ink">Coût fournisseur (€)</label>
				<input
					id="new-m-cost"
					type="text"
					bind:value={newSupplierCostEur}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="new-m-sizes" class="block text-sm font-semibold text-ink">Tailles (séparées par virgule)</label>
				<input
					id="new-m-sizes"
					type="text"
					bind:value={newSizesRaw}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-close" class="block text-sm font-semibold text-ink">Date limite (optionnel)</label>
				<input
					id="new-m-close"
					type="datetime-local"
					bind:value={newClosesAt}
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink"
				/>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="new-m-sname" class="block text-xs font-semibold text-ink">Fournisseur réel (optionnel)</label>
				<input
					id="new-m-sname"
					type="text"
					bind:value={newSupplierName}
					placeholder={data.settings.merchSupplierName || 'Ex : Imprimerie du Lycée / Gelato'}
					class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-semail" class="block text-xs font-semibold text-ink">Email fournisseur</label>
				<input
					id="new-m-semail"
					type="email"
					bind:value={newSupplierEmail}
					placeholder={data.settings.merchSupplierEmail || 'devis@atelier-textile.fr'}
					class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-surl" class="block text-xs font-semibold text-ink">URL fiche produit fournisseur</label>
				<input
					id="new-m-surl"
					type="url"
					bind:value={newSupplierUrl}
					placeholder="https://..."
					class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="new-m-sref" class="block text-xs font-semibold text-ink">Référence catalogue (SKU)</label>
				<input
					id="new-m-sref"
					type="text"
					bind:value={newSupplierRef}
					placeholder="Ex : STSU822-MARINE"
					class="min-h-10 w-full rounded-[10px] border border-border bg-surface px-3 py-1.5 text-sm text-ink"
				/>
			</div>
		</div>

		<label class="flex items-center gap-2 text-xs text-ink cursor-pointer">
			<input type="checkbox" bind:checked={newZeroAdvance} class="size-4 accent-brand" />
			Campagne zéro avance de trésorerie (lancer la production après clôture des précommandes)
		</label>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-merch-form" variant="primary" loading={creatingItem}>
			Publier l'article
		</Button>
	{/snippet}
</Modal>

<!-- Modal Bon de commande fournisseur -->
<Modal
	bind:open={
		() => poItem !== null,
		(v) => {
			if (!v) poItem = null;
		}
	}
	title={poItem ? `Bon de commande · ${poItem.title}` : 'Bon de commande'}
	size="md"
>
	{#if poItem}
		{@const poText = buildPurchaseOrderText(poItem)}
		{@const mailTarget = poItem.supplierEmail || data.settings.merchSupplierEmail}
		<div class="space-y-3">
			<pre class="whitespace-pre-wrap rounded-[10px] border border-border bg-surface p-3.5 font-mono text-xs leading-relaxed text-ink">{poText}</pre>
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if poItem.supplierUrl || data.settings.merchSupplierUrl}
					<a
						href={poItem.supplierUrl || data.settings.merchSupplierUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-9 items-center rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand/50"
					>
						Ouvrir site fournisseur ↗
					</a>
				{/if}
				{#if mailTarget}
					<a
						href={`mailto:${encodeURIComponent(mailTarget)}?subject=${encodeURIComponent(`Commande ${data.settings.mdlName} — ${poItem.title}`)}&body=${encodeURIComponent(poText)}`}
						class="inline-flex min-h-9 items-center rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand/50"
					>
						Envoyer par email ↗
					</a>
				{/if}
				<Button
					variant="primary"
					size="sm"
					onclick={async () => {
						try {
							await navigator.clipboard.writeText(poText);
							toast.success('Bon de commande copié !');
						} catch {
							toast.info('Sélectionne et copie le texte ci-dessus.');
						}
					}}
				>
					Copier le bon de commande
				</Button>
			</div>
		</div>
	{/if}
</Modal>
