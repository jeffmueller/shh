// Redirects lib/db at a scratch database. node:test gives each file its own
// process, so this suite gets a private one. The assertion below is what
// actually protects ./data/secrets.db — see the helper for why.
import { SCRATCH_DB_PATH, assertUsingScratchDb, removeScratchDb } from "./helpers/scratchDb";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createSecret, getSecretMeta, revealSecret, MAX_PLAINTEXT_BYTES } from "@/lib/secrets";
import { getDb } from "@/lib/db";

const DB_PATH = SCRATCH_DB_PATH;

test("connected to the scratch database, not the real one", () => {
  // Runs first, and every other test in this file writes rows — so if this
  // ever fails, stop before polluting a real database.
  assertUsingScratchDb(getDb().name);
});

test.after(removeScratchDb);

async function created(overrides: Record<string, unknown> = {}) {
  const result = await createSecret({ plaintext: "hunter2", expiry: "first_view", ...overrides });
  assert.ok(result.ok, "expected creation to succeed");
  return result;
}

// ─── The central claim ───────────────────────────────────────────────────

test("the database stores neither plaintext nor the decryption key", async () => {
  // This is the whole threat model: a stolen database must be inert. If this
  // test ever fails, "DB-only compromise recovers nothing" is false.
  const plaintext = "correct-horse-battery-staple-UNIQUE-MARKER-9f3a";
  const secret = await created({ plaintext, expiry: "1w" });

  getDb().pragma("wal_checkpoint(TRUNCATE)");

  const onDisk = Buffer.concat(
    ["", "-wal"]
      .map((s) => DB_PATH + s)
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p))
  );

  assert.equal(onDisk.includes(Buffer.from(plaintext, "utf8")), false, "plaintext found on disk");
  assert.equal(
    onDisk.includes(Buffer.from(secret.key, "utf8")),
    false,
    "base64url key found on disk"
  );
  assert.equal(
    onDisk.includes(Buffer.from(secret.key.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    false,
    "raw key bytes found on disk"
  );
});

test("the stored row holds ciphertext and no password in the clear", async () => {
  const secret = await created({ plaintext: "hunter2", password: "s3cret", expiry: "1w" });
  const row = getDb().prepare("SELECT * FROM secrets WHERE id = ?").get(secret.id) as Record<
    string,
    unknown
  >;

  assert.ok(row, "row should exist");
  assert.equal(Object.keys(row).includes("plaintext"), false);
  assert.notEqual(row.ciphertext?.toString(), "hunter2");
  // bcrypt hash, not the password itself.
  assert.match(String(row.password_hash), /^\$2[aby]\$/);
  assert.equal(String(row.password_hash).includes("s3cret"), false);
});

// ─── Burn on read ────────────────────────────────────────────────────────

test("a first_view secret reveals once and is then gone", async () => {
  const secret = await created({ plaintext: "burn me" });

  const first = await revealSecret(secret.id, secret.key, undefined);
  assert.ok(first.ok);
  assert.equal(first.plaintext, "burn me");
  assert.equal(first.burned, true);

  const second = await revealSecret(secret.id, secret.key, undefined);
  assert.equal(second.ok, false);
  assert.equal(getSecretMeta(secret.id).exists, false);
});

test("concurrent reveals of one burn-on-read secret: exactly one wins", async () => {
  // The password check awaits bcrypt, which yields the event loop between the
  // row lookup and the delete. Both callers can therefore see the row; only
  // the DELETE that actually removes it may return plaintext.
  const secret = await created({ plaintext: "only once", password: "pw" });

  const results = await Promise.all(
    Array.from({ length: 8 }, () => revealSecret(secret.id, secret.key, "pw"))
  );

  const winners = results.filter((r) => r.ok);
  assert.equal(winners.length, 1, `expected exactly 1 winner, got ${winners.length}`);
  assert.equal(winners[0].ok && winners[0].plaintext, "only once");
  assert.equal(getSecretMeta(secret.id).exists, false);
});

test("a timed secret survives repeated reveals", async () => {
  const secret = await created({ plaintext: "reusable", expiry: "1h" });
  for (let i = 0; i < 3; i++) {
    const result = await revealSecret(secret.id, secret.key, undefined);
    assert.ok(result.ok);
    assert.equal(result.plaintext, "reusable");
    assert.equal(result.burned, false);
  }
  assert.equal(getSecretMeta(secret.id).exists, true);
});

// ─── Failed attempts must not consume the secret ─────────────────────────

test("a wrong key fails without burning the secret", async () => {
  const secret = await created({ plaintext: "safe" });
  const wrongKey = (await created({ plaintext: "other" })).key;

  const bad = await revealSecret(secret.id, wrongKey, undefined);
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.code, "not_found");
  assert.equal(getSecretMeta(secret.id).exists, true, "a failed decrypt must not burn");

  const good = await revealSecret(secret.id, secret.key, undefined);
  assert.ok(good.ok);
});

test("a wrong password fails without burning the secret", async () => {
  const secret = await created({ plaintext: "safe", password: "right" });

  for (let i = 0; i < 3; i++) {
    const bad = await revealSecret(secret.id, secret.key, "wrong");
    assert.equal(bad.ok, false);
    assert.equal(bad.ok === false && bad.code, "not_found");
  }
  assert.equal(getSecretMeta(secret.id).exists, true);

  const good = await revealSecret(secret.id, secret.key, "right");
  assert.ok(good.ok);
});

test("wrong password and missing secret are indistinguishable", async () => {
  // Otherwise the response confirms that a given id exists.
  const secret = await created({ plaintext: "x", password: "right" });
  const wrongPassword = await revealSecret(secret.id, secret.key, "wrong");
  const noSuchSecret = await revealSecret(
    "00000000-0000-4000-8000-000000000000",
    secret.key,
    "anything"
  );

  assert.equal(wrongPassword.ok, false);
  assert.equal(noSuchSecret.ok, false);
  if (wrongPassword.ok === false && noSuchSecret.ok === false) {
    assert.equal(wrongPassword.code, noSuchSecret.code);
    assert.equal(wrongPassword.status, noSuchSecret.status);
    assert.equal(wrongPassword.message, noSuchSecret.message);
  }
});

test("a missing password is reported distinctly so a client can prompt", async () => {
  const secret = await created({ plaintext: "x", password: "pw" });
  for (const attempt of [undefined, "", null]) {
    const result = await revealSecret(secret.id, secret.key, attempt);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "password_required");
    assert.equal(result.ok === false && result.status, 401);
  }
  assert.equal(getSecretMeta(secret.id).exists, true);
});

test("a malformed id never reaches the database", async () => {
  for (const id of ["", "not-a-uuid", "../../etc/passwd", "' OR 1=1 --"]) {
    const result = await revealSecret(id, "key", undefined);
    assert.equal(result.ok, false);
    assert.equal(getSecretMeta(id).exists, false);
  }
});

// ─── Metadata ────────────────────────────────────────────────────────────

test("reading metadata does not consume a burn-on-read secret", async () => {
  const secret = await created({ plaintext: "intact", password: "pw" });

  for (let i = 0; i < 5; i++) {
    const meta = getSecretMeta(secret.id);
    assert.equal(meta.exists, true);
    assert.equal(meta.hasPassword, true);
    assert.equal(meta.burnAfterRead, true);
    assert.equal(meta.expiresAt, null);
  }

  const result = await revealSecret(secret.id, secret.key, "pw");
  assert.ok(result.ok, "the secret should still have been revealable");
});

test("metadata for an unknown id reports absence without leaking detail", () => {
  const meta = getSecretMeta("00000000-0000-4000-8000-000000000000");
  assert.deepEqual(meta, {
    exists: false,
    hasPassword: false,
    burnAfterRead: false,
    expiresAt: null,
  });
});

// ─── Expiry ──────────────────────────────────────────────────────────────

test("an expired secret is unreadable and purged on access", async () => {
  const secret = await created({ plaintext: "stale", expiry: "1h" });

  // Backdate it rather than waiting an hour.
  getDb()
    .prepare("UPDATE secrets SET expires_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000) - 60, secret.id);

  const result = await revealSecret(secret.id, secret.key, undefined);
  assert.equal(result.ok, false);
  assert.equal(getSecretMeta(secret.id).exists, false);

  const row = getDb().prepare("SELECT id FROM secrets WHERE id = ?").get(secret.id);
  assert.equal(row, undefined, "the expired row should have been deleted");
});

test("expiry values map to the documented lifetimes", async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases: Array<[string, number | null]> = [
    ["first_view", null],
    ["1h", 3600],
    ["6h", 21600],
    ["12h", 43200],
    ["1d", 86400],
    ["1w", 604800],
  ];

  for (const [expiry, seconds] of cases) {
    const secret = await created({ plaintext: "x", expiry });
    assert.equal(secret.expiry, expiry);
    if (seconds === null) {
      assert.equal(secret.expiresAt, null);
      assert.equal(secret.burnAfterRead, true);
    } else {
      assert.equal(secret.burnAfterRead, false);
      assert.ok(
        Math.abs((secret.expiresAt ?? 0) - (now + seconds)) <= 5,
        `${expiry} resolved to an unexpected timestamp`
      );
    }
  }
});

test("omitting expiry defaults to burn-on-read, the safest option", async () => {
  const result = await createSecret({ plaintext: "x" });
  assert.ok(result.ok);
  assert.equal(result.expiry, "first_view");
  assert.equal(result.burnAfterRead, true);
});

// ─── Input validation ────────────────────────────────────────────────────

test("rejects missing or empty plaintext", async () => {
  for (const plaintext of [undefined, null, "", 42, {}, []]) {
    const result = await createSecret({ plaintext });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "plaintext_required");
  }
});

test("enforces the size ceiling on bytes, not characters", async () => {
  const atLimit = "a".repeat(MAX_PLAINTEXT_BYTES);
  assert.equal((await createSecret({ plaintext: atLimit })).ok, true);

  const overByOne = await createSecret({ plaintext: "a".repeat(MAX_PLAINTEXT_BYTES + 1) });
  assert.equal(overByOne.ok, false);
  assert.equal(overByOne.ok === false && overByOne.status, 413);

  // A multi-byte string under the character count but over the byte count.
  const multibyte = await createSecret({ plaintext: "🔐".repeat(MAX_PLAINTEXT_BYTES / 2) });
  assert.equal(multibyte.ok, false, "byte length should govern, not string length");
});

test("rejects unknown expiry values", async () => {
  for (const expiry of ["99y", "forever", "", 3600, {}]) {
    const result = await createSecret({ plaintext: "x", expiry });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "invalid_expiry");
  }
});

test("rejects an over-long or non-string password", async () => {
  for (const password of ["p".repeat(257), 12345, {}]) {
    const result = await createSecret({ plaintext: "x", password });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "invalid_password");
  }
});

test("treats an absent password as no password at all", async () => {
  for (const password of [undefined, null, ""]) {
    const result = await createSecret({ plaintext: "x", password, expiry: "1h" });
    assert.ok(result.ok);
    assert.equal(result.hasPassword, false);
    assert.equal(getSecretMeta(result.id).hasPassword, false);
  }
});

test("ids and keys are unique across creations", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => created({ plaintext: "x", expiry: "1h" }))
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 50);
  assert.equal(new Set(results.map((r) => r.key)).size, 50);
});
