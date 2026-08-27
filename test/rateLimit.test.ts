import test from "node:test";
import assert from "node:assert/strict";

import { REVEAL_RULE, checkRateLimit, createRule } from "@/lib/rateLimit";

// checkRateLimit accepts an explicit `now`, so windows can be exercised
// without waiting. Every test uses a unique key: buckets are module-level
// state shared across the file.
let counter = 0;
const uniqueKey = (label: string) => `${label}:${process.pid}:${counter++}`;

test("allows requests up to the limit, then blocks", () => {
  const key = uniqueKey("basic");
  const rule = { limit: 3, windowMs: 60_000 };

  for (let i = 1; i <= 3; i++) {
    assert.equal(checkRateLimit(key, rule, 1000).ok, true, `request ${i} should pass`);
  }
  assert.equal(checkRateLimit(key, rule, 1000).ok, false, "the 4th should be blocked");
});

test("reports how many requests remain", () => {
  const key = uniqueKey("remaining");
  const rule = { limit: 3, windowMs: 60_000 };

  assert.equal(checkRateLimit(key, rule, 1000).remaining, 2);
  assert.equal(checkRateLimit(key, rule, 1000).remaining, 1);
  assert.equal(checkRateLimit(key, rule, 1000).remaining, 0);
  assert.equal(checkRateLimit(key, rule, 1000).remaining, 0);
});

test("the window resets once it elapses", () => {
  const key = uniqueKey("window");
  const rule = { limit: 2, windowMs: 60_000 };

  assert.equal(checkRateLimit(key, rule, 1000).ok, true);
  assert.equal(checkRateLimit(key, rule, 1000).ok, true);
  assert.equal(checkRateLimit(key, rule, 1000).ok, false);

  // One millisecond before expiry: still blocked.
  assert.equal(checkRateLimit(key, rule, 60_999).ok, false);
  // At expiry: a fresh window.
  assert.equal(checkRateLimit(key, rule, 61_000).ok, true);
});

test("retryAfterSec counts down and never exceeds the window", () => {
  const key = uniqueKey("retry");
  const rule = { limit: 1, windowMs: 60_000 };

  checkRateLimit(key, rule, 1000);

  const immediately = checkRateLimit(key, rule, 1000);
  assert.equal(immediately.ok, false);
  assert.equal(immediately.retryAfterSec, 60);

  const later = checkRateLimit(key, rule, 31_000);
  assert.equal(later.retryAfterSec, 30);
  assert.ok(later.retryAfterSec > 0, "must never advise retrying immediately");
});

test("a successful request reports no retry delay", () => {
  const result = checkRateLimit(uniqueKey("ok"), { limit: 5, windowMs: 60_000 }, 1000);
  assert.equal(result.ok, true);
  assert.equal(result.retryAfterSec, 0);
});

test("distinct keys have independent buckets", () => {
  const rule = { limit: 1, windowMs: 60_000 };
  const a = uniqueKey("independent-a");
  const b = uniqueKey("independent-b");

  assert.equal(checkRateLimit(a, rule, 1000).ok, true);
  assert.equal(checkRateLimit(a, rule, 1000).ok, false);
  // Exhausting one client must not affect another.
  assert.equal(checkRateLimit(b, rule, 1000).ok, true);
});

test("a limit of zero or less disables the limiter", () => {
  for (const limit of [0, -1]) {
    const key = uniqueKey(`disabled-${limit}`);
    const rule = { limit, windowMs: 60_000 };
    for (let i = 0; i < 100; i++) {
      const result = checkRateLimit(key, rule, 1000);
      assert.equal(result.ok, true);
      assert.equal(result.remaining, Infinity);
    }
  }
});

test("the reveal rule matches the documented 10 per 5 minutes", () => {
  // PLUGIN_API.md and /api/v1/info both publish these numbers.
  assert.equal(REVEAL_RULE.limit, 10);
  assert.equal(REVEAL_RULE.windowMs, 5 * 60 * 1000);
});

test("the create rule reads its limit from the environment per call", () => {
  const saved = process.env.SHH_CREATE_RATE_LIMIT;
  try {
    delete process.env.SHH_CREATE_RATE_LIMIT;
    assert.equal(createRule().limit, 60, "documented default");
    assert.equal(createRule().windowMs, 60 * 60 * 1000);

    process.env.SHH_CREATE_RATE_LIMIT = "5";
    assert.equal(createRule().limit, 5, "must be read at call time, not cached at import");

    process.env.SHH_CREATE_RATE_LIMIT = "0";
    assert.equal(createRule().limit, 0, "0 disables the limit");

    process.env.SHH_CREATE_RATE_LIMIT = "banana";
    assert.equal(createRule().limit, 60, "unparseable falls back to the default");
  } finally {
    if (saved === undefined) delete process.env.SHH_CREATE_RATE_LIMIT;
    else process.env.SHH_CREATE_RATE_LIMIT = saved;
  }
});

test("exhausting the reveal rule takes exactly ten attempts", () => {
  // Mirrors the brute-force path: ten guesses against one secret, then 429.
  const key = uniqueKey("reveal-shape");
  for (let i = 1; i <= 10; i++) {
    assert.equal(checkRateLimit(key, REVEAL_RULE, 1000).ok, true, `guess ${i}`);
  }
  assert.equal(checkRateLimit(key, REVEAL_RULE, 1000).ok, false, "the 11th must be blocked");
});
