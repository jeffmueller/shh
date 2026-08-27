import { createRateLimit } from "./config";

/**
 * In-process fixed-window rate limiter.
 *
 * State lives in this process only, which is fine for the single-node
 * deployment this app targets. It is a speed bump against brute force and
 * scripted abuse, not a distributed quota system — nginx's `limit_req` sits in
 * front of it for the coarse per-IP cap.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Requests allowed per window. `0` or less disables the limit. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  /** Requests left in the current window, for `X-RateLimit-Remaining`. */
  remaining: number;
}

const buckets = new Map<string, Bucket>();

const CLEANUP_MS = 5 * 60 * 1000;

/** Reveal attempts per IP+id. Tight: this is the brute-force path for
 * password-protected secrets. */
export const REVEAL_RULE: RateLimitRule = { limit: 10, windowMs: 5 * 60 * 1000 };

/** Creates per IP per hour. Operator-tunable via `SHH_CREATE_RATE_LIMIT`. */
export function createRule(): RateLimitRule {
  return { limit: createRateLimit(), windowMs: 60 * 60 * 1000 };
}

const UNLIMITED: RateLimitResult = { ok: true, retryAfterSec: 0, remaining: Infinity };

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now()
): RateLimitResult {
  if (rule.limit <= 0) return UNLIMITED;

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, retryAfterSec: 0, remaining: rule.limit - 1 };
  }
  if (bucket.count >= rule.limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      remaining: 0,
    };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0, remaining: rule.limit - bucket.count };
}

// Periodically clear old buckets to bound memory.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, CLEANUP_MS).unref?.();
}
