import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/apiAuth";
import { errorResponse } from "@/lib/apiError";
import { getSecretMeta } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metadata for a secret. Non-destructive: a burn-on-read secret survives this
 * call, which is what lets a client prompt for a password before spending the
 * single view.
 *
 * Always 200, even for an unknown id — `exists: false` covers "never existed",
 * "expired", and "already burned" without distinguishing them.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = checkApiAuth(req.headers);
  if (authFailure) return errorResponse(authFailure);

  const { id } = await ctx.params;
  const meta = getSecretMeta(id);

  if (!meta.exists) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    hasPassword: meta.hasPassword,
    burnAfterRead: meta.burnAfterRead,
    expiresAt: meta.expiresAt,
    expiresAtIso: meta.expiresAt === null ? null : new Date(meta.expiresAt * 1000).toISOString(),
  });
}
