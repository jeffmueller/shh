import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/apiAuth";
import { errorResponse, fail } from "@/lib/apiError";
import { publicBaseUrl } from "@/lib/config";
import { clientIp, isFailure, parseJsonBody } from "@/lib/http";
import { checkRateLimit, createRule } from "@/lib/rateLimit";
import { createSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a secret and return a ready-to-share URL.
 *
 * The `url` field is the point of this endpoint: a CLI or desktop plugin has
 * no `window.location` to build the link from, and an instance behind a proxy
 * can't infer its own public origin reliably. See `publicBaseUrl`.
 */
export async function POST(req: NextRequest) {
  const authFailure = checkApiAuth(req.headers);
  if (authFailure) return errorResponse(authFailure);

  const rule = createRule();
  const rl = checkRateLimit(`create:${clientIp(req)}`, rule);
  if (!rl.ok) {
    return errorResponse(
      fail("rate_limited", "too many secrets created; slow down", 429, {
        "Retry-After": String(rl.retryAfterSec),
      })
    );
  }

  const parsed = await parseJsonBody(req);
  if (isFailure(parsed)) return errorResponse(parsed);

  const { plaintext, expiry, password } = (parsed.body || {}) as Record<string, unknown>;
  const result = await createSecret({ plaintext, expiry, password });
  if (isFailure(result)) return errorResponse(result);

  const baseUrl = publicBaseUrl(req.headers);

  const headers: Record<string, string> = {};
  if (Number.isFinite(rl.remaining)) {
    headers["X-RateLimit-Limit"] = String(rule.limit);
    headers["X-RateLimit-Remaining"] = String(rl.remaining);
  }

  return NextResponse.json(
    {
      id: result.id,
      key: result.key,
      // The key sits in the fragment, so it is never sent to the server when
      // the recipient opens the link.
      url: `${baseUrl}/s/${result.id}#${result.key}`,
      expiry: result.expiry,
      expiresAt: result.expiresAt,
      expiresAtIso: result.expiresAt === null ? null : new Date(result.expiresAt * 1000).toISOString(),
      burnAfterRead: result.burnAfterRead,
      hasPassword: result.hasPassword,
    },
    { status: 201, headers }
  );
}
