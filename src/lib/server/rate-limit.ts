/**
 * Minimal sliding-window rate limiter. In-memory and per server instance —
 * enough to stop a runaway client or a script hammering the demo, not a
 * distributed quota. Production: move to the platform's edge rate limiting or Redis.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterS: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, retryAfterS: 0 };
}

export function clientKey(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** True if `key` already has `limit` hits inside the window (doesn't add one). */
export function isLimited(key: string, limit: number, windowMs: number): { limited: boolean; retryAfterS: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  buckets.set(key, hits);
  return hits.length >= limit ? { limited: true, retryAfterS: Math.ceil((windowMs - (now - hits[0])) / 1000) } : { limited: false, retryAfterS: 0 };
}

/** Add one hit to `key` (e.g. a failed sign-in). */
export function recordHit(key: string) {
  const hits = buckets.get(key) ?? [];
  hits.push(Date.now());
  buckets.set(key, hits);
}

export function clearHits(key: string) {
  buckets.delete(key);
}

/** Tests only. */
export function resetRateLimitsForTests() {
  buckets.clear();
}
