<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import {
		getPendingOfflineScans,
		isQrAlreadyScannedOffline,
		markScansSynced,
		recordOfflineScan,
		type OfflineScanRecord
	} from '$lib/offline-scanner';
	import { toast } from '$lib/stores/toast.svelte';
	import { isWasmAvailable, verifyTicketOfflineWasm } from '$lib/wasm-client';
	import { formatDateTimeFr } from '$shared/format';
	import { hasPermission } from '$shared/permissions';
	import type { PageData } from './$types';

	const PUBLIC_KEY_STORAGE = 'mdl-ticket-public-key-hex';
	const QR_TEXT_MAP_STORAGE = 'mdl-offline-scan-qrtexts';

	interface ScanFeedback {
		tone: 'success' | 'warning' | 'danger';
		title: string;
		detail: string;
		qrCodeId?: string;
		buyerName?: string;
		buyerClasse?: string;
		tier?: string;
		mode: 'online' | 'offline';
		timestamp: string;
	}

	let { data }: { data: PageData } = $props();

	const canScan = $derived(data.user ? hasPermission(data.user.role, 'tickets:scan') : false);

	let isOnline = $state(true);
	let publicKeyHex = $state('');
	let keySource = $state<'network' | 'cache' | 'missing'>('missing');
	let wasmReady = $state(false);

	// Caméra + jsQR dynamique
	let videoEl = $state<HTMLVideoElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let cameraActive = $state(false);
	let cameraStarting = $state(false);
	let cameraError = $state('');
	let mediaStream: MediaStream | null = null;
	let rafId: number | null = null;
	let lastFrameProcessedAt = 0;
	let lastQrText = '';
	let lastQrTimestamp = 0;

	// Fallback saisie manuelle / test QR
	let manualQr = $state('');
	let processingScan = $state(false);

	// File d'attente hors-ligne
	let pendingScans = $state<OfflineScanRecord[]>([]);
	let syncing = $state(false);
	let lastFeedback = $state<ScanFeedback | null>(null);
	let recentLogs = $state<ScanFeedback[]>([]);

	function readQrTextMap(): Record<string, string> {
		try {
			const raw = window.localStorage.getItem(QR_TEXT_MAP_STORAGE);
			if (!raw) return {};
			return JSON.parse(raw) as Record<string, string>;
		} catch {
			return {};
		}
	}

	function saveQrTextForSync(qrCodeId: string, qrText: string) {
		try {
			const map = readQrTextMap();
			map[qrCodeId] = qrText;
			window.localStorage.setItem(QR_TEXT_MAP_STORAGE, JSON.stringify(map));
		} catch {
			// Ignorer si quota plein
		}
	}

	function removeQrTextsForSynced(qrCodeIds: string[]) {
		try {
			const map = readQrTextMap();
			for (const id of qrCodeIds) {
				delete map[id];
			}
			window.localStorage.setItem(QR_TEXT_MAP_STORAGE, JSON.stringify(map));
		} catch {
			// Ignorer
		}
	}

	async function loadPublicKeyAndQueue() {
		try {
			wasmReady = await isWasmAvailable();
		} catch {
			wasmReady = false;
		}

		try {
			const cachedKey = window.localStorage.getItem(PUBLIC_KEY_STORAGE);
			if (cachedKey) {
				publicKeyHex = cachedKey;
				keySource = 'cache';
			}
		} catch {
			// Ignorer
		}

		try {
			pendingScans = await getPendingOfflineScans();
		} catch {
			pendingScans = [];
		}

		if (navigator.onLine) {
			try {
				const res = await fetch('/api/health');
				const payload = (await res.json().catch(() => ({}))) as {
					ticketPublicKeyHex?: string;
				};
				if (res.ok && payload.ticketPublicKeyHex) {
					publicKeyHex = payload.ticketPublicKeyHex;
					keySource = 'network';
					try {
						window.localStorage.setItem(PUBLIC_KEY_STORAGE, payload.ticketPublicKeyHex);
					} catch {
						// Ignorer
					}
				}
			} catch {
				// Garder la clé en cache si réseau indisponible
			}
		}
	}

	onMount(() => {
		isOnline = navigator.onLine;
		loadPublicKeyAndQueue();

		const handleOnline = () => {
			isOnline = true;
			loadPublicKeyAndQueue();
			syncPendingScans();
		};
		const handleOffline = () => {
			isOnline = false;
		};

		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			stopCamera();
		};
	});

	function pushFeedback(fb: ScanFeedback) {
		lastFeedback = fb;
		recentLogs = [fb, ...recentLogs].slice(0, 20);
	}

	async function processQrCode(rawText: string) {
		const qrText = rawText.trim();
		if (!qrText || processingScan) return;

		if (!publicKeyHex) {
			toast.error(
				'Clé Ed25519 absente',
				'Connecte-toi au moins une fois au réseau pour mettre en cache la clé publique du lycée.'
			);
			return;
		}

		processingScan = true;
		const nowIso = new Date().toISOString();

		try {
			// 1. Vérification cryptographique Ed25519 hors-ligne via Rust/WASM
			const verification = await verifyTicketOfflineWasm(qrText, publicKeyHex);
			if (!verification.valid || !verification.payload) {
				pushFeedback({
					tone: 'danger',
					title: 'Billet invalide ou falsifié',
					detail: verification.error || 'Signature Ed25519 rejetée.',
					mode: isOnline ? 'online' : 'offline',
					timestamp: nowIso
				});
				return;
			}

			const { qrid, eid, tid, tier } = verification.payload;

			// 2. Anti-double-scan local IndexedDB
			const alreadySeenLocally = await isQrAlreadyScannedOffline(qrid).catch(() => false);
			if (alreadySeenLocally) {
				pushFeedback({
					tone: 'warning',
					title: 'Déjà scanné sur cet appareil',
					detail: `Le billet ${qrid} (tarif ${tier}) a déjà été validé localement.`,
					qrCodeId: qrid,
					tier,
					mode: isOnline ? 'online' : 'offline',
					timestamp: nowIso
				});
				return;
			}

			// 3. Si en ligne : validation serveur immédiate
			if (navigator.onLine) {
				try {
					const res = await fetch('/api/tickets/scan', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ qrText, scannedAt: nowIso })
					});

					const payload = (await res.json().catch(() => ({}))) as {
						ok?: boolean;
						status?: string;
						error?: string;
						message?: string;
						ticket?: {
							qrCodeId: string;
							buyerName: string;
							buyerClasse: string;
							tier: string;
						};
					};

					if (res.status === 401 || res.status === 403) {
						pushFeedback({
							tone: 'danger',
							title: 'Session expirée ou accès refusé',
							detail: payload.error || payload.message || 'Reconnecte-toi pour valider les scans sur le serveur.',
							qrCodeId: qrid,
							tier,
							mode: 'online',
							timestamp: nowIso
						});
						return;
					}

					if (res.ok) {
						if (payload.ok) {
							await recordOfflineScan({
								qrCodeId: qrid,
								eventId: eid,
								ticketId: tid,
								scannedAt: nowIso,
								synced: true
							}).catch(() => undefined);

							pushFeedback({
								tone: 'success',
								title: 'Entrée autorisée',
								detail: payload.message || `Billet ${qrid} validé.`,
								qrCodeId: qrid,
								buyerName: payload.ticket?.buyerName,
								buyerClasse: payload.ticket?.buyerClasse,
								tier: payload.ticket?.tier || tier,
								mode: 'online',
								timestamp: nowIso
							});
							return;
						}

						pushFeedback({
							tone: payload.status === 'already_scanned' ? 'warning' : 'danger',
							title:
								payload.status === 'already_scanned'
									? 'Billet déjà scanné'
									: 'Billet refusé',
							detail: payload.message || 'Contrôle serveur négatif.',
							qrCodeId: qrid,
							buyerName: payload.ticket?.buyerName,
							buyerClasse: payload.ticket?.buyerClasse,
							tier: payload.ticket?.tier || tier,
							mode: 'online',
							timestamp: nowIso
						});
						return;
					}
				} catch {
					// Bascule transparente vers la file hors-ligne si requête échoue
					isOnline = false;
				}
			}

			// 4. Mode hors-ligne : enregistrer dans IndexedDB pour synchronisation ultérieure
			await recordOfflineScan({
				qrCodeId: qrid,
				eventId: eid,
				ticketId: tid,
				scannedAt: nowIso,
				synced: false
			});
			saveQrTextForSync(qrid, qrText);
			pendingScans = await getPendingOfflineScans();

			pushFeedback({
				tone: 'success',
				title: 'Validé hors-ligne (Ed25519 OK)',
				detail: `Billet ${qrid} (tarif ${tier}) authentifié hors connexion et mis en file de synchronisation.`,
				qrCodeId: qrid,
				tier,
				mode: 'offline',
				timestamp: nowIso
			});
		} finally {
			processingScan = false;
		}
	}

	async function startCamera() {
		if (cameraActive || cameraStarting) return;
		cameraError = '';

		if (!navigator.mediaDevices?.getUserMedia) {
			cameraError =
				'Accès caméra indisponible sur ce navigateur. Utilise le champ manuel ci-dessous.';
			return;
		}

		cameraStarting = true;
		try {
			// Import dynamique de jsQR uniquement sur la page scanner
			const [{ default: jsQR }, stream] = await Promise.all([
				import('jsqr'),
				navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: 'environment' } },
					audio: false
				})
			]);

			mediaStream = stream;
			cameraActive = true;

			// Attendre que videoEl soit monté
			await new Promise((r) => setTimeout(r, 30));
			if (!videoEl) {
				stopCamera();
				return;
			}

			videoEl.srcObject = stream;
			await videoEl.play();

			const scanTick = (now: number) => {
				if (!cameraActive || !videoEl || !canvasEl) return;

				if (
					videoEl.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA &&
					now - lastFrameProcessedAt >= 90
				) {
					lastFrameProcessedAt = now;
					const w = videoEl.videoWidth;
					const h = videoEl.videoHeight;
					if (w > 0 && h > 0) {
						canvasEl.width = w;
						canvasEl.height = h;
						const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
						if (ctx) {
							ctx.drawImage(videoEl, 0, 0, w, h);
							const imageData = ctx.getImageData(0, 0, w, h);
							const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
								inversionAttempts: 'dontInvert'
							});

							if (decoded?.data) {
								const code = decoded.data.trim();
								if (code !== lastQrText || now - lastQrTimestamp > 2200) {
									lastQrText = code;
									lastQrTimestamp = now;
									void processQrCode(code);
								}
							}
						}
					}
				}

				rafId = window.requestAnimationFrame(scanTick);
			};

			rafId = window.requestAnimationFrame(scanTick);
		} catch (err) {
			stopCamera();
			cameraError =
				err instanceof Error
					? `Caméra inaccessible (${err.message}). Utilise la saisie manuelle.`
					: 'Impossible d’ouvrir la caméra. Vérifie les autorisations.';
		} finally {
			cameraStarting = false;
		}
	}

	function stopCamera() {
		cameraActive = false;
		if (rafId !== null) {
			window.cancelAnimationFrame(rafId);
			rafId = null;
		}
		if (mediaStream) {
			for (const track of mediaStream.getTracks()) {
				track.stop();
			}
			mediaStream = null;
		}
		if (videoEl) {
			videoEl.srcObject = null;
		}
	}

	async function handleManualSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!manualQr.trim()) return;
		await processQrCode(manualQr);
		manualQr = '';
	}

	async function syncPendingScans() {
		if (syncing || pendingScans.length === 0 || !navigator.onLine) return;
		syncing = true;
		try {
			const qrMap = readQrTextMap();
			const toSend: Array<{ qrText: string; scannedAt: string; qrCodeId: string }> = [];
			const orphanIds: string[] = [];

			for (const rec of pendingScans) {
				const qrText = qrMap[rec.qrCodeId];
				if (qrText) {
					toSend.push({ qrText, scannedAt: rec.scannedAt, qrCodeId: rec.qrCodeId });
				} else {
					orphanIds.push(rec.qrCodeId);
				}
			}

			if (orphanIds.length > 0) {
				await markScansSynced(orphanIds);
			}

			if (toSend.length === 0) {
				pendingScans = await getPendingOfflineScans();
				return;
			}

			const res = await fetch('/api/tickets/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scans: toSend.map((item) => ({ qrText: item.qrText, scannedAt: item.scannedAt }))
				})
			});

			const payload = (await res.json().catch(() => ({}))) as {
				total?: number;
				validCount?: number;
				rejectedCount?: number;
				error?: string;
				message?: string;
			};

			if (!res.ok) {
				toast.error('Synchronisation échouée', payload.error || payload.message || 'Réessaie dans un instant.');
				return;
			}

			const syncedIds = toSend.map((s) => s.qrCodeId);
			await markScansSynced(syncedIds);
			removeQrTextsForSynced(syncedIds);
			pendingScans = await getPendingOfflineScans();

			toast.success(
				'Synchronisation terminée',
				`${payload.validCount ?? 0} billet(s) validé(s), ${payload.rejectedCount ?? 0} déjà scanné(s) ou rejeté(s).`
			);
		} catch {
			toast.error('Réseau indisponible', 'La file reste sauvegardée en IndexedDB.');
		} finally {
			syncing = false;
		}
	}
</script>

<svelte:head>
	<title>Scanner billets · {data.settings.mdlName}</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-5 px-4 pt-5 sm:px-6 sm:pt-7">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<a
				href="/billetterie"
				class="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline text-brand-ink"
			>
				← Retour billetterie
			</a>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight text-ink">
				Scanner d'entrée PWA
			</h1>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Badge variant={isOnline ? 'success' : 'warning'} dot>
				{isOnline ? 'En ligne' : 'Mode hors-ligne'}
			</Badge>
			<Badge variant={wasmReady ? 'success' : 'neutral'}>
				{wasmReady ? 'WASM Ed25519 prêt' : 'WASM en chargement'}
			</Badge>
			<Badge variant={publicKeyHex ? 'brand' : 'danger'}>
				{publicKeyHex
					? keySource === 'network'
						? 'Clé Ed25519 à jour'
						: 'Clé Ed25519 en cache'
					: 'Clé Ed25519 absente'}
			</Badge>
		</div>
	</header>

	{#if !data.user}
		<Card padding="lg" class="text-center space-y-4">
			<h2 class="text-lg font-bold text-ink">Authentification requise</h2>
			<p class="text-sm text-muted">
				Connecte-toi avec un compte membre du bureau habilité à scanner les billets.
			</p>
			<Button href="/connexion?redirect=/billetterie/scanner" variant="primary">
				Se connecter
			</Button>
		</Card>
	{:else if !canScan}
		<Card padding="lg" class="text-center space-y-2">
			<h2 class="text-lg font-bold text-ink">Permission scanner requise</h2>
			<p class="text-sm text-muted">
				Seuls les membres du bureau (président, trésorier, secrétaire, bureau) peuvent contrôler les entrées.
			</p>
		</Card>
	{:else}
		<!-- Barre de synchronisation hors-ligne -->
		{#if pendingScans.length > 0}
			<Card padding="sm" class="flex flex-wrap items-center justify-between gap-3 border-amber-500/35 bg-amber-500/10">
				<div class="text-sm">
					<span class="font-bold text-ink">{pendingScans.length}</span>
					<span class="text-muted">
						scan(s) en attente de synchronisation serveur
					</span>
				</div>
				<Button
					size="sm"
					variant="primary"
					loading={syncing}
					disabled={!isOnline}
					onclick={syncPendingScans}
				>
					{isOnline ? 'Synchroniser maintenant' : 'En attente de réseau'}
				</Button>
			</Card>
		{/if}

		<!-- Résultat du dernier scan -->
		{#if lastFeedback}
			<div
				role="status"
				aria-live="assertive"
				class={`animate-spring rounded-2xl border-2 p-4 shadow-sm ${
					lastFeedback.tone === 'success'
						? 'border-emerald-500 bg-emerald-500/12 text-emerald-950 dark:text-emerald-100'
						: lastFeedback.tone === 'warning'
							? 'border-amber-500 bg-amber-500/12 text-amber-950 dark:text-amber-100'
							: 'border-red-500 bg-red-500/12 text-red-950 dark:text-red-100'
				}`}
			>
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div>
						<p class="text-lg font-semibold">{lastFeedback.title}</p>
						<p class="mt-0.5 text-sm">{lastFeedback.detail}</p>
						{#if lastFeedback.buyerName}
							<p class="mt-1.5 text-sm font-semibold">
								{lastFeedback.buyerName}
								{#if lastFeedback.buyerClasse}· {lastFeedback.buyerClasse}{/if}
								{#if lastFeedback.tier}· tarif {lastFeedback.tier}{/if}
							</p>
						{/if}
					</div>
					<Badge variant={lastFeedback.mode === 'online' ? 'brand' : 'warning'}>
						{lastFeedback.mode === 'online' ? 'Serveur' : 'Hors-ligne WASM'}
					</Badge>
				</div>
			</div>
		{/if}

		<!-- Caméra mobile-first -->
		<Card class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="text-base font-bold text-ink">Caméra QR</h2>
					<p class="text-xs text-muted">
						Vérification cryptographique Ed25519 locale instantanée (WASM / WebCrypto).
					</p>
				</div>
				{#if cameraActive}
					<Button size="sm" variant="danger" onclick={stopCamera}>Arrêter caméra</Button>
				{:else}
					<Button size="sm" variant="primary" loading={cameraStarting} onclick={startCamera}>
						Activer la caméra
					</Button>
				{/if}
			</div>

			{#if cameraError}
				<div
					role="alert"
					class="rounded-[10px] border border-amber-500/35 bg-amber-500/10 p-3 text-xs font-medium text-amber-900 dark:text-amber-200"
				>
					{cameraError}
				</div>
			{/if}

			<div class="relative overflow-hidden rounded-2xl border border-border bg-slate-950 aspect-[4/3] flex items-center justify-center">
				<video
					bind:this={videoEl}
					playsinline
					muted
					class={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
				></video>
				<canvas bind:this={canvasEl} class="hidden"></canvas>

				{#if cameraActive}
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-8 rounded-2xl border-2 border-dashed border-white/75 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]"
					></div>
				{:else}
					<div class="p-6 text-center text-slate-300 space-y-2">
						<p class="text-sm font-semibold">Caméra en veille</p>
						<p class="text-xs text-slate-400">
							Appuie sur « Activer la caméra » pour scanner les billets à l'entrée.
						</p>
					</div>
				{/if}
			</div>
		</Card>

		<!-- Saisie manuelle / Test QR en fallback -->
		<Card class="space-y-3">
			<h2 class="text-base font-bold text-ink">Saisie manuelle ou collage QR</h2>
			<form onsubmit={handleManualSubmit} class="flex flex-col gap-2.5 sm:flex-row">
				<label for="manual-qr-input" class="sr-only">Chaîne QR MDL1</label>
				<input
					id="manual-qr-input"
					type="text"
					bind:value={manualQr}
					placeholder="MDL1.<payload>.<signature>"
					class="min-h-11 flex-1 rounded-[10px] border border-border bg-surface px-3.5 py-2 font-mono text-xs text-ink focus:border-brand focus:outline-none"
				/>
				<Button
					type="submit"
					variant="secondary"
					loading={processingScan}
					disabled={!manualQr.trim()}
				>
					Vérifier ce QR
				</Button>
			</form>
		</Card>

		<!-- Journal des scans récents -->
		{#if recentLogs.length > 0}
			<Card class="space-y-3">
				<h2 class="text-base font-bold text-ink">Derniers contrôles ({recentLogs.length})</h2>
				<ul class="divide-y divide-border/70 text-sm">
					{#each recentLogs as item, idx (`${item.timestamp}-${idx}`)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2.5">
							<div class="min-w-0">
								<p class="font-semibold text-ink">
									{item.title}
									{#if item.qrCodeId}· <span class="font-mono text-xs">{item.qrCodeId}</span>{/if}
								</p>
								<p class="text-xs text-muted">{item.detail}</p>
							</div>
							<span class="text-xs text-muted">{formatDateTimeFr(item.timestamp)}</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>
