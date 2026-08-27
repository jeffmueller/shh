import test from "node:test";
import assert from "node:assert/strict";

import { EXPIRY_OPTIONS, isValidExpiry, resolveExpiry } from "@/lib/expiry";

test("accepts exactly the published option values", () => {
  // /api/v1/info publishes this list and clients build their UI from it, so
  // the validator and the catalogue must not drift apart.
  for (const option of EXPIRY_OPTIONS) {
    assert.equal(isValidExpiry(option.value), true, `${option.value} should be valid`);
  }
});

test("rejects anything not in the list", () => {
  for (const value of ["", "99y", "1H", " 1h", "first-view", 3600, null, undefined, {}, []]) {
    assert.equal(isValidExpiry(value), false, `${JSON.stringify(value)} should be invalid`);
  }
});

test("first_view burns and never expires on a clock", () => {
  const resolved = resolveExpiry("first_view", 1_000_000);
  assert.deepEqual(resolved, { burnAfterRead: true, expiresAt: null });
});

test("timed options offset from the supplied clock and do not burn", () => {
  const now = 1_000_000;
  for (const option of EXPIRY_OPTIONS) {
    if (option.seconds === null) continue;
    assert.deepEqual(
      resolveExpiry(option.value, now),
      { burnAfterRead: false, expiresAt: now + option.seconds },
      `${option.value} resolved incorrectly`
    );
  }
});

test("option metadata is well formed", () => {
  const values = EXPIRY_OPTIONS.map((o) => o.value);
  assert.equal(new Set(values).size, values.length, "duplicate expiry values");

  for (const option of EXPIRY_OPTIONS) {
    assert.ok(option.label.length > 0, `${option.value} has no label`);
    assert.ok(
      option.seconds === null || option.seconds > 0,
      `${option.value} has a non-positive duration`
    );
  }

  // Exactly one burn-on-read option, and it is the documented default.
  const burning = EXPIRY_OPTIONS.filter((o) => o.seconds === null);
  assert.equal(burning.length, 1);
  assert.equal(burning[0].value, "first_view");
});
