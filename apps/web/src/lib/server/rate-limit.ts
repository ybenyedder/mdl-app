import { eq } from 'drizzle-orm';
import { db } from './db';
import { rateLimits } from './db/schema';

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const now = Date.now();
  const [existing] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: 1, resetAt }
      });
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000)
    };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }

  const nextCount = existing.count + 1;
  await db
    .update(rateLimits)
    .set({ count: nextCount })
    .where(eq(rateLimits.key, key));

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - nextCount),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  };
}
