import { error } from '@sveltejs/kit';
import type { z } from 'zod';

export function parsePositiveIntId(raw: string | undefined | null, label = 'Identifiant'): number {
  if (!raw || !/^\d+$/.test(raw)) {
    throw error(400, `${label} invalide.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw error(400, `${label} invalide.`);
  }
  return value;
}

export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw error(400, 'Corps JSON invalide ou malformé.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field = firstIssue?.path?.length ? `${firstIssue.path.join('.')}: ` : '';
    throw error(400, `${field}${firstIssue?.message || 'Données invalides.'}`);
  }
  return parsed.data as z.output<S>;
}

export function validateWithSchema<S extends z.ZodTypeAny>(
  data: unknown,
  schema: S
): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field = firstIssue?.path?.length ? `${firstIssue.path.join('.')}: ` : '';
    throw error(400, `${field}${firstIssue?.message || 'Données invalides.'}`);
  }
  return parsed.data as z.output<S>;
}

export function isPgErrorCode(err: unknown, code: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; cause?: unknown };
  if (record.code === code) return true;
  if (record.cause && typeof record.cause === 'object') {
    return (record.cause as { code?: unknown }).code === code;
  }
  return false;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  const safeName = sanitizeFilename(filename);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function createSseResponse(
  onConnect: (controller: ReadableStreamDefaultController<Uint8Array>) => () => void
): Response {
  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = onConnect(controller);
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
