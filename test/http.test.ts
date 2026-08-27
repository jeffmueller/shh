import test from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { clientIp, isFailure, parseJsonBody } from "@/lib/http";
import { fail } from "@/lib/apiError";

// clientIp decides the rate-limit bucket, so getting it wrong is what let a
// client rotate X-Forwarded-For and brute-force password-protected secrets.
// Only the headers are read, so a bare object is a sufficient stand-in.
function req(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const oneHop = { SHH_TRUSTED_PROXY_HOPS: "1", SHH_CLIENT_IP_HEADER: undefined };

test("one proxy: takes the entry the proxy appended, not the client's", () => {
  withEnv(oneHop, () => {
    // nginx's $proxy_add_x_forwarded_for forwards "<whatever the client sent>,
    // <real address>". Trusting the left end is the bug.
    assert.equal(
      clientIp(req({ "x-forwarded-for": "10.9.9.9, 203.0.113.7" })),
      "203.0.113.7"
    );
  });
});

test("one proxy: a rotating spoof cannot change the bucket", () => {
  withEnv(oneHop, () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 25; i++) {
      seen.add(clientIp(req({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` })));
    }
    assert.deepEqual([...seen], ["203.0.113.7"], "spoofed entries leaked through");
  });
});

test("one proxy: a single entry is the client", () => {
  withEnv(oneHop, () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  });
});

test("two proxies: skips both trusted hops", () => {
  withEnv({ SHH_TRUSTED_PROXY_HOPS: "2", SHH_CLIENT_IP_HEADER: undefined }, () => {
    // client → Cloudflare → own proxy. The client's real address is the entry
    // Cloudflare appended, i.e. two from the right.
    assert.equal(
      clientIp(req({ "x-forwarded-for": "198.51.100.4, 172.16.0.1, 203.0.113.7" })),
      "172.16.0.1"
    );
    // And a spoof prepended by the client still cannot reach that position.
    assert.equal(
      clientIp(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.4, 172.16.0.1, 203.0.113.7" })),
      "172.16.0.1"
    );
  });
});

test("fewer entries than declared hops clamps to the first, never undefined", () => {
  withEnv({ SHH_TRUSTED_PROXY_HOPS: "3", SHH_CLIENT_IP_HEADER: undefined }, () => {
    const ip = clientIp(req({ "x-forwarded-for": "203.0.113.7" }));
    assert.equal(ip, "203.0.113.7");
    assert.notEqual(ip, "undefined");
  });
});

test("hops=0 ignores forwarded headers entirely", () => {
  withEnv({ SHH_TRUSTED_PROXY_HOPS: "0", SHH_CLIENT_IP_HEADER: undefined }, () => {
    // Everything shares one bucket: throttles rather than trusting a forgeable
    // value. Crucially it must NOT return the attacker-supplied address.
    const a = clientIp(req({ "x-forwarded-for": "10.0.0.1" }));
    const b = clientIp(req({ "x-forwarded-for": "10.0.0.2" }));
    const c = clientIp(req({ "x-real-ip": "10.0.0.3" }));
    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(a, "unproxied");
  });
});

test("a trusted single-value header wins over X-Forwarded-For", () => {
  withEnv(
    { SHH_TRUSTED_PROXY_HOPS: "1", SHH_CLIENT_IP_HEADER: "cf-connecting-ip" },
    () => {
      assert.equal(
        clientIp(
          req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "10.0.0.1, 203.0.113.7" })
        ),
        "198.51.100.9"
      );
    }
  );
});

test("falls back to X-Forwarded-For when the configured header is absent", () => {
  withEnv(
    { SHH_TRUSTED_PROXY_HOPS: "1", SHH_CLIENT_IP_HEADER: "cf-connecting-ip" },
    () => {
      assert.equal(
        clientIp(req({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" })),
        "203.0.113.7"
      );
    }
  );
});

test("falls back to x-real-ip, which nginx sets from the socket", () => {
  withEnv(oneHop, () => {
    assert.equal(clientIp(req({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  });
});

test("tolerates padding, empty entries and a trailing comma", () => {
  withEnv(oneHop, () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "  10.0.0.1 ,  203.0.113.7  " })), "203.0.113.7");
    assert.equal(clientIp(req({ "x-forwarded-for": "10.0.0.1, , 203.0.113.7," })), "203.0.113.7");
  });
});

test("no usable headers yields a stable placeholder", () => {
  withEnv(oneHop, () => {
    assert.equal(clientIp(req({})), "unknown");
    // An all-empty header must not fall through to an empty bucket key.
    assert.equal(clientIp(req({ "x-forwarded-for": " , , " })), "unknown");
  });
});

test("an unparseable hop count falls back to one proxy", () => {
  withEnv({ SHH_TRUSTED_PROXY_HOPS: "banana", SHH_CLIENT_IP_HEADER: undefined }, () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" })), "203.0.113.7");
  });
});

test("parseJsonBody surfaces malformed bodies as a failure, not a throw", async () => {
  const bad = { json: async () => JSON.parse("{ not json") } as unknown as NextRequest;
  const result = await parseJsonBody(bad);
  assert.ok(isFailure(result));
  assert.equal(result.code, "invalid_json");
  assert.equal(result.status, 400);
});

test("parseJsonBody returns the parsed body on success", async () => {
  const good = { json: async () => ({ plaintext: "x" }) } as unknown as NextRequest;
  const result = await parseJsonBody(good);
  assert.ok(!isFailure(result));
  assert.deepEqual(result.body, { plaintext: "x" });
});

test("isFailure distinguishes failures from ordinary values", () => {
  assert.equal(isFailure(fail("not_found", "nope", 404)), true);
  assert.equal(isFailure({ ok: true, id: "x" }), false);
  assert.equal(isFailure(null), false);
  assert.equal(isFailure(undefined), false);
  assert.equal(isFailure("string"), false);
});
