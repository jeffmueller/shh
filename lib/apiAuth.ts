import { createHash, timingSafeEqual } from "node:crypto";
import { fail, type ApiFailure } from "./apiError";

/**
 * Optional bearer-token auth for the `/api/v1` surface.
 *
 * Unset `SHH_API_TOKENS` and the API is as open as the web form already is,
 * which is the right default for a LAN-only instance. Set it to one or more
 * tokens and every `/api/v1` route except `/api/v1/info` demands
 * `Authorization: Bearer <token>`.
 *
 * The browser routes under `/api/secrets` are deliberately NOT gated: the web
 * UI has nowhere to hide a token, and gating them would only break the app.
 * An operator who wants the whole instance private should put auth in front of
 * it (nginx basic auth, Tailscale, a VPN) rather than rely on this.
 */

function parseTokens(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function configuredTokens(): string[] {
  return parseTokens(process.env.SHH_API_TOKENS || "");
}

export function authRequired(): boolean {
  return configuredTokens().length > 0;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/**
 * Compare against every configured token without early-exit, so response time
 * doesn't leak how many tokens are set or how far down the list a match sat.
 * Hashing first gives both sides a fixed 32 bytes, which `timingSafeEqual`
 * requires (it throws on length mismatch).
 */
function tokenMatches(presented: string, tokens: string[]): boolean {
  const presentedDigest = digest(presented);
  let matched = false;
  for (const token of tokens) {
    if (timingSafeEqual(presentedDigest, digest(token))) matched = true;
  }
  return matched;
}

function bearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

const UNAUTHORIZED_HEADERS = { "WWW-Authenticate": 'Bearer realm="shh"' };

/**
 * Returns `null` when the request may proceed, or the failure to render.
 */
export function checkApiAuth(headers: Headers): ApiFailure | null {
  const tokens = configuredTokens();
  if (tokens.length === 0) return null;

  const presented = bearerToken(headers);
  if (!presented) {
    return fail(
      "unauthorized",
      "this instance requires an API token; send Authorization: Bearer <token>",
      401,
      UNAUTHORIZED_HEADERS
    );
  }
  if (!tokenMatches(presented, tokens)) {
    return fail("unauthorized", "invalid API token", 401, UNAUTHORIZED_HEADERS);
  }
  return null;
}
