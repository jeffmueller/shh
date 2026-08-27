import { randomUUID } from "node:crypto";
import { getDb, type SecretRow } from "./db";
import { decrypt, encrypt, fromBase64Url, generateKey, toBase64Url } from "./crypto";
import { hashPassword, verifyPassword } from "./password";
import { isValidExpiry, resolveExpiry, type ExpiryValue } from "./expiry";
import { DEFAULT_EXPIRY } from "./config";
import { fail, type ApiFailure } from "./apiError";

/**
 * Secret lifecycle, independent of HTTP.
 *
 * Both the browser routes under `/api/secrets` and the plugin-facing
 * `/api/v1/secrets` routes call through here, so the two surfaces cannot drift
 * apart on validation, expiry handling, or burn-on-read semantics.
 */

export const MAX_PLAINTEXT_BYTES = 100 * 1024;
export const MAX_PASSWORD_LEN = 256;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deliberately identical for "never existed", "expired", "already burned", and
 * "wrong password" — an API client must not be able to distinguish them. */
const notFound = () => fail("not_found", "not found or expired", 404);

export type Ok<T> = { ok: true } & T;
export type Result<T> = Ok<T> | ApiFailure;

// ─── Create ──────────────────────────────────────────────────────────────

export interface CreateInput {
  plaintext?: unknown;
  expiry?: unknown;
  password?: unknown;
}

export interface CreatedSecret {
  id: string;
  /** base64url AES-256-GCM key. Never persisted; this is the only time it exists. */
  key: string;
  expiry: ExpiryValue;
  expiresAt: number | null;
  burnAfterRead: boolean;
  hasPassword: boolean;
}

export async function createSecret(input: CreateInput): Promise<Result<CreatedSecret>> {
  const { plaintext, password } = input;

  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return fail("plaintext_required", "plaintext required", 400);
  }
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) {
    return fail("plaintext_too_large", "secret exceeds 100 KB limit", 413);
  }

  // Omitting expiry is allowed and means "burn on first view" — the safest
  // default, and the one a one-liner from a plugin should get for free.
  const expiry = input.expiry === undefined || input.expiry === null ? DEFAULT_EXPIRY : input.expiry;
  if (!isValidExpiry(expiry)) {
    return fail("invalid_expiry", "invalid expiry", 400);
  }

  let passwordHash: string | null = null;
  if (password !== undefined && password !== null && password !== "") {
    if (typeof password !== "string" || password.length > MAX_PASSWORD_LEN) {
      return fail("invalid_password", "invalid password", 400);
    }
    passwordHash = await hashPassword(password);
  }

  const id = randomUUID();
  const key = generateKey();
  const { ciphertext, iv, authTag } = encrypt(plaintext, key);
  const { burnAfterRead, expiresAt } = resolveExpiry(expiry);
  const createdAt = Math.floor(Date.now() / 1000);

  const db = getDb();
  db.prepare(
    `INSERT INTO secrets (id, ciphertext, iv, auth_tag, password_hash, expires_at, burn_after_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, ciphertext, iv, authTag, passwordHash, expiresAt, burnAfterRead ? 1 : 0, createdAt);

  return {
    ok: true,
    id,
    key: toBase64Url(key),
    expiry,
    expiresAt,
    burnAfterRead,
    hasPassword: passwordHash !== null,
  };
}

// ─── Metadata ────────────────────────────────────────────────────────────

export interface SecretMeta {
  exists: boolean;
  hasPassword: boolean;
  burnAfterRead: boolean;
  expiresAt: number | null;
}

const MISSING: SecretMeta = {
  exists: false,
  hasPassword: false,
  burnAfterRead: false,
  expiresAt: null,
};

/**
 * Read metadata without consuming the secret — a burn-on-read row survives
 * this call. That is what lets a client prompt for a password before spending
 * its one and only view.
 */
export function getSecretMeta(id: string): SecretMeta {
  if (!UUID_RE.test(id)) return MISSING;

  const db = getDb();
  purgeIfExpired(id);

  const row = db
    .prepare("SELECT password_hash, expires_at, burn_after_read FROM secrets WHERE id = ?")
    .get(id) as
    | Pick<SecretRow, "password_hash" | "expires_at" | "burn_after_read">
    | undefined;

  if (!row) return MISSING;
  return {
    exists: true,
    hasPassword: row.password_hash !== null,
    burnAfterRead: row.burn_after_read === 1,
    expiresAt: row.expires_at,
  };
}

/** Opportunistic cleanup so an expired row is never read even if the
 * once-a-minute sweeper hasn't come around yet. */
function purgeIfExpired(id: string, now: number = Math.floor(Date.now() / 1000)): void {
  getDb()
    .prepare("DELETE FROM secrets WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?")
    .run(id, now);
}

// ─── Reveal ──────────────────────────────────────────────────────────────

export interface RevealedSecret {
  plaintext: string;
  /** True when this reveal destroyed the secret. */
  burned: boolean;
}

export async function revealSecret(
  id: string,
  key: unknown,
  password: unknown
): Promise<Result<RevealedSecret>> {
  if (!UUID_RE.test(id)) return notFound();
  if (typeof key !== "string" || key.length === 0) return notFound();

  const db = getDb();
  purgeIfExpired(id);

  const row = db.prepare("SELECT * FROM secrets WHERE id = ?").get(id) as SecretRow | undefined;
  if (!row) return notFound();

  if (row.password_hash) {
    if (typeof password !== "string" || password.length === 0) {
      // Distinct from a *wrong* password on purpose: the client needs to know
      // to prompt. Whether the password is correct stays a 404.
      return fail("password_required", "password required", 401);
    }
    if (!(await verifyPassword(password, row.password_hash))) return notFound();
  }

  let plaintext: string;
  try {
    plaintext = decrypt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
      fromBase64Url(key)
    );
  } catch {
    return notFound();
  }

  let burned = false;
  if (row.burn_after_read) {
    // Atomic: only the DELETE that actually removes the row may return the
    // plaintext, so two concurrent reveals can't both succeed.
    const del = db.prepare("DELETE FROM secrets WHERE id = ?").run(id);
    if (del.changes === 0) return notFound();
    burned = true;
  }

  return { ok: true, plaintext, burned };
}
