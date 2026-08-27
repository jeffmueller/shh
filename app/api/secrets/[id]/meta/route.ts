import { NextRequest, NextResponse } from "next/server";
import { getSecretMeta } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing metadata endpoint, used by `components/RevealView.tsx` to
 * decide whether to show the password field before burning the secret.
 *
 * Returns only `{ exists, hasPassword }`; `/api/v1/secrets/{id}` exposes the
 * expiry details as well.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = getSecretMeta(id);
  if (!meta.exists) return NextResponse.json({ exists: false });
  return NextResponse.json({ exists: true, hasPassword: meta.hasPassword });
}
