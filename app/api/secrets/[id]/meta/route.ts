import { NextRequest, NextResponse } from "next/server";
import { getDb, type SecretRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ exists: false }, { status: 200 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  // Opportunistic cleanup of expired rows.
  db.prepare("DELETE FROM secrets WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?").run(id, now);

  const row = db
    .prepare("SELECT password_hash FROM secrets WHERE id = ?")
    .get(id) as Pick<SecretRow, "password_hash"> | undefined;

  if (!row) return NextResponse.json({ exists: false }, { status: 200 });
  return NextResponse.json({ exists: true, hasPassword: row.password_hash !== null }, { status: 200 });
}
