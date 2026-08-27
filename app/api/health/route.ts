import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for container orchestrators and NAS dashboards.
 *
 * Touches SQLite rather than just returning 200, because the interesting
 * failure for this app is a data volume that isn't mounted or isn't writable —
 * the process starts fine and only fails when someone tries to store a secret.
 *
 * Unauthenticated and deliberately terse: it must work before a token is
 * configured, and it should leak nothing about the instance.
 */
export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
  } catch {
    return NextResponse.json({ status: "error", db: "unavailable" }, { status: 503 });
  }
  return NextResponse.json({ status: "ok" });
}
