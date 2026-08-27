import { NextRequest, NextResponse } from "next/server";
import { errorResponse, fail } from "@/lib/apiError";
import { clientIp, isFailure, parseJsonBody } from "@/lib/http";
import { checkRateLimit, createRule } from "@/lib/rateLimit";
import { createSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing create endpoint, used by `components/CreateForm.tsx`.
 *
 * The response stays `{ id, key }`: the browser builds the share URL from
 * `window.location.origin`. API clients want `/api/v1/secrets`, which returns
 * a complete `url` instead. Both call the same `createSecret`.
 *
 * Deliberately not token-gated — the web UI has nowhere to hide a token.
 */
export async function POST(req: NextRequest) {
  const rule = createRule();
  const rl = checkRateLimit(`create:${clientIp(req)}`, rule);
  if (!rl.ok) {
    return errorResponse(
      fail("rate_limited", "too many secrets created; please wait a while", 429, {
        "Retry-After": String(rl.retryAfterSec),
      })
    );
  }

  const parsed = await parseJsonBody(req);
  if (isFailure(parsed)) return errorResponse(parsed);

  const { plaintext, expiry, password } = (parsed.body || {}) as Record<string, unknown>;
  const result = await createSecret({ plaintext, expiry, password });
  if (isFailure(result)) return errorResponse(result);

  return NextResponse.json({ id: result.id, key: result.key }, { status: 201 });
}
