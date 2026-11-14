<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { countdownLabel, formatDateTimeFr, formatEuros } from '$shared/format';
	import { hasAnyPermission, hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	type TicketTier = 'plein' | 'reduit' | 'prevente';
	type PaymentMethod = 'especes' | 'virement' | 'stripe' | 'gratuit';
	type PaymentStatus = 'en_attente' | 'paye' | 'annule';

	interface EventItem {
		id: number;
		projectId: number | null;
		title: string;
		description: string;
		eventDate: string;
		location: string;
		capacity: number;
		soldCount: number;
		remainingSeats: number;
		priceFullCents: number;
		priceReducedCents: number;
		pricePresaleCents: number;
		requiresAccessCode: boolean;
		accessCode?: string | null;
		isPublic: boolean;
		stripeEnabled: boolean;
		createdAt: string;
	}

	interface TicketItem {
		id: number;
		eventId: number;
		eventTitle?: string;
		eventDate?: string;
		eventLocation?: string;
		buyerUserId: number | null;
		buyerName: string;
		buyerEmail?: string;
		buyerClasse: string;
		tier: TicketTier;
		priceCents: number;
		paymentMethod: PaymentMethod;
		paymentStatus: PaymentStatus;
		qrCodeId: string;
		ed25519Token: string;
		lookupToken?: string | null;
		qrSvg: string;
		scannedAt: string | null;
		scannedBy: number | null;
		createdAt: string;
	}

	interface SeatStreamPayload {
		eventId: number;
		capacity: number;
		soldCount: number;
		remainingSeats: number;
	}

	const OFFLINE_TICKETS_CACHE_KEY = 'mdl-my-tickets-cache-v1';

	let { data }: { data: PageData } = $props();

	const canBuy = $derived(data.user ? hasPermission(data.user.role, 'tickets:buy') : false);
	const canScan = $derived(data.user ? hasPermission(data.user.role, 'tickets:scan') : false);
	const canManageTickets = $derived(
		data.user ? hasPermission(data.user.role, 'tickets:manage') : false
	);
	const canReadAdminTickets = $derived(
		data.user ? hasAnyPermission(data.user.role, ['tickets:manage', 'tickets:read_admin']) : false
	);

	let activeTab = $state<'events' | 'my_tickets' | 'admin'>('events');
	let loadingEvents = $state(true);
	let loadingTickets = $state(false);
	let loadingAdminTickets = $state(false);
	let eventsList = $state<EventItem[]>([]);
	let myTickets = $state<TicketItem[]>([]);
	const myActiveEventIds = $derived(
		new Set(myTickets.filter((t) => t.paymentStatus !== 'annule').map((t) => t.eventId))
	);
	let adminTickets = $state<TicketItem[]>([]);
	let ticketsFromOfflineCache = $state(false);

	// Modal achat / réservation
	let buyModalOpen = $state(false);
	let selectedEvent = $state<EventItem | null>(null);
	let buyerName = $state('');
	let buyerEmail = $state('');
	let buyerClasse = $state('');
	let selectedTier = $state<TicketTier>('plein');
	let selectedPaymentMethod = $state<PaymentMethod>('especes');
	let accessCode = $state('');
	let buying = $state(false);
	let buyError = $state('');
	let issuedTicket = $state<TicketItem | null>(null);

	// Modal agrandissement QR pour scan rapide à l'entrée
	let qrZoomTicket = $state<TicketItem | null>(null);

	// Création d'événement (admin)
	let createEventModalOpen = $state(false);
	let creatingEvent = $state(false);
	let createEventError = $state('');
	let evTitle = $state('');
	let evDescription = $state('');
	let evDate = $state('');
	let evLocation = $state('');
	let evCapacity = $state(120);
	let evPriceFullEur = $state('5');
	let evPriceReducedEur = $state('3');
	let evPricePresaleEur = $state('4');
	let evAccessCode = $state('');
	let evIsPublic = $state(true);

	// Filtres admin billets
	let adminSearch = $state('');
	let adminStatusFilter = $state<'all' | PaymentStatus>('all');
	let updatingTicketId = $state<number | null>(null);

	const tierLabels: Record<TicketTier, string> = {
		plein: 'Tarif plein',
		reduit: 'Tarif réduit (adhérent)',
		prevente: 'Prévente'
	};

	const paymentMethodLabels: Record<PaymentMethod, string> = {
		especes: 'Espèces (au bureau MDL)',
		virement: 'Virement bancaire',
		stripe: 'Carte bancaire (Stripe)',
		gratuit: 'Gratuit'
	};

	const statusLabels: Record<PaymentStatus, string> = {
		en_attente: 'En attente de règlement',
		paye: 'Payé / Valide',
		annule: 'Annulé'
	};

	const statusVariant: Record<PaymentStatus, 'warning' | 'success' | 'danger'> = {
		en_attente: 'warning',
		paye: 'success',
		annule: 'danger'
	};

	function tierPriceCents(ev: EventItem, tier: TicketTier): number {
		if (tier === 'plein') return ev.priceFullCents;
		if (tier === 'reduit') return ev.priceReducedCents;
		return ev.pricePresaleCents;
	}

	const currentTierPriceCents = $derived(
		selectedEvent ? tierPriceCents(selectedEvent, selectedTier) : 0
	);

	// Ajuster automatiquement le mode de paiement si tarif gratuit
	$effect(() => {
		if (currentTierPriceCents === 0) {
			selectedPaymentMethod = 'gratuit';
		} else if (selectedPaymentMethod === 'gratuit') {
			selectedPaymentMethod = 'especes';
		}
	});

	const filteredAdminTickets = $derived.by(() => {
		const q = adminSearch.trim().toLowerCase();
		return adminTickets.filter((t) => {
			if (adminStatusFilter !== 'all' && t.paymentStatus !== adminStatusFilter) return false;
			if (!q) return true;
			return (
				t.buyerName.toLowerCase().includes(q) ||
				t.buyerClasse.toLowerCase().includes(q) ||
				t.qrCodeId.toLowerCase().includes(q) ||
				(t.eventTitle || '').toLowerCase().includes(q)
			);
		});
	});

	async function loadEvents() {
		loadingEvents = true;
		try {
			const res = await fetch('/api/events');
			const payload = (await res.json().catch(() => ({}))) as { events?: EventItem[] };
			if (res.ok && payload.events) {
				eventsList = payload.events;
				const eventParam = page.url.searchParams.get('event');
				if (eventParam) {
					const targetId = Number.parseInt(eventParam, 10);
					const match = eventsList.find((e) => e.id === targetId);
					if (match) {
						openBuyModal(match);
					}
				}
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger les événements.');
		} finally {
			loadingEvents = false;
		}
	}

	async function loadMyTickets() {
		if (!data.user) return;
		loadingTickets = true;
		ticketsFromOfflineCache = false;
		try {
			const res = await fetch('/api/tickets');
			const payload = (await res.json().catch(() => ({}))) as { tickets?: TicketItem[] };
			if (res.ok && payload.tickets) {
				myTickets = payload.tickets;
				try {
					window.localStorage.setItem(
						`${OFFLINE_TICKETS_CACHE_KEY}:${data.user.id}`,
						JSON.stringify(payload.tickets)
					);
				} catch {
					// Quota dépassé : ignorer
				}
			}
		} catch {
			// Fallback hors-ligne Android
			try {
				const cached = window.localStorage.getItem(`${OFFLINE_TICKETS_CACHE_KEY}:${data.user.id}`);
				if (cached) {
					myTickets = JSON.parse(cached) as TicketItem[];
					ticketsFromOfflineCache = true;
				}
			} catch {
				// Ignorer
			}
		} finally {
			loadingTickets = false;
		}
	}

	async function loadAdminTickets() {
		if (!canReadAdminTickets) return;
		loadingAdminTickets = true;
		try {
			const res = await fetch('/api/tickets?scope=all');
			const payload = (await res.json().catch(() => ({}))) as { tickets?: TicketItem[] };
			if (res.ok && payload.tickets) {
				adminTickets = payload.tickets;
			}
		} catch {
			toast.error('Erreur réseau', 'Impossible de charger la liste des billets.');
		} finally {
			loadingAdminTickets = false;
		}
	}

	const GUEST_LOOKUPS_KEY = 'mdl-guest-ticket-lookups-v1';

	async function loadLookupTicket(token: string) {
		try {
			const res = await fetch(`/api/tickets/lookup?token=${encodeURIComponent(token)}`);
			const payload = (await res.json().catch(() => ({}))) as { ticket?: TicketItem };
			if (res.ok && payload.ticket) {
				const t = payload.ticket;
				myTickets = [t, ...myTickets.filter((x) => x.id !== t.id)];
				return t;
			}
		} catch {
			// Ignorer
		}
		return null;
	}

	function saveGuestLookupToken(token: string) {
		try {
			const raw = window.localStorage.getItem(GUEST_LOOKUPS_KEY);
			const arr = raw ? (JSON.parse(raw) as string[]) : [];
			const next = Array.from(new Set([token, ...arr])).slice(0, 10);
			window.localStorage.setItem(GUEST_LOOKUPS_KEY, JSON.stringify(next));
		} catch {
			// Ignorer
		}
	}

	onMount(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const stripeStatus = urlParams.get('stripe_status');
		const sessionId = urlParams.get('session_id');
		const lookup = urlParams.get('lookup');

		if (stripeStatus === 'cancel') {
			toast.info('Paiement annulé', 'Ta réservation CB n’a pas été finalisée.');
		} else if (stripeStatus === 'success' && sessionId) {
			try {
				const vRes = await fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`);
				const vData = (await vRes.json().catch(() => ({}))) as { paid?: boolean; error?: string };
				if (vRes.ok && vData.paid) {
					toast.success('Paiement confirmé', 'Ton billet a été validé par Stripe.');
				} else if (vData.error) {
					toast.warning('Vérification paiement', vData.error);
				}
			} catch {
				// Ignorer
			}
		}

		await loadEvents();

		if (lookup) {
			saveGuestLookupToken(lookup);
			const t = await loadLookupTicket(lookup);
			if (t) {
				issuedTicket = t;
				selectedEvent = eventsList.find((e) => e.id === t.eventId) ?? null;
				buyModalOpen = true;
				activeTab = 'my_tickets';
			} else {
				toast.warning('Lien invalide', 'Billet introuvable pour ce lien.');
			}
		}

		if (data.user) {
			await loadMyTickets();
			if (canReadAdminTickets) {
				await loadAdminTickets();
			}
		} else {
			try {
				const raw = window.localStorage.getItem(GUEST_LOOKUPS_KEY);
				const tokens = raw ? (JSON.parse(raw) as string[]) : [];
				for (const tok of tokens) {
					if (tok !== lookup) {
						await loadLookupTicket(tok);
					}
				}
			} catch {
				// Ignorer
			}
		}
	});

	const eventIdsKey = $derived(eventsList.map((e) => e.id).join(','));

	// EventSource temps réel pour les jauges & places restantes
	$effect(() => {
		if (typeof window === 'undefined' || !eventIdsKey) return;

		const ids = eventIdsKey
			.split(',')
			.map((s) => Number.parseInt(s, 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		const sources: EventSource[] = [];

		for (const id of ids) {
			const es = new EventSource(`/api/events/${id}/stream`);
			es.addEventListener('seats', (ev: MessageEvent) => {
				try {
					const seatData = JSON.parse(ev.data) as SeatStreamPayload;
					eventsList = eventsList.map((item) =>
						item.id === seatData.eventId
							? {
									...item,
									capacity: seatData.capacity,
									soldCount: seatData.soldCount,
									remainingSeats: seatData.remainingSeats
								}
							: item
					);
					if (selectedEvent?.id === seatData.eventId) {
						selectedEvent = {
							...selectedEvent,
							capacity: seatData.capacity,
							soldCount: seatData.soldCount,
							remainingSeats: seatData.remainingSeats
						};
					}
				} catch {
					// Ignorer
				}
			});
			sources.push(es);
		}

		return () => {
			for (const es of sources) {
				es.close();
			}
		};
	});

	function openBuyModal(ev: EventItem) {
		if (myActiveEventIds.has(ev.id)) {
			activeTab = 'my_tickets';
			toast.info('Billet déjà réservé', 'Tu as déjà une place active pour cet événement.');
			return;
		}
		selectedEvent = ev;
		issuedTicket = null;
		buyError = '';
		accessCode = '';
		buyerName = data.user ? `${data.user.firstName} ${data.user.lastName}`.trim() : '';
		buyerEmail = data.user?.email ?? '';
		buyerClasse = data.user?.classe ?? '';
		selectedTier = data.user?.isAdherent ? 'reduit' : 'plein';
		const price = tierPriceCents(ev, selectedTier);
		selectedPaymentMethod = price === 0 ? 'gratuit' : 'especes';
		buyModalOpen = true;
	}

	async function handlePurchase(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedEvent) return;
		if (data.user && !canBuy) return;
		if (!data.user && !selectedEvent.isPublic) return;
		buyError = '';

		if (!buyerName.trim() || !buyerEmail.trim() || !buyerClasse.trim()) {
			buyError = 'Complète ton nom, ton email et ta classe.';
			return;
		}
		if (selectedEvent.requiresAccessCode && !accessCode.trim()) {
			buyError = 'Cet événement nécessite un code d’accès.';
			return;
		}

		buying = true;
		try {
			const res = await fetch('/api/tickets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					eventId: selectedEvent.id,
					buyerName: buyerName.trim(),
					buyerEmail: buyerEmail.trim(),
					buyerClasse: buyerClasse.trim(),
					tier: selectedTier,
					paymentMethod: currentTierPriceCents === 0 ? 'gratuit' : selectedPaymentMethod,
					accessCode: selectedEvent.requiresAccessCode ? accessCode.trim() : undefined
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				ticket?: TicketItem;
				checkoutUrl?: string | null;
				remainingSeats?: number;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.ticket) {
				buyError = payload.error || payload.message || 'Impossible de réserver ce billet.';
				return;
			}

			if (payload.ticket.lookupToken) {
				saveGuestLookupToken(payload.ticket.lookupToken);
			}

			if (payload.checkoutUrl) {
				toast.info('Redirection vers Stripe...', 'Finalise le paiement sécurisé par carte.');
				window.location.href = payload.checkoutUrl;
				return;
			}

			const enriched: TicketItem = {
				...payload.ticket,
				eventTitle: selectedEvent.title,
				eventDate: selectedEvent.eventDate,
				eventLocation: selectedEvent.location,
				buyerUserId: data.user?.id ?? null,
				scannedAt: null,
				scannedBy: null
			};

			issuedTicket = enriched;
			myTickets = [enriched, ...myTickets];
			if (canReadAdminTickets) {
				adminTickets = [enriched, ...adminTickets];
			}
			if (data.user) {
				try {
					window.localStorage.setItem(
						`${OFFLINE_TICKETS_CACHE_KEY}:${data.user.id}`,
						JSON.stringify(myTickets)
					);
				} catch {
					// Ignorer
				}
			}

			toast.success('Billet réservé', `Code ${enriched.qrCodeId} prêt dans Mes billets.`);
		} catch {
			buyError = 'Erreur réseau lors de la réservation.';
		} finally {
			buying = false;
		}
	}

	function parseEurToCents(raw: string | number): number {
		const normalized = String(raw ?? '').replace(',', '.').trim();
		const num = Number.parseFloat(normalized);
		if (!Number.isFinite(num) || num < 0) return 0;
		return Math.round(num * 100);
	}

	async function handleCreateEvent(event: SubmitEvent) {
		event.preventDefault();
		createEventError = '';

		if (!evTitle.trim() || !evDate || !evLocation.trim()) {
			createEventError = 'Titre, date et lieu sont requis.';
			return;
		}

		creatingEvent = true;
		try {
			const res = await fetch('/api/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: evTitle.trim(),
					description: evDescription.trim(),
					eventDate: new Date(evDate).toISOString(),
					location: evLocation.trim(),
					capacity: Number(evCapacity),
					priceFullCents: parseEurToCents(evPriceFullEur),
					priceReducedCents: parseEurToCents(evPriceReducedEur),
					pricePresaleCents: parseEurToCents(evPricePresaleEur),
					accessCode: evAccessCode.trim() || undefined,
					isPublic: evIsPublic
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				event?: EventItem;
				error?: string;
				message?: string;
			};

			if (!res.ok || !payload.event) {
				createEventError = payload.error || payload.message || 'Impossible de créer l’événement.';
				return;
			}

			eventsList = [...eventsList, payload.event];
			createEventModalOpen = false;
			evTitle = '';
			evDescription = '';
			evDate = '';
			evLocation = '';
			evAccessCode = '';
			toast.success('Événement créé', `${payload.event.title} est maintenant en billetterie.`);
		} catch {
			createEventError = 'Erreur réseau lors de la création.';
		} finally {
			creatingEvent = false;
		}
	}

	async function updatePaymentStatus(ticket: TicketItem, nextStatus: PaymentStatus) {
		if (!canManageTickets || updatingTicketId !== null) return;
		const previous = adminTickets;
		updatingTicketId = ticket.id;

		// Optimiste
		adminTickets = adminTickets.map((t) =>
			t.id === ticket.id ? { ...t, paymentStatus: nextStatus } : t
		);
		myTickets = myTickets.map((t) =>
			t.id === ticket.id ? { ...t, paymentStatus: nextStatus } : t
		);

		try {
			const res = await fetch('/api/tickets', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketId: ticket.id, paymentStatus: nextStatus })
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
			if (!res.ok) {
				adminTickets = previous;
				toast.error('Mise à jour impossible', payload.error || payload.message || 'Erreur serveur.');
				return;
			}
			toast.success(
				nextStatus === 'paye' ? 'Paiement encaissé' : 'Billet mis à jour',
				`${ticket.buyerName} (${ticket.qrCodeId})`
			);
		} catch {
			adminTickets = previous;
			toast.error('Erreur réseau', 'Impossible de joindre le serveur.');
		} finally {
			updatingTicketId = null;
		}
	}

	function seatsPercent(ev: EventItem): number {
		if (ev.capacity <= 0) return 100;
		return Math.min(100, Math.round((ev.soldCount / ev.capacity) * 100));
	}
</script>

<svelte:head>
	<title>Billetterie · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
				Billetterie & QR codes
			</h1>
			<p class="mt-1.5 text-sm text-muted">
				Jauges actualisées en direct et billets signés Ed25519 consultables hors connexion.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2.5">
			{#if canScan}
				<Button href="/billetterie/scanner" variant="secondary">
					<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path stroke-linecap="round" d="M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2m0 10v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10" />
					</svg>
					Scanner à l'entrée
				</Button>
			{/if}
			{#if canManageTickets}
				<Button variant="primary" onclick={() => (createEventModalOpen = true)}>
					+ Nouvel événement
				</Button>
			{/if}
		</div>
	</header>

	<!-- Navigation par onglets façon contrôle segmenté iOS -->
	<div
		role="tablist"
		aria-label="Sections billetterie"
		class="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-2 p-0.5 sm:inline-flex"
	>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'events'}
			onclick={() => (activeTab = 'events')}
			class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-2.5 sm:px-3.5 py-1.5 text-[12px] sm:text-[13px] font-semibold transition ${
				activeTab === 'events' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
			}`}
		>
			Événements ({eventsList.length})
		</button>

		{#if data.user || myTickets.length > 0}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'my_tickets'}
				onclick={() => (activeTab = 'my_tickets')}
				class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-2.5 sm:px-3.5 py-1.5 text-[12px] sm:text-[13px] font-semibold transition ${
					activeTab === 'my_tickets' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
				}`}
			>
				Mes billets ({myTickets.length})
			</button>
		{/if}

		{#if canReadAdminTickets}
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === 'admin'}
				onclick={() => (activeTab = 'admin')}
				class={`gpu-press min-h-9 shrink-0 cursor-pointer rounded-[8px] px-2.5 sm:px-3.5 py-1.5 text-[12px] sm:text-[13px] font-semibold transition ${
					activeTab === 'admin' ? 'bg-card text-ink apple-shadow-card' : 'text-muted hover:text-ink'
				}`}
			>
				Gestion & encaissements ({adminTickets.length})
			</button>
		{/if}
	</div>

	{#if activeTab === 'events'}
		{#if loadingEvents}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Skeleton variant="card" height="240px" />
				<Skeleton variant="card" height="240px" />
				<Skeleton variant="card" height="240px" />
			</div>
		{:else if eventsList.length === 0}
			<Card padding="lg" class="text-center space-y-2">
				<p class="text-base font-bold text-ink">Aucun événement ouvert en billetterie</p>
				<p class="text-sm text-muted">
					Les prochains événements du lycée apparaîtront ici dès leur publication.
				</p>
			</Card>
		{:else}
			<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each eventsList as ev (ev.id)}
					{@const fillPct = seatsPercent(ev)}
					{@const isFull = ev.remainingSeats <= 0}
					{@const hasActiveTicket = myActiveEventIds.has(ev.id)}

					<Card hover as="article" class="flex flex-col justify-between gap-4">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<Badge variant="brand">{countdownLabel(ev.eventDate)}</Badge>
								<div class="flex items-center gap-1.5">
									{#if !ev.isPublic}
										<Badge variant="neutral">Privé</Badge>
									{/if}
									{#if ev.requiresAccessCode}
										<Badge variant="warning">Code requis</Badge>
									{/if}
								</div>
							</div>

							<div>
								<h2 class="text-lg font-bold leading-snug text-ink">{ev.title}</h2>
								{#if ev.description}
									<p class="mt-1 text-sm leading-relaxed text-muted">{ev.description}</p>
								{/if}
							</div>

							<dl class="space-y-1 text-xs text-muted">
								<div class="flex items-center gap-2">
									<span class="font-semibold text-ink">Date :</span>
									<dd>{formatDateTimeFr(ev.eventDate)}</dd>
								</div>
								<div class="flex items-center gap-2">
									<span class="font-semibold text-ink">Lieu :</span>
									<dd>{ev.location}</dd>
								</div>
							</dl>
							<!-- Jauge épurée sans boîte imbriquée -->
							<div class="space-y-1.5 pt-1" aria-live="polite">
								<div class="flex items-center justify-between text-[12px]">
									<span class="font-medium text-ink">
										{isFull ? 'Complet' : `${ev.remainingSeats} places restantes`}
									</span>
									<span class="tabular-nums text-muted">
										{Math.max(0, ev.capacity - ev.remainingSeats)}/{ev.capacity} réservées
									</span>
								</div>
								<div class="h-1 w-full overflow-hidden rounded-full bg-surface-2">
									<div
										class={`h-full rounded-full transition-[width] duration-300 ease-out ${
											isFull
												? 'bg-[#dc2626]'
												: fillPct >= 85
													? 'bg-[#d97706]'
													: 'bg-ink/80'
										}`}
										style={`width: ${fillPct}%`}
									></div>
								</div>
							</div>

							<div class="grid grid-cols-3 divide-x divide-border border-t border-border pt-3 text-center text-[12px]">
								<div class="px-1">
									<div class="text-[11px] text-muted">Plein</div>
									<div class="tabular-nums font-semibold text-ink">{formatEuros(ev.priceFullCents)}</div>
								</div>
								<div class="px-1">
									<div class="text-[11px] text-muted">Réduit</div>
									<div class="tabular-nums font-semibold text-ink">{formatEuros(ev.priceReducedCents)}</div>
								</div>
								<div class="px-1">
									<div class="text-[11px] text-muted">Prévente</div>
									<div class="tabular-nums font-semibold text-ink">{formatEuros(ev.pricePresaleCents)}</div>
								</div>
							</div>
						</div>

						<Button
							variant={hasActiveTicket || isFull ? 'secondary' : 'primary'}
							disabled={isFull && !hasActiveTicket}
							fullWidth
							onclick={() => (hasActiveTicket ? (activeTab = 'my_tickets') : openBuyModal(ev))}
						>
							{hasActiveTicket ? 'Voir mon billet' : isFull ? 'Complet' : 'Réserver ma place'}
						</Button>
					</Card>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'my_tickets'}
		{#if ticketsFromOfflineCache}
			<Card padding="sm" class="border-amber-500/30 bg-amber-500/10 text-xs font-medium text-amber-900 dark:text-amber-300">
				Mode hors-ligne : affichage de tes billets enregistrés sur cet appareil.
			</Card>
		{/if}

		{#if loadingTickets}
			<div class="grid gap-4 md:grid-cols-2">
				<Skeleton variant="card" height="220px" />
				<Skeleton variant="card" height="220px" />
			</div>
		{:else if myTickets.length === 0}
			<Card padding="lg" class="text-center space-y-3">
				<p class="text-base font-bold text-ink">Tu n'as encore aucun billet</p>
				<p class="text-sm text-muted">
					Réserve une place sur un événement pour obtenir ton QR code d'entrée signé.
				</p>
				<Button variant="primary" onclick={() => (activeTab = 'events')}>
					Voir les événements
				</Button>
			</Card>
		{:else}
			<div class="grid gap-5 md:grid-cols-2">
				{#each myTickets as ticket (ticket.id)}
					<Card class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="min-w-0 flex-1 space-y-2.5">
							<div class="flex flex-wrap items-center gap-1.5">
								<Badge variant={statusVariant[ticket.paymentStatus]} dot>
									{statusLabels[ticket.paymentStatus]}
								</Badge>
								{#if ticket.scannedAt}
									<Badge variant="brand">Scanné</Badge>
								{/if}
							</div>

							<div>
								<h2 class="text-base font-bold text-ink">
									{ticket.eventTitle || `Événement #${ticket.eventId}`}
								</h2>
								{#if ticket.eventDate}
									<p class="text-xs text-muted">
										{formatDateTimeFr(ticket.eventDate)}
										{#if ticket.eventLocation}· {ticket.eventLocation}{/if}
									</p>
								{/if}
							</div>

							<dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
								<div>
									<dt class="text-muted">Titulaire</dt>
									<dd class="font-semibold text-ink">{ticket.buyerName} ({ticket.buyerClasse})</dd>
								</div>
								<div>
									<dt class="text-muted">Tarif & règlement</dt>
									<dd class="font-semibold text-ink">
										{formatEuros(ticket.priceCents)} · {ticket.paymentMethod}
									</dd>
								</div>
								<div class="col-span-2">
									<dt class="text-muted">Référence billet</dt>
									<dd class="font-mono font-bold text-ink">{ticket.qrCodeId}</dd>
								</div>
							</dl>
						</div>

						<div class="flex flex-col items-center gap-2 shrink-0">
							<button
								type="button"
								onclick={() => (qrZoomTicket = ticket)}
								aria-label={`Agrandir le QR code du billet ${ticket.qrCodeId}`}
								class="gpu-press cursor-pointer rounded-[20px] border border-border bg-white p-3 apple-shadow-card transition-[border-color] duration-150 hover:border-brand/50"
							>
								<div class="size-36 [&>svg]:h-full [&>svg]:w-full">
									{@html ticket.qrSvg}
								</div>
							</button>
							<span class="text-[11px] font-medium text-muted">Toucher pour agrandir</span>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'admin' && canReadAdminTickets}
		<Card class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-1 flex-wrap items-center gap-2.5">
					<label for="admin-ticket-search" class="sr-only">Rechercher un billet</label>
					<input
						id="admin-ticket-search"
						type="search"
						bind:value={adminSearch}
						placeholder="Nom, classe, référence MDL-..., événement..."
						class="min-h-11 min-w-56 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					/>
					<label for="admin-ticket-status" class="sr-only">Filtrer par statut</label>
					<select
						id="admin-ticket-status"
						bind:value={adminStatusFilter}
						class="min-h-11 rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					>
						<option value="all">Tous les statuts</option>
						<option value="en_attente">En attente</option>
						<option value="paye">Payés</option>
						<option value="annule">Annulés</option>
					</select>
				</div>

				<Button size="sm" variant="secondary" onclick={loadAdminTickets}>
					Actualiser
				</Button>
			</div>

			{#if loadingAdminTickets}
				<Skeleton variant="text" lines={5} />
			{:else if filteredAdminTickets.length === 0}
				<p class="py-6 text-center text-sm text-muted">Aucun billet ne correspond à cette recherche.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full border-collapse text-left text-sm">
						<thead>
							<tr class="border-b border-border text-xs text-muted">
								<th class="py-2.5 pr-3">Acheteur</th>
								<th class="py-2.5 pr-3">Événement</th>
								<th class="py-2.5 pr-3">Tarif / Mode</th>
								<th class="py-2.5 pr-3">Statut</th>
								<th class="py-2.5 text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/70">
							{#each filteredAdminTickets as ticket (ticket.id)}
								<tr>
									<td class="py-3 pr-3">
										<p class="font-semibold text-ink">{ticket.buyerName}</p>
										<p class="text-xs text-muted">
											{ticket.buyerClasse} · <span class="font-mono">{ticket.qrCodeId}</span>
										</p>
									</td>
									<td class="py-3 pr-3">
										<p class="font-medium text-ink">
											{ticket.eventTitle || `#${ticket.eventId}`}
										</p>
										{#if ticket.scannedAt}
											<p class="text-xs text-emerald-700 dark:text-emerald-300">
												Scanné le {formatDateTimeFr(ticket.scannedAt)}
											</p>
										{/if}
									</td>
									<td class="py-3 pr-3">
										<p class="font-semibold text-ink">{formatEuros(ticket.priceCents)}</p>
										<p class="text-xs text-muted">{ticket.tier} · {ticket.paymentMethod}</p>
									</td>
									<td class="py-3 pr-3">
										<Badge variant={statusVariant[ticket.paymentStatus]} dot>
											{statusLabels[ticket.paymentStatus]}
										</Badge>
									</td>
									<td class="py-3 text-right">
										{#if canManageTickets}
											<div class="inline-flex flex-wrap justify-end gap-1.5">
												{#if ticket.paymentStatus !== 'paye'}
													<Button
														size="sm"
														variant="primary"
														loading={updatingTicketId === ticket.id}
														onclick={() => updatePaymentStatus(ticket, 'paye')}
													>
														Encaisser
													</Button>
												{/if}
												{#if ticket.paymentStatus !== 'annule'}
													<Button
														size="sm"
														variant="danger"
														loading={updatingTicketId === ticket.id}
														onclick={() => updatePaymentStatus(ticket, 'annule')}
													>
														Annuler
													</Button>
												{/if}
											</div>
										{/if}
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

<!-- Modal achat / réservation billet -->
<Modal
	bind:open={buyModalOpen}
	title={issuedTicket ? 'Billet confirmé' : selectedEvent?.title || 'Réserver un billet'}
	description={issuedTicket
		? 'Présente ce QR code Ed25519 à l’entrée (accessible même hors connexion).'
		: selectedEvent
			? `${formatDateTimeFr(selectedEvent.eventDate)} · ${selectedEvent.location}`
			: undefined}
	size="md"
>
	{#if issuedTicket}
		<div class="space-y-4 text-center">
			<div class="flex justify-center">
				<Badge variant={statusVariant[issuedTicket.paymentStatus]} dot>
					{statusLabels[issuedTicket.paymentStatus]}
				</Badge>
			</div>

			<div class="mx-auto inline-block rounded-2xl border border-border bg-white p-4 shadow-xs">
				<div class="size-52 [&>svg]:h-full [&>svg]:w-full">
					{@html issuedTicket.qrSvg}
				</div>
			</div>

			<p class="font-mono text-sm font-bold text-ink">{issuedTicket.qrCodeId}</p>

			{#if issuedTicket.lookupToken}
				<div class="rounded-[10px] border border-border bg-surface p-2.5 text-xs text-left space-y-1">
					<div class="font-semibold text-ink">Lien direct de ton billet (sans compte) :</div>
					<div class="flex items-center justify-between gap-2">
						<code class="truncate font-mono text-[11px] text-muted">
							/billetterie?lookup={issuedTicket.lookupToken}
						</code>
						<button
							type="button"
							class="shrink-0 font-semibold text-brand hover:underline cursor-pointer"
							onclick={async () => {
								const url = `${window.location.origin}/billetterie?lookup=${issuedTicket?.lookupToken}`;
								try {
									await navigator.clipboard.writeText(url);
									toast.success('Lien copié', 'Conserve ce lien pour retrouver ton QR code.');
								} catch {
									toast.info('Lien billet', url);
								}
							}}
						>
							Copier
						</button>
					</div>
				</div>
			{/if}

			{#if issuedTicket.paymentStatus === 'en_attente'}
				<p class="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-300">
					Pense à régler ({formatEuros(issuedTicket.priceCents)}) par {issuedTicket.paymentMethod} auprès du bureau MDL pour valider définitivement ton entrée.
				</p>
			{/if}

			<div class="flex flex-wrap justify-center gap-2.5 pt-2">
				<Button
					variant="primary"
					onclick={() => {
						buyModalOpen = false;
						activeTab = 'my_tickets';
					}}
				>
					Voir tous mes billets
				</Button>
			</div>
		</div>
	{:else if !data.user && selectedEvent && !selectedEvent.isPublic}
		<div class="space-y-4 text-center py-2">
			<p class="text-sm text-muted">
				Cet événement est privé : connecte-toi à ton compte lycéen pour réserver ton billet.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<Button
					href={`/connexion?redirect=${encodeURIComponent(`/billetterie?event=${selectedEvent?.id ?? ''}`)}`}
					variant="primary"
				>
					Se connecter
				</Button>
				<Button href="/inscription" variant="secondary">Créer un compte</Button>
			</div>
		</div>
	{:else if selectedEvent}
		<form id="buy-ticket-form" onsubmit={handlePurchase} class="space-y-4">
			{#if !data.user}
				<div class="rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-xs text-ink">
					Achat rapide sans compte activé : tu recevras ton QR code immédiatement avec un lien personnel de sauvegarde.
				</div>
			{/if}
			{#if buyError}
				<div
					role="alert"
					class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
				>
					{buyError}
				</div>
			{/if}

			<fieldset class="space-y-2">
				<legend class="text-sm font-semibold text-ink">Choisis ton tarif</legend>
				<div class="grid gap-2 sm:grid-cols-3">
					{#each [
						{ id: 'plein', label: 'Plein', price: selectedEvent.priceFullCents },
						{ id: 'reduit', label: 'Réduit', price: selectedEvent.priceReducedCents },
						{ id: 'prevente', label: 'Prévente', price: selectedEvent.pricePresaleCents }
					] as opt (opt.id)}
						<button
							type="button"
							onclick={() => (selectedTier = opt.id as TicketTier)}
							aria-pressed={selectedTier === opt.id}
							class={`min-h-12 cursor-pointer rounded-[10px] border p-2.5 text-left transition ${
								selectedTier === opt.id
									? 'border-brand bg-brand-soft ring-1 ring-brand'
									: 'border-border bg-surface hover:border-brand/40'
							}`}
						>
							<div class="text-xs font-medium text-muted">{opt.label}</div>
							<div class="text-sm font-bold text-ink">{formatEuros(opt.price)}</div>
						</button>
					{/each}
				</div>
			</fieldset>

			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="ticket-buyer-name" class="block text-sm font-semibold text-ink">
						Nom complet
					</label>
					<input
						id="ticket-buyer-name"
						type="text"
						bind:value={buyerName}
						required
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="ticket-buyer-classe" class="block text-sm font-semibold text-ink">
						Classe
					</label>
					<input
						id="ticket-buyer-classe"
						type="text"
						bind:value={buyerClasse}
						required
						placeholder="Ex : 1ère G2"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<label for="ticket-buyer-email" class="block text-sm font-semibold text-ink">
					Email de contact
				</label>
				<input
					id="ticket-buyer-email"
					type="email"
					bind:value={buyerEmail}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			{#if selectedEvent.requiresAccessCode}
				<div class="space-y-1.5">
					<label for="ticket-access-code" class="block text-sm font-semibold text-ink">
						Code d'accès événement
					</label>
					<input
						id="ticket-access-code"
						type="text"
						bind:value={accessCode}
						required
						placeholder="Code fourni par le bureau MDL"
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					/>
				</div>
			{/if}

			<div class="space-y-1.5">
				<label for="ticket-payment" class="block text-sm font-semibold text-ink">
					Mode de règlement
				</label>
				{#if currentTierPriceCents === 0}
					<div class="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
						Tarif gratuit (0,00 €), billet validé immédiatement
					</div>
				{:else}
					<select
						id="ticket-payment"
						bind:value={selectedPaymentMethod}
						class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
					>
						<option value="especes">{paymentMethodLabels.especes}</option>
						<option value="virement">{paymentMethodLabels.virement}</option>
						{#if selectedEvent.stripeEnabled}
							<option value="stripe">{paymentMethodLabels.stripe}</option>
						{/if}
					</select>
				{/if}
			</div>

			<div class="flex items-center justify-between rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm">
				<span class="text-muted">Total ({tierLabels[selectedTier]})</span>
				<span class="text-base font-semibold text-ink">{formatEuros(currentTierPriceCents)}</span>
			</div>
		</form>
	{/if}

	{#snippet footer()}
		{#if !issuedTicket && selectedEvent && (data.user ? canBuy : selectedEvent.isPublic)}
			<Button variant="secondary" onclick={() => (buyModalOpen = false)}>Annuler</Button>
			<Button
				type="submit"
				form="buy-ticket-form"
				variant="primary"
				loading={buying}
				disabled={data.user ? !canBuy : false}
			>
				{selectedPaymentMethod === 'stripe' && currentTierPriceCents > 0
					? `Payer ${formatEuros(currentTierPriceCents)} par CB`
					: 'Confirmer la réservation'}
			</Button>
		{/if}
	{/snippet}
</Modal>

<!-- Modal QR agrandi pour scan fluide -->
<Modal
	open={qrZoomTicket !== null}
	onclose={() => (qrZoomTicket = null)}
	title={qrZoomTicket?.eventTitle || 'Billet QR'}
	description={qrZoomTicket ? `${qrZoomTicket.buyerName} · ${qrZoomTicket.qrCodeId}` : undefined}
	size="sm"
>
	{#if qrZoomTicket}
		<div class="space-y-4 text-center">
			<div class="mx-auto inline-block rounded-2xl border border-border bg-white p-4">
				<div class="size-64 [&>svg]:h-full [&>svg]:w-full">
					{@html qrZoomTicket.qrSvg}
				</div>
			</div>
			<p class="font-mono text-sm font-bold text-ink">{qrZoomTicket.qrCodeId}</p>
			<Badge variant={statusVariant[qrZoomTicket.paymentStatus]} dot>
				{statusLabels[qrZoomTicket.paymentStatus]}
			</Badge>
		</div>
	{/if}
</Modal>

<!-- Modal création événement admin -->
<Modal
	bind:open={createEventModalOpen}
	title="Créer un événement"
	description="Définis la jauge et les trois paliers tarifaires de l'événement."
	size="lg"
>
	<form id="create-event-form" onsubmit={handleCreateEvent} class="space-y-4">
		{#if createEventError}
			<div
				role="alert"
				class="rounded-[10px] border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:text-red-300"
			>
				{createEventError}
			</div>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1.5 sm:col-span-2">
				<label for="ev-title" class="block text-sm font-semibold text-ink">Titre</label>
				<input
					id="ev-title"
					type="text"
					bind:value={evTitle}
					required
					placeholder="Ex : Soirée d'hiver du lycée"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5 sm:col-span-2">
				<label for="ev-desc" class="block text-sm font-semibold text-ink">Description</label>
				<textarea
					id="ev-desc"
					rows={2}
					bind:value={evDescription}
					placeholder="Infos pratiques, dress code, animations..."
					class="w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none"
				></textarea>
			</div>

			<div class="space-y-1.5">
				<label for="ev-date" class="block text-sm font-semibold text-ink">Date & heure</label>
				<input
					id="ev-date"
					type="datetime-local"
					bind:value={evDate}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="ev-location" class="block text-sm font-semibold text-ink">Lieu</label>
				<input
					id="ev-location"
					type="text"
					bind:value={evLocation}
					required
					placeholder="Salle polyvalente / Gymnase"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="ev-cap" class="block text-sm font-semibold text-ink">Capacité max</label>
				<input
					id="ev-cap"
					type="number"
					min={1}
					max={5000}
					bind:value={evCapacity}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="ev-code" class="block text-sm font-semibold text-ink">
					Code d'accès (optionnel)
				</label>
				<input
					id="ev-code"
					type="text"
					bind:value={evAccessCode}
					placeholder="Laisser vide si ouvert"
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-3">
			<div class="space-y-1.5">
				<label for="ev-p-full" class="block text-sm font-semibold text-ink">Tarif plein (€)</label>
				<input
					id="ev-p-full"
					type="number"
					step="0.5"
					min="0"
					bind:value={evPriceFullEur}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="ev-p-red" class="block text-sm font-semibold text-ink">Tarif réduit (€)</label>
				<input
					id="ev-p-red"
					type="number"
					step="0.5"
					min="0"
					bind:value={evPriceReducedEur}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="ev-p-pre" class="block text-sm font-semibold text-ink">Prévente (€)</label>
				<input
					id="ev-p-pre"
					type="number"
					step="0.5"
					min="0"
					bind:value={evPricePresaleEur}
					required
					class="min-h-11 w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-base text-ink sm:text-sm focus:border-brand focus:outline-none"
				/>
			</div>
		</div>

		<label class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink">
			<input type="checkbox" bind:checked={evIsPublic} class="size-4 accent-brand" />
			Afficher publiquement sur la billetterie du lycée
		</label>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createEventModalOpen = false)}>Annuler</Button>
		<Button type="submit" form="create-event-form" variant="primary" loading={creatingEvent}>
			Publier l'événement
		</Button>
	{/snippet}
</Modal>
