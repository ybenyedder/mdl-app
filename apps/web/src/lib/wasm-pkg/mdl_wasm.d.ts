/* tslint:disable */
/* eslint-disable */

/**
 * Compress a PNG, JPEG, or WebP receipt image into a JPEG byte buffer.
 *
 * Resizes preserving aspect ratio when width > `max_width`, composites any
 * alpha channel over white, and encodes as JPEG with `quality` clamped to `30..=95`.
 */
export function compress_receipt_image(bytes: Uint8Array, max_width: number, quality: number): Uint8Array;

/**
 * Compute budget totals, balance, and breakdowns by category and project from a JSON array.
 */
export function compute_budget_summary(entries_json: string): string;

/**
 * Compute budget summary directly from a JS value using `serde-wasm-bindgen`.
 */
export function compute_budget_summary_js(entries: any): any;

/**
 * Export tabular data to an RFC 4180 CSV string with UTF-8 BOM and `;` separator for French Excel.
 */
export function export_rows_to_csv(headers_json: string, rows_json: string): string;

/**
 * Parse and verify an offline QR ticket (`MDL1.<payload_b64url>.<sig_b64url>`).
 *
 * Returns the decoded UTF-8 JSON payload on success, or a descriptive French error.
 */
export function parse_and_verify_ticket_qr(qr_text: string, public_key_hex: string): string;

/**
 * Verify an Ed25519 signature over the ASCII bytes of `payload_b64url`.
 *
 * `public_key_hex` must encode 32 bytes in hexadecimal, and `signature_b64url`
 * must encode 64 bytes in unpadded base64url.
 */
export function verify_ticket_ed25519(payload_b64url: string, signature_b64url: string, public_key_hex: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compress_receipt_image: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly compute_budget_summary: (a: number, b: number) => [number, number, number, number];
    readonly compute_budget_summary_js: (a: any) => [number, number, number];
    readonly export_rows_to_csv: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly parse_and_verify_ticket_qr: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly verify_ticket_ed25519: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
