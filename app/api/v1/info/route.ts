import { NextRequest, NextResponse } from "next/server";
import pkg from "@/package.json";
import { authRequired } from "@/lib/apiAuth";
import {
  DEFAULT_EXPIRY,
  createRateLimit,
  expiryCatalogue,
  instanceName,
  publicBaseUrl,
} from "@/lib/config";
import { MAX_PASSWORD_LEN, MAX_PLAINTEXT_BYTES } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capability discovery. Unauthenticated by design, even when
 * `SHH_API_TOKENS` is set: a client configured with a server address needs to
 * confirm it is talking to a Shh instance and learn whether a token is
 * required *before* it has one. Nothing here is secret — it is the same
 * information the web form exposes to any visitor.
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    service: "shh",
    apiVersion: 1,
    appVersion: pkg.version,
    instance: {
      name: instanceName(req.headers),
      baseUrl: publicBaseUrl(req.headers),
    },
    auth: {
      required: authRequired(),
      scheme: "bearer",
    },
    limits: {
      maxPlaintextBytes: MAX_PLAINTEXT_BYTES,
      maxPasswordLength: MAX_PASSWORD_LEN,
      // 0 means the operator disabled the app-level create limit.
      createPerHour: createRateLimit(),
      revealAttemptsPer5Min: 10,
    },
    defaults: {
      expiry: DEFAULT_EXPIRY,
    },
    expiryOptions: expiryCatalogue(),
    features: {
      password: true,
      reveal: true,
      metadata: true,
    },
    endpoints: {
      info: "GET /api/v1/info",
      create: "POST /api/v1/secrets",
      metadata: "GET /api/v1/secrets/{id}",
      reveal: "POST /api/v1/secrets/{id}/reveal",
    },
  });
}
