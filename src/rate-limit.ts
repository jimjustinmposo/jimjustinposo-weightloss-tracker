import type { Ctx } from './types';

/* ============================================================
   rate-limit.ts — best-effort brute-force / abuse throttle.

   Deliberately dependency-free and storage-free: counters live in the
   isolate's memory, so the happy path costs no D1 write and no added
   latency. Cloudflare spreads traffic over many isolates, so treat this as
   a deterrent (it stops sustained brute force cheaply) rather than a hard
   quota. Counters reset themselves when the window expires.
   ============================================================ */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

function clientKey(c: Ctx, scope: string): string {
  const ip =
    c.req.header('cf-connecting-ip') ||
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown';
  return `${scope}:${ip}`;
}

/**
 * Counts one hit for `scope` + client IP. Returns a ready 429 response (with
 * Retry-After) once `limit` hits happened inside `windowMs`, otherwise null.
 */
export function rateLimited(c: Ctx, scope: string, limit: number, windowMs: number): Response | null {
  const now = Date.now();

  // Keep the map bounded — drop expired buckets, hard-reset if still huge.
  if (buckets.size > MAX_BUCKETS) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }

  const id = clientKey(c, scope);
  let bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(id, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return c.json({ error: `Too many attempts. Please wait ${retryAfter}s and try again.` }, 429, {
    'Retry-After': String(retryAfter),
  });
}