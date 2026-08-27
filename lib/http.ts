import type { NextRequest } from "next/server";
import { fail, type ApiFailure } from "./apiError";
import { clientIpHeader, trustedProxyHops } from "./config";

/**
 * Client IP for rate-limit keying.
 *
 * `X-Forwarded-For` is a list that grows left-to-right: each proxy *appends*
 * the address it saw. A client can therefore pre-seed the header, and nginx's
 * `$proxy_add_x_forwarded_for` will happily forward `<spoofed>, <real>`. Taking
 * the leftmost entry — the obvious reading — hands an attacker a fresh
 * rate-limit bucket per request, which defeats the reveal brute-force limit
 * entirely.
 *
 * So count from the right instead: with `hops` trusted proxies in front, entry
 * `length - hops` is the last one an attacker could not have written. One
 * reverse proxy (the default) means the rightmost entry.
 *
 * In Docker the socket address is usually the bridge gateway for every client,
 * so forwarded headers are the only usable identity — getting `hops` right is
 * what makes the limits real.
 */
export function clientIp(req: NextRequest): string {
  const hops = trustedProxyHops();

  // No proxy declared: forwarded headers are unauthenticated, so ignore them.
  // Everything shares one bucket, which throttles rather than lets abuse
  // through. Only appropriate when the app isn't publicly reachable.
  if (hops <= 0) return "unproxied";

  // A single-value header written by a trusted edge (CF-Connecting-IP,
  // True-Client-IP). Not a list, so there is nothing to count back through.
  const override = clientIpHeader();
  if (override) {
    const value = req.headers.get(override);
    if (value) {
      const first = value.split(",")[0].trim();
      if (first) return first;
    }
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      // Clamp: a request with fewer entries than declared hops is malformed or
      // came in past the proxy. Falling back to index 0 keeps it deterministic.
      return parts[Math.max(0, parts.length - hops)];
    }
  }

  // nginx sets this from $remote_addr, so unlike XFF it is a single value the
  // client cannot influence.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

/**
 * Parse a JSON request body, requiring the caller to say that is what it is.
 *
 * `req.json()` will happily parse a body sent as `text/plain`, and an HTML
 * form can send exactly that cross-origin — forms cannot set
 * `application/json`, which is what makes this check a CSRF barrier rather
 * than mere pedantry.
 *
 * The reveal route is not exploitable that way (burning requires the
 * decryption key, which an attacker holding it would not need CSRF for), but
 * create is: a malicious page could spend a visitor's rate limit and fill
 * their database. Cheap to close, so close it.
 */
export async function parseJsonBody(req: NextRequest): Promise<{ body: unknown } | ApiFailure> {
  const contentType = req.headers.get("content-type") || "";
  // Ignore parameters such as "; charset=utf-8".
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return fail(
      "unsupported_media_type",
      "Content-Type must be application/json",
      415
    );
  }

  try {
    return { body: await req.json() };
  } catch {
    return fail("invalid_json", "invalid json", 400);
  }
}

export function isFailure(v: unknown): v is ApiFailure {
  return typeof v === "object" && v !== null && (v as ApiFailure).ok === false;
}
