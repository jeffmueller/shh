import { NextResponse } from "next/server";

/**
 * Machine-readable failure shape shared by the internal browser routes and the
 * versioned `/api/v1` surface.
 *
 * `code` is the stable field: API clients branch on it, and it never changes
 * wording between releases. `message` is prose for humans reading a terminal
 * and may be reworded at any time.
 */
export interface ApiFailure {
  ok: false;
  code: ApiErrorCode;
  message: string;
  status: number;
  /** Extra headers the failure requires, e.g. `Retry-After` on a 429. */
  headers?: Record<string, string>;
}

export type ApiErrorCode =
  | "invalid_json"
  | "plaintext_required"
  | "plaintext_too_large"
  | "invalid_expiry"
  | "invalid_password"
  | "not_found"
  | "password_required"
  | "rate_limited"
  | "unauthorized";

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  headers?: Record<string, string>
): ApiFailure {
  return { ok: false, code, message, status, headers };
}

/**
 * Render a failure as JSON.
 *
 * `error` stays a plain string so the existing browser components — which read
 * `data.error` — keep working unchanged; `code` is the addition for API clients.
 */
export function errorResponse(f: ApiFailure): NextResponse {
  return NextResponse.json(
    { error: f.message, code: f.code },
    { status: f.status, headers: f.headers }
  );
}
