import type { NextRequest } from "next/server";
import { fail, type ApiFailure } from "./apiError";

/**
 * Client IP for rate-limit keying.
 *
 * `X-Forwarded-For` is set by the bundled nginx config on every proxied route.
 * Direct exposure of the Node process to the internet would make this header
 * spoofable — run it behind the provided reverse proxy.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function parseJsonBody(req: NextRequest): Promise<{ body: unknown } | ApiFailure> {
  try {
    return { body: await req.json() };
  } catch {
    return fail("invalid_json", "invalid json", 400);
  }
}

export function isFailure(v: unknown): v is ApiFailure {
  return typeof v === "object" && v !== null && (v as ApiFailure).ok === false;
}
