import { NextRequest, NextResponse } from "next/server";
import { getDb, type SecretRow } from "@/lib/db";
import { decrypt, fromBase64Url } from "@/lib/crypto";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = { error: "not found or expired" } as const;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

  const ip = clientIp(req);
  const rl = checkRateLimit(`${ip}:${id}`);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { key, password } = (body || {}) as { key?: unknown; password?: unknown };
  if (typeof key !== "string" || key.length === 0) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM secrets WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?").run(id, now);

  const row = db.prepare("SELECT * FROM secrets WHERE id = ?").get(id) as SecretRow | undefined;
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });

  if (row.password_hash) {
    if (typeof password !== "string" || password.length === 0) {
      return NextResponse.json({ error: "password required" }, { status: 401 });
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  let plaintext: string;
  try {
    const keyBuf = fromBase64Url(key);
    plaintext = decrypt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
      keyBuf
    );
  } catch {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  if (row.burn_after_read) {
    // Atomic delete: only succeeds if the row still exists. Race-safe between concurrent reveals.
    const del = db.prepare("DELETE FROM secrets WHERE id = ?").run(id);
    if (del.changes === 0) return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  return NextResponse.json({ plaintext }, { status: 200 });
}
