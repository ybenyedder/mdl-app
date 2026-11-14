export interface CompressedReceiptResult {
	bytes: Uint8Array;
	mimeType: string;
	originalSize: number;
	compressedSize: number;
}

export interface BudgetEntryInput {
	type: string;
	category: string;
	amountCents: number;
	projectId?: number | null;
	project?: string | null;
}

export interface GroupSummary {
	name: string;
	incomeCents: number;
	expenseCents: number;
	balanceCents: number;
	income: number;
	expense: number;
	balance: number;
	count: number;
}

export interface BudgetSummary {
	totalIncomeCents: number;
	totalExpenseCents: number;
	balanceCents: number;
	totalIncome: number;
	totalExpense: number;
	balance: number;
	entryCount: number;
	byCategory: GroupSummary[];
	byProject: GroupSummary[];
}

export interface TicketQrPayload {
	tid: number;
	eid: number;
	qrid: string;
	tier: string;
	iat: number;
}

export interface TicketVerificationResult {
	valid: boolean;
	payload?: TicketQrPayload;
	error?: string;
}

type WasmPkg = typeof import('./wasm-pkg/mdl_wasm.js');

interface LoadedWasm {
	pkg: WasmPkg;
}

let wasmInitPromise: Promise<LoadedWasm | null> | null = null;

/**
 * Lazily imports and initializes the Rust/WASM package once per session.
 * Returns `null` when running in SSR or if WebAssembly is blocked (e.g. strict CSP).
 */
async function getWasmModule(): Promise<LoadedWasm | null> {
	if (typeof window === 'undefined' || typeof WebAssembly === 'undefined') {
		return null;
	}

	if (!wasmInitPromise) {
		wasmInitPromise = (async () => {
			try {
				const pkg = await import('./wasm-pkg/mdl_wasm.js');
				await pkg.default();
				return { pkg };
			} catch (err) {
				console.warn('[mdl-wasm] Initialisation WASM indisponible, bascule JS/Canvas:', err);
				return null;
			}
		})();
	}

	return wasmInitPromise;
}

/**
 * Checks whether the client-side WASM runtime initialized successfully.
 */
export async function isWasmAvailable(): Promise<boolean> {
	return (await getWasmModule()) !== null;
}

function clampQuality(quality: number): number {
	if (!Number.isFinite(quality)) return 82;
	return Math.min(95, Math.max(30, Math.round(quality)));
}

function clampMaxWidth(maxWidth: number): number {
	if (!Number.isFinite(maxWidth) || maxWidth <= 0) return 1600;
	return Math.max(1, Math.round(maxWidth));
}

async function decodeImageSource(
	blob: Blob
): Promise<{
	width: number;
	height: number;
	draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => void;
	cleanup: () => void;
}> {
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(blob);
		return {
			width: bitmap.width,
			height: bitmap.height,
			draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
			cleanup: () => bitmap.close()
		};
	}

	const objectUrl = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error("Impossible de décoder l'image via HTMLImageElement"));
			el.src = objectUrl;
		});

		return {
			width: img.naturalWidth || img.width,
			height: img.naturalHeight || img.height,
			draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
			cleanup: () => URL.revokeObjectURL(objectUrl)
		};
	} catch (err) {
		URL.revokeObjectURL(objectUrl);
		throw err;
	}
}

async function compressViaCanvasFallback(
	file: File | Blob,
	maxWidth: number,
	quality: number
): Promise<Uint8Array> {
	if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
		throw new Error('Compression image impossible hors navigateur');
	}

	const source = await decodeImageSource(file);
	try {
		const srcW = Math.max(1, source.width);
		const srcH = Math.max(1, source.height);
		const targetW = srcW > maxWidth ? maxWidth : srcW;
		const targetH = srcW > maxWidth ? Math.max(1, Math.round((srcH * maxWidth) / srcW)) : srcH;
		const jpegQuality = clampQuality(quality) / 100;

		if (typeof OffscreenCanvas !== 'undefined') {
			const offscreen = new OffscreenCanvas(targetW, targetH);
			const ctx = offscreen.getContext('2d');
			if (ctx && typeof offscreen.convertToBlob === 'function') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, targetW, targetH);
				source.draw(ctx, targetW, targetH);
				const outBlob = await offscreen.convertToBlob({
					type: 'image/jpeg',
					quality: jpegQuality
				});
				return new Uint8Array(await outBlob.arrayBuffer());
			}
		}

		const canvas = document.createElement('canvas');
		canvas.width = targetW;
		canvas.height = targetH;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Contexte Canvas 2D indisponible pour la compression');
		}

		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, targetW, targetH);
		source.draw(ctx, targetW, targetH);

		const outBlob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob) resolve(blob);
					else reject(new Error('Échec encodage Canvas JPEG'));
				},
				'image/jpeg',
				jpegQuality
			);
		});

		return new Uint8Array(await outBlob.arrayBuffer());
	} finally {
		source.cleanup();
	}
}

/**
 * Compresses a receipt image (PNG/JPEG/WebP, or browser-decodable image via Canvas fallback)
 * into a resized JPEG byte buffer on the client before upload.
 */
export async function compressReceiptImageClient(
	file: File | Blob,
	maxWidth = 1600,
	quality = 82
): Promise<CompressedReceiptResult> {
	const safeMaxWidth = clampMaxWidth(maxWidth);
	const safeQuality = clampQuality(quality);
	const inputBuffer = await file.arrayBuffer();
	const inputBytes = new Uint8Array(inputBuffer);
	const originalSize = inputBytes.byteLength;

	if (originalSize === 0) {
		throw new Error('Le fichier image est vide');
	}

	const wasm = await getWasmModule();
	if (wasm) {
		try {
			const compressed = wasm.pkg.compress_receipt_image(inputBytes, safeMaxWidth, safeQuality);
			return {
				bytes: compressed,
				mimeType: 'image/jpeg',
				originalSize,
				compressedSize: compressed.byteLength
			};
		} catch (err) {
			console.warn('[mdl-wasm] Échec compression WASM, bascule Canvas JPEG:', err);
		}
	}

	const fallbackBytes = await compressViaCanvasFallback(file, safeMaxWidth, safeQuality);
	return {
		bytes: fallbackBytes,
		mimeType: 'image/jpeg',
		originalSize,
		compressedSize: fallbackBytes.byteLength
	};
}

function normalizeEntryForWasm(entry: BudgetEntryInput): {
	type: string;
	category: string;
	amountCents: number;
	project: string | null;
} {
	const trimmedProject = entry.project?.trim();
	const projectLabel =
		trimmedProject && trimmedProject.length > 0
			? trimmedProject
			: entry.projectId != null
				? `Projet #${entry.projectId}`
				: null;

	return {
		type: entry.type,
		category: entry.category,
		amountCents: Math.trunc(entry.amountCents),
		project: projectLabel
	};
}

function parseEntryKindFallback(rawType: string): 'income' | 'expense' {
	const normalized = rawType.trim().toLowerCase();
	if (
		normalized === 'income' ||
		normalized === 'recette' ||
		normalized === 'recettes' ||
		normalized === 'credit' ||
		normalized === 'crédit'
	) {
		return 'income';
	}
	if (
		normalized === 'expense' ||
		normalized === 'depense' ||
		normalized === 'dépense' ||
		normalized === 'depenses' ||
		normalized === 'dépenses' ||
		normalized === 'debit' ||
		normalized === 'débit'
	) {
		return 'expense';
	}
	throw new Error(`Type d'écriture inconnu: '${normalized}'`);
}

function computeBudgetSummaryFallback(entries: BudgetEntryInput[]): BudgetSummary {
	let totalIncomeCents = 0;
	let totalExpenseCents = 0;

	const categoryMap = new Map<string, { incomeCents: number; expenseCents: number; count: number }>();
	const projectMap = new Map<string, { incomeCents: number; expenseCents: number; count: number }>();

	for (const entry of entries) {
		const kind = parseEntryKindFallback(entry.type);
		const cents = Math.trunc(entry.amountCents);
		if (!Number.isFinite(cents) || cents < 0) {
			throw new Error('Le montant en centimes ne peut pas être négatif');
		}

		const category = entry.category?.trim() || 'Sans catégorie';
		const project =
			entry.project?.trim() ||
			(entry.projectId != null ? `Projet #${entry.projectId}` : 'Hors projet');

		const catAcc = categoryMap.get(category) ?? { incomeCents: 0, expenseCents: 0, count: 0 };
		const projAcc = projectMap.get(project) ?? { incomeCents: 0, expenseCents: 0, count: 0 };

		if (kind === 'income') {
			totalIncomeCents += cents;
			catAcc.incomeCents += cents;
			projAcc.incomeCents += cents;
		} else {
			totalExpenseCents += cents;
			catAcc.expenseCents += cents;
			projAcc.expenseCents += cents;
		}

		catAcc.count += 1;
		projAcc.count += 1;
		categoryMap.set(category, catAcc);
		projectMap.set(project, projAcc);
	}

	const finalize = (
		map: Map<string, { incomeCents: number; expenseCents: number; count: number }>
	): GroupSummary[] =>
		Array.from(map.entries())
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([name, acc]) => {
				const balanceCents = acc.incomeCents - acc.expenseCents;
				return {
					name,
					incomeCents: acc.incomeCents,
					expenseCents: acc.expenseCents,
					balanceCents,
					income: acc.incomeCents / 100,
					expense: acc.expenseCents / 100,
					balance: balanceCents / 100,
					count: acc.count
				};
			});

	const balanceCents = totalIncomeCents - totalExpenseCents;

	return {
		totalIncomeCents,
		totalExpenseCents,
		balanceCents,
		totalIncome: totalIncomeCents / 100,
		totalExpense: totalExpenseCents / 100,
		balance: balanceCents / 100,
		entryCount: entries.length,
		byCategory: finalize(categoryMap),
		byProject: finalize(projectMap)
	};
}

/**
 * Computes budget totals, balance, and category/project breakdowns using WASM
 * with an identical TypeScript fallback if WASM is unavailable.
 */
export async function computeBudgetSummaryWasm(
	entries: Array<BudgetEntryInput>
): Promise<BudgetSummary> {
	const wasm = await getWasmModule();
	if (wasm) {
		try {
			const payload = JSON.stringify(entries.map(normalizeEntryForWasm));
			const json = wasm.pkg.compute_budget_summary(payload);
			return JSON.parse(json) as BudgetSummary;
		} catch (err) {
			console.warn('[mdl-wasm] Échec computeBudgetSummaryWasm, bascule JS:', err);
		}
	}

	return computeBudgetSummaryFallback(entries);
}

function escapeCsvFieldFallback(value: string): string {
	const needsQuoting =
		value.includes(';') || value.includes('"') || value.includes('\n') || value.includes('\r');
	if (!needsQuoting) {
		return value;
	}
	return `"${value.replace(/"/g, '""')}"`;
}

function exportCsvFallback(headers: string[], rows: string[][]): string {
	const lines: string[] = [];
	if (headers.length > 0) {
		lines.push(headers.map((h) => escapeCsvFieldFallback(String(h ?? ''))).join(';'));
	}
	for (const row of rows) {
		lines.push(row.map((cell) => escapeCsvFieldFallback(String(cell ?? ''))).join(';'));
	}
	return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Exports headers and rows into an RFC 4180 CSV string with UTF-8 BOM and `;` separator
 * (compatible with French Excel), powered by WASM with a pure-TS fallback.
 */
export async function exportCsvWasm(headers: string[], rows: string[][]): Promise<string> {
	const wasm = await getWasmModule();
	if (wasm) {
		try {
			return wasm.pkg.export_rows_to_csv(JSON.stringify(headers), JSON.stringify(rows));
		} catch (err) {
			console.warn('[mdl-wasm] Échec exportCsvWasm, bascule JS:', err);
		}
	}

	return exportCsvFallback(headers, rows);
}

function decodeHexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
	const clean = hex.trim();
	if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
		return null;
	}
	const buffer = new ArrayBuffer(clean.length / 2);
	const out = new Uint8Array(buffer);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function decodeBase64UrlNoPad(input: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]+$/.test(input)) {
		return null;
	}
	const padLen = (4 - (input.length % 4)) % 4;
	if (padLen === 3) {
		return null;
	}
	const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
	let binary: string;
	try {
		binary = atob(base64);
	} catch {
		return null;
	}
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function parseTicketPayloadJson(jsonText: string): TicketQrPayload | null {
	try {
		const raw: unknown = JSON.parse(jsonText);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return null;
		}
		const candidate = raw as Record<string, unknown>;
		if (
			typeof candidate.tid !== 'number' ||
			!Number.isFinite(candidate.tid) ||
			typeof candidate.eid !== 'number' ||
			!Number.isFinite(candidate.eid) ||
			typeof candidate.qrid !== 'string' ||
			typeof candidate.tier !== 'string' ||
			typeof candidate.iat !== 'number' ||
			!Number.isFinite(candidate.iat)
		) {
			return null;
		}
		return {
			tid: candidate.tid,
			eid: candidate.eid,
			qrid: candidate.qrid,
			tier: candidate.tier,
			iat: candidate.iat
		};
	} catch {
		return null;
	}
}

async function verifyTicketViaWebCryptoFallback(
	qrText: string,
	publicKeyHex: string
): Promise<TicketVerificationResult> {
	const parts = qrText.trim().split('.');
	if (parts.length !== 3 || parts[0] !== 'MDL1' || !parts[1] || !parts[2]) {
		return {
			valid: false,
			error: 'Format QR billet invalide : format attendu MDL1.<payload>.<signature>'
		};
	}

	const [, payloadB64Url, sigB64Url] = parts;
	const pkBytes = decodeHexToBytes(publicKeyHex);
	if (!pkBytes || pkBytes.byteLength !== 32) {
		return {
			valid: false,
			error: 'Clé publique Ed25519 invalide : exactement 32 octets hexadécimaux requis'
		};
	}

	const sigBytes = decodeBase64UrlNoPad(sigB64Url);
	if (!sigBytes || sigBytes.byteLength !== 64) {
		return {
			valid: false,
			error: 'Signature Ed25519 invalide : 64 octets base64url attendus'
		};
	}

	if (typeof globalThis.crypto?.subtle === 'undefined') {
		return {
			valid: false,
			error: 'Vérification Ed25519 indisponible (WASM et WebCrypto absents)'
		};
	}

	try {
		const cryptoKey = await globalThis.crypto.subtle.importKey(
			'raw',
			pkBytes,
			'Ed25519',
			false,
			['verify']
		);
		const messageBytes = new TextEncoder().encode(payloadB64Url);
		const isValid = await globalThis.crypto.subtle.verify(
			'Ed25519',
			cryptoKey,
			sigBytes,
			messageBytes
		);

		if (!isValid) {
			return {
				valid: false,
				error: 'Signature Ed25519 invalide ou billet falsifié'
			};
		}

		const payloadBytes = decodeBase64UrlNoPad(payloadB64Url);
		if (!payloadBytes) {
			return {
				valid: false,
				error: 'Payload base64url du billet corrompu'
			};
		}

		const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
		const payload = parseTicketPayloadJson(jsonText);
		if (!payload) {
			return {
				valid: false,
				error: 'Payload du billet invalide : structure JSON attendue (tid, eid, qrid, tier, iat)'
			};
		}

		return { valid: true, payload };
	} catch (err) {
		return {
			valid: false,
			error:
				err instanceof Error
					? `Échec vérification WebCrypto Ed25519 : ${err.message}`
					: 'Échec vérification WebCrypto Ed25519'
		};
	}
}

/**
 * Verifies an offline signed ticket QR (`MDL1.<payload_b64url>.<sig_b64url>`)
 * using Rust/WASM Ed25519 verification with a WebCrypto `SubtleCrypto.verify('Ed25519', ...)` fallback.
 */
export async function verifyTicketOfflineWasm(
	qrText: string,
	publicKeyHex: string
): Promise<{
	valid: boolean;
	payload?: { tid: number; eid: number; qrid: string; tier: string; iat: number };
	error?: string;
}> {
	const wasm = await getWasmModule();
	if (wasm && typeof wasm.pkg.parse_and_verify_ticket_qr === 'function') {
		try {
			const verifiedJson = wasm.pkg.parse_and_verify_ticket_qr(qrText, publicKeyHex);
			const payload = parseTicketPayloadJson(verifiedJson);
			if (!payload) {
				return {
					valid: false,
					error:
						'Payload du billet invalide : structure JSON attendue (tid, eid, qrid, tier, iat)'
				};
			}
			return { valid: true, payload };
		} catch (err) {
			if (err instanceof WebAssembly.RuntimeError) {
				console.warn('[mdl-wasm] Erreur runtime WASM Ed25519, bascule WebCrypto:', err);
			} else {
				const message =
					typeof err === 'string'
						? err
						: err instanceof Error
							? err.message
							: 'Billet invalide ou signature Ed25519 rejetée';
				return { valid: false, error: message };
			}
		}
	}

	return verifyTicketViaWebCryptoFallback(qrText, publicKeyHex);
}
