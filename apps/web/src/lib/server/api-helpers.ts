import { json } from '@sveltejs/kit';
import { decryptText } from './crypto';
import { checkRateLimit } from './rate-limit';

export async function enforceRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<Response | null> {
  const result = await checkRateLimit(key, maxRequests, windowMs);
  if (result.allowed) {
    return null;
  }

  return json(
    {
      error: 'Trop de tentatives. Veuillez réessayer plus tard.',
      retryAfterSeconds: result.retryAfterSeconds
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds)
      }
    }
  );
}

export function safeDecrypt(cipher: string | null | undefined, fallback = ''): string {
  if (!cipher) return fallback;
  try {
    return decryptText(cipher);
  } catch {
    return fallback;
  }
}
