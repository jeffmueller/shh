import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/apiAuth";
import { errorResponse, fail } from "@/lib/apiError";
import { clientIp, isFailure, parseJsonBody } from "@/lib/http";
import { REVEAL_RULE, checkRateLimit } from "@/lib/rateLimit";
import { revealSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Decrypt and return a secret. Destructive for burn-on-read secrets — there is
 * no second chance, so a client should have whatever it needs (the password)
 * before calling.
 *
 * The rate limit is keyed on IP+id and shares its bucket with the browser
 * reveal route, so an attacker can't double their password guesses by
 * alternating between the two surfaces.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = checkApiAuth(req.headers);
  if (authFailure) return errorResponse(authFailure);

  const { id } = await ctx.params;

  const rl = checkRateLimit(`reveal:${clientIp(req)}:${id}`, REVEAL_RULE);
  if (!rl.ok) {
    return errorResponse(
      fail("rate_limited", "too many attempts", 429, {
        "Retry-After": String(rl.retryAfterSec),
      })
    );
  }

  const parsed = await parseJsonBody(req);
  if (isFailure(parsed)) return errorResponse(parsed);

  const { key, password } = (parsed.body || {}) as Record<string, unknown>;
  const result = await revealSecret(id, key, password);
  if (isFailure(result)) return errorResponse(result);

  return NextResponse.json({ plaintext: result.plaintext, burned: result.burned });
}
