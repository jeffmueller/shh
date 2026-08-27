// Redirects lib/db at a scratch database — see the helper for why the
// assertion below, not this import's position, is what protects ./data.
import { assertUsingScratchDb, removeScratchDb } from "./helpers/scratchDb";

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";

// Route handlers, exercised directly. The library tests cover the logic; these
// cover the HTTP contract on top of it — status codes, headers, response
// shapes, and the auth/rate-limit ordering that only exists in the routes.
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getInfo } from "@/app/api/v1/info/route";
import { POST as createV1 } from "@/app/api/v1/secrets/route";
import { GET as metaV1 } from "@/app/api/v1/secrets/[id]/route";
import { POST as revealV1 } from "@/app/api/v1/secrets/[id]/reveal/route";
import { POST as createWeb } from "@/app/api/secrets/route";
import { GET as metaWeb } from "@/app/api/secrets/[id]/meta/route";
import { POST as revealWeb } from "@/app/api/secrets/[id]/reveal/route";

test("connected to the scratch database, not the real one", () => {
  assertUsingScratchDb(getDb().name);
});

test.after(removeScratchDb);

// Every request carries a distinct client address so one test's rate-limit
// bucket can't spill into another's. Buckets are process-global.
let clientCounter = 0;
function nextClient() {
  clientCounter += 1;
  return `198.51.100.${clientCounter % 250}:${clientCounter}`;
}

function post(
  url: string,
  body: unknown,
  { headers = {}, client = nextClient(), raw }: { headers?: Record<string, string>; client?: string; raw?: string } = {}
) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": client,
      ...headers,
    },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: "GET",
    headers: { "x-forwarded-for": nextClient(), ...headers },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function createSecretVia(body: unknown, headers: Record<string, string> = {}) {
  const res = await createV1(post("/api/v1/secrets", body, { headers }));
  assert.equal(res.status, 201, "expected the secret to be created");
  return res.json();
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// ─── Health ──────────────────────────────────────────────────────────────

test("health reports ok when the database is reachable", async () => {
  const res = await getHealth();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

// ─── Discovery ───────────────────────────────────────────────────────────

test("info advertises the contract a client configures itself from", async () => {
  const res = await getInfo(get("/api/v1/info", { host: "shh.example.com" }));
  assert.equal(res.status, 200);
  const body = await res.json();

  // A client validates a user-entered server address on this field.
  assert.equal(body.service, "shh");
  assert.equal(body.apiVersion, 1);
  assert.equal(typeof body.instance.baseUrl, "string");
  assert.equal(body.auth.scheme, "bearer");
  assert.equal(body.defaults.expiry, "first_view");
  assert.ok(Array.isArray(body.expiryOptions) && body.expiryOptions.length > 0);
  assert.ok(body.expiryOptions.every((o: { value: string }) => typeof o.value === "string"));
  assert.equal(body.limits.maxPlaintextBytes, 100 * 1024);
});

test("info stays public even when the API requires a token", async () => {
  // A client must be able to learn that a token is needed before it has one.
  await withEnv({ SHH_API_TOKENS: "tok-secret-value-abcdef" }, async () => {
    const res = await getInfo(get("/api/v1/info"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).auth.required, true);
  });
});

test("info derives its base URL from forwarded headers when unconfigured", async () => {
  await withEnv({ SHH_BASE_URL: undefined, NEXT_PUBLIC_BASE_URL: undefined }, async () => {
    const res = await getInfo(
      get("/api/v1/info", { "x-forwarded-proto": "https", "x-forwarded-host": "public.example.com" })
    );
    assert.equal((await res.json()).instance.baseUrl, "https://public.example.com");
  });
});

// ─── Create ──────────────────────────────────────────────────────────────

test("create returns a complete share URL, which is the point of the API", async () => {
  await withEnv({ SHH_BASE_URL: "https://shh.example.com" }, async () => {
    const body = await createSecretVia({ plaintext: "hunter2", expiry: "1h" });

    assert.equal(body.url, `https://shh.example.com/s/${body.id}#${body.key}`);
    // The key must be in the fragment: everything after '#' never reaches a server.
    assert.equal(body.url.split("#")[1], body.key);
    assert.equal(body.burnAfterRead, false);
    assert.equal(body.hasPassword, false);
    assert.equal(typeof body.expiresAtIso, "string");
  });
});

test("create reports rate-limit headroom on success", async () => {
  const res = await createV1(post("/api/v1/secrets", { plaintext: "x", expiry: "1h" }));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-ratelimit-limit"), "60");
  assert.equal(res.headers.get("x-ratelimit-remaining"), "59");
});

test("create rejects a body that is not declared as JSON", async () => {
  const res = await createV1(
    post("/api/v1/secrets", null, {
      headers: { "content-type": "text/plain" },
      raw: JSON.stringify({ plaintext: "x" }),
    })
  );
  assert.equal(res.status, 415);
  assert.equal((await res.json()).code, "unsupported_media_type");
});

test("create surfaces validation failures with a stable code", async () => {
  const cases: Array<[unknown, number, string]> = [
    [{ plaintext: "" }, 400, "plaintext_required"],
    [{ plaintext: "x", expiry: "99y" }, 400, "invalid_expiry"],
    [{ plaintext: "a".repeat(100 * 1024 + 1) }, 413, "plaintext_too_large"],
    [{ plaintext: "x", password: "p".repeat(257) }, 400, "invalid_password"],
  ];
  for (const [body, status, code] of cases) {
    const res = await createV1(post("/api/v1/secrets", body));
    assert.equal(res.status, status, `${JSON.stringify(body)} status`);
    const json = await res.json();
    assert.equal(json.code, code);
    // `error` stays a plain string so existing browser components keep working.
    assert.equal(typeof json.error, "string");
  }
});

test("malformed JSON is a 400, not a crash", async () => {
  const res = await createV1(post("/api/v1/secrets", null, { raw: "{ not json" }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "invalid_json");
});

// ─── Metadata and reveal ─────────────────────────────────────────────────

test("metadata is non-destructive and reveal then burns", async () => {
  const { id, key } = await createSecretVia({ plaintext: "burn me" });

  for (let i = 0; i < 3; i++) {
    const res = await metaV1(get(`/api/v1/secrets/${id}`), params(id));
    assert.equal(res.status, 200);
    const meta = await res.json();
    assert.equal(meta.exists, true);
    assert.equal(meta.burnAfterRead, true);
  }

  const revealed = await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key }), params(id));
  assert.equal(revealed.status, 200);
  assert.deepEqual(await revealed.json(), { plaintext: "burn me", burned: true });

  const after = await metaV1(get(`/api/v1/secrets/${id}`), params(id));
  assert.equal((await after.json()).exists, false);
});

test("a password-protected secret asks for a password, then yields", async () => {
  const { id, key } = await createSecretVia({ plaintext: "guarded", password: "pw" });

  const meta = await (await metaV1(get(`/api/v1/secrets/${id}`), params(id))).json();
  assert.equal(meta.hasPassword, true);

  const noPassword = await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key }), params(id));
  assert.equal(noPassword.status, 401);
  assert.equal((await noPassword.json()).code, "password_required");

  const wrong = await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key, password: "nope" }), params(id));
  assert.equal(wrong.status, 404, "a wrong password must be indistinguishable from a miss");

  const right = await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key, password: "pw" }), params(id));
  assert.equal(right.status, 200);
  assert.equal((await right.json()).plaintext, "guarded");
});

test("metadata for an unknown id is a 200 saying nothing exists", async () => {
  // Not a 404: the response must not confirm or deny that an id was ever real.
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    const res = await metaV1(get(`/api/v1/secrets/${id}`), params(id));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { exists: false });
  }
});

test("reveal is throttled after ten attempts against one secret", async () => {
  const { id, key } = await createSecretVia({ plaintext: "x", expiry: "1h", password: "pw" });
  const client = nextClient();

  for (let i = 1; i <= 10; i++) {
    const res = await revealV1(
      post(`/api/v1/secrets/${id}/reveal`, { key, password: "wrong" }, { client }),
      params(id)
    );
    assert.equal(res.status, 404, `guess ${i} should fail normally`);
  }

  const blocked = await revealV1(
    post(`/api/v1/secrets/${id}/reveal`, { key, password: "pw" }, { client }),
    params(id)
  );
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0, "must tell the client when to retry");
});

test("the reveal limit is keyed per secret, not per client alone", async () => {
  const client = nextClient();
  const a = await createSecretVia({ plaintext: "a", expiry: "1h", password: "pw" });
  const b = await createSecretVia({ plaintext: "b", expiry: "1h", password: "pw" });

  for (let i = 0; i < 10; i++) {
    await revealV1(post(`/api/v1/secrets/${a.id}/reveal`, { key: a.key, password: "x" }, { client }), params(a.id));
  }
  const exhausted = await revealV1(
    post(`/api/v1/secrets/${a.id}/reveal`, { key: a.key, password: "pw" }, { client }),
    params(a.id)
  );
  assert.equal(exhausted.status, 429);

  // The same client may still reach a different secret.
  const other = await revealV1(
    post(`/api/v1/secrets/${b.id}/reveal`, { key: b.key, password: "pw" }, { client }),
    params(b.id)
  );
  assert.equal(other.status, 200);
});

// ─── Bearer auth ─────────────────────────────────────────────────────────

const TOKEN = "tok-alpha-0123456789abcdef";

test("with tokens configured, the API demands one", async () => {
  await withEnv({ SHH_API_TOKENS: TOKEN }, async () => {
    const res = await createV1(post("/api/v1/secrets", { plaintext: "x" }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "unauthorized");
    assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);

    const ok = await createV1(
      post("/api/v1/secrets", { plaintext: "x" }, { headers: { authorization: `Bearer ${TOKEN}` } })
    );
    assert.equal(ok.status, 201);
  });
});

test("auth is checked before the rate limit, so failures cost nothing", async () => {
  // Otherwise unauthenticated noise could exhaust a legitimate client's quota.
  await withEnv({ SHH_API_TOKENS: TOKEN, SHH_CREATE_RATE_LIMIT: "2" }, async () => {
    const client = nextClient();
    for (let i = 0; i < 10; i++) {
      const res = await createV1(post("/api/v1/secrets", { plaintext: "x" }, { client }));
      assert.equal(res.status, 401);
    }
    const authorised = await createV1(
      post("/api/v1/secrets", { plaintext: "x" }, { client, headers: { authorization: `Bearer ${TOKEN}` } })
    );
    assert.equal(authorised.status, 201, "the quota should have been untouched");
  });
});

test("metadata and reveal are gated too", async () => {
  const { id, key } = await createSecretVia({ plaintext: "x", expiry: "1h" });
  await withEnv({ SHH_API_TOKENS: TOKEN }, async () => {
    assert.equal((await metaV1(get(`/api/v1/secrets/${id}`), params(id))).status, 401);
    assert.equal(
      (await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key }), params(id))).status,
      401
    );
  });
});

// ─── The browser routes ──────────────────────────────────────────────────

test("the web routes keep their original response shapes", async () => {
  // components/CreateForm and RevealView destructure these exact fields.
  const createRes = await createWeb(post("/api/secrets", { plaintext: "web", expiry: "first_view" }));
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.deepEqual(Object.keys(created).sort(), ["id", "key"]);

  const metaRes = await metaWeb(get(`/api/secrets/${created.id}/meta`), params(created.id));
  assert.deepEqual(await metaRes.json(), { exists: true, hasPassword: false });

  const revealRes = await revealWeb(
    post(`/api/secrets/${created.id}/reveal`, { key: created.key }),
    params(created.id)
  );
  assert.deepEqual(await revealRes.json(), { plaintext: "web" });
});

test("the web routes stay open when the API requires a token", async () => {
  // The web UI has nowhere to hide a token; gating it would just break the app.
  await withEnv({ SHH_API_TOKENS: TOKEN }, async () => {
    const res = await createWeb(post("/api/secrets", { plaintext: "x", expiry: "1h" }));
    assert.equal(res.status, 201);
  });
});

test("both surfaces share one reveal bucket, so guesses cannot be doubled", async () => {
  const { id, key } = await createSecretVia({ plaintext: "x", expiry: "1h", password: "pw" });
  const client = nextClient();

  // Five guesses on each surface is ten in total, not twenty.
  for (let i = 0; i < 5; i++) {
    await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key, password: "x" }, { client }), params(id));
    await revealWeb(post(`/api/secrets/${id}/reveal`, { key, password: "x" }, { client }), params(id));
  }

  const viaApi = await revealV1(post(`/api/v1/secrets/${id}/reveal`, { key, password: "pw" }, { client }), params(id));
  const viaWeb = await revealWeb(post(`/api/secrets/${id}/reveal`, { key, password: "pw" }, { client }), params(id));
  assert.equal(viaApi.status, 429);
  assert.equal(viaWeb.status, 429);
});

test("a spoofed X-Forwarded-For cannot buy extra attempts", async () => {
  const { id, key } = await createSecretVia({ plaintext: "x", expiry: "1h", password: "pw" });
  const realIp = "203.0.113.42";

  // One trusted proxy: the last entry is the one it appended.
  let blocked = false;
  for (let i = 1; i <= 12; i++) {
    const res = await revealV1(
      post(`/api/v1/secrets/${id}/reveal`, { key, password: "wrong" }, { client: `10.0.0.${i}, ${realIp}` }),
      params(id)
    );
    if (res.status === 429) {
      blocked = true;
      assert.ok(i <= 11, `should have been throttled by attempt 11, took ${i}`);
      break;
    }
  }
  assert.ok(blocked, "rotating the spoofed entry bypassed the limit");
});
