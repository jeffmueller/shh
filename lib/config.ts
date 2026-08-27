import { EXPIRY_OPTIONS, type ExpiryValue } from "./expiry";

/**
 * Runtime configuration for self-hosted instances.
 *
 * Everything here is read from `process.env` on each call rather than captured
 * at module load, so an operator can change a value in the systemd
 * EnvironmentFile and restart the service without rebuilding the bundle.
 */

/** Default expiry applied when an API client omits the field. */
export const DEFAULT_EXPIRY: ExpiryValue = "first_view";

/**
 * Read an environment variable at request time.
 *
 * Next.js inlines literal `process.env.NEXT_PUBLIC_*` member expressions as
 * build-time string constants, which would freeze a self-hoster's base URL to
 * whatever was in `.env` when the bundle was built — editing it on the server
 * would then silently do nothing. The indexed access below is opaque to that
 * transform, so the value is genuinely read from the live environment.
 */
function runtimeEnv(name: string): string {
  return (process.env as Record<string, string | undefined>)[name] || "";
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function normalizeOrigin(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimTrailingSlash(url.origin + url.pathname);
  } catch {
    return null;
  }
}

/**
 * The public origin of this instance, used to build shareable `/s/<id>#<key>`
 * URLs for API clients that have no browser `window.location` to read.
 *
 * Resolution order:
 *  1. `SHH_BASE_URL`
 *  2. `NEXT_PUBLIC_BASE_URL` — legacy alias, kept for existing deployments.
 *  3. The request's forwarded proto/host — correct behind the bundled nginx config,
 *     which sets `X-Forwarded-Proto` and `Host` on every `/api` proxy_pass.
 *
 * Both variables are read through `runtimeEnv`, so an operator can change either
 * one in the systemd EnvironmentFile and restart without rebuilding.
 *
 * The header fallback trusts client-controlled values, but the resolved URL is
 * only ever echoed back to that same caller — it is never persisted or emailed —
 * so a spoofed Host poisons nothing but the spoofer's own response. Operators
 * who care should still set `SHH_BASE_URL`.
 */
export function publicBaseUrl(headers?: Headers): string {
  const configured =
    normalizeOrigin(runtimeEnv("SHH_BASE_URL")) ??
    normalizeOrigin(runtimeEnv("NEXT_PUBLIC_BASE_URL"));
  if (configured) return configured;

  if (headers) {
    const host = headers.get("x-forwarded-host") || headers.get("host");
    if (host) {
      const proto = (headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
      const derived = normalizeOrigin(`${proto}://${host}`);
      if (derived) return derived;
    }
  }

  return "http://localhost:3000";
}

/**
 * Human-readable instance name, surfaced by `/api/v1/info` so a client
 * configured with this server address can label it. Falls back to the host, so
 * it is never empty — pass the request headers to get the host the caller
 * actually reached rather than a configured or default one.
 */
export function instanceName(headers?: Headers): string {
  const name = runtimeEnv("SHH_INSTANCE_NAME").trim();
  return name || new URL(publicBaseUrl(headers)).host;
}

function positiveInt(raw: string, fallback: number): number {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Creates allowed per IP per hour. `0` disables the limit entirely, which is
 * reasonable on a LAN-only instance behind a trusted network.
 */
export function createRateLimit(): number {
  return positiveInt(runtimeEnv("SHH_CREATE_RATE_LIMIT"), 60);
}

/** Expiry catalogue in the shape `/api/v1/info` publishes it. */
export function expiryCatalogue() {
  return EXPIRY_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    seconds: o.seconds,
  }));
}
