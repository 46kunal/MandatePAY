/**
 * Per-person limits on the routes that cost money or send things out (AI calls, PayPal refunds, reports).
 * In memory, so each server instance counts for itself: it stops a runaway script or a stuck retry loop, it is not
 * a defence against a determined attacker (sign-in has its own database-backed limit in Better Auth).
 */
import { apiError } from './http';

const hits = new Map<string, number[]>();

/** true when this call is allowed. Pure apart from the shared map; `now` is injectable for tests. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

/** A 429 response when the person is over the limit, else null. */
export function limited(userId: string, bucket: string, max: number, windowMs = 60_000): Response | null {
  if (allow(`${bucket}:${userId}`, max, windowMs)) return null;
  const res = apiError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.');
  res.headers.set('retry-after', String(Math.ceil(windowMs / 1000)));
  return res;
}

export function resetLimits() {
  hits.clear();
}
