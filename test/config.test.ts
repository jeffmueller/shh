import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EXPIRY,
  clientIpHeader,
  createRateLimit,
  expiryCatalogue,
  instanceName,
  publicBaseUrl,
  trustedProxyHops,
} from "@/lib/config";
import { EXPIRY_OPTIONS } from "@/lib/expiry";

const BASE_VARS = [
  "SHH_BASE_URL",
  "NEXT_PUBLIC_BASE_URL",
  "SHH_INSTANCE_NAME",
  "SHH_CREATE_RATE_LIMIT",
  "SHH_TRUSTED_PROXY_HOPS",
  "SHH_CLIENT_IP_HEADER",
];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(BASE_VARS.map((k) => [k, process.env[k]]));
  for (const k of BASE_VARS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of BASE_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

const headers = (h: Record<string, string>) => new Headers(h);

test("SHH_BASE_URL takes precedence over the legacy alias", () => {
  withEnv(
    { SHH_BASE_URL: "https://primary.example.com", NEXT_PUBLIC_BASE_URL: "https://legacy.example.com" },
    () => assert.equal(publicBaseUrl(), "https://primary.example.com")
  );
});

test("falls back to NEXT_PUBLIC_BASE_URL when the primary is unset", () => {
  withEnv({ NEXT_PUBLIC_BASE_URL: "https://legacy.example.com" }, () =>
    assert.equal(publicBaseUrl(), "https://legacy.example.com")
  );
});

test("configuration is read per call, not captured at import", () => {
  // Next inlines literal process.env.NEXT_PUBLIC_* as build-time constants,
  // which would freeze a self-hoster's base URL into the image. lib/config
  // reads through an indexed access to defeat that, so a change between calls
  // must be visible.
  withEnv({ SHH_BASE_URL: "https://first.example.com" }, () => {
    assert.equal(publicBaseUrl(), "https://first.example.com");
    process.env.SHH_BASE_URL = "https://second.example.com";
    assert.equal(publicBaseUrl(), "https://second.example.com");
  });
});

test("trims trailing slashes so URLs never double up", () => {
  for (const configured of ["https://x.example.com/", "https://x.example.com///"]) {
    withEnv({ SHH_BASE_URL: configured }, () =>
      assert.equal(publicBaseUrl(), "https://x.example.com")
    );
  }
});

test("preserves a sub-path for instances not hosted at the root", () => {
  withEnv({ SHH_BASE_URL: "https://x.example.com/shh/" }, () =>
    assert.equal(publicBaseUrl(), "https://x.example.com/shh")
  );
});

test("ignores a malformed or non-HTTP base URL", () => {
  for (const bad of ["", "   ", "not a url", "ftp://x.example.com", "javascript:alert(1)"]) {
    withEnv({ SHH_BASE_URL: bad, NEXT_PUBLIC_BASE_URL: "https://fallback.example.com" }, () =>
      assert.equal(publicBaseUrl(), "https://fallback.example.com", `${bad} should be ignored`)
    );
  }
});

test("derives the origin from forwarded headers when nothing is configured", () => {
  withEnv({}, () => {
    assert.equal(
      publicBaseUrl(headers({ "x-forwarded-proto": "https", "x-forwarded-host": "proxy.example.com" })),
      "https://proxy.example.com"
    );
    // X-Forwarded-Host wins over Host.
    assert.equal(
      publicBaseUrl(
        headers({ "x-forwarded-proto": "https", "x-forwarded-host": "public.example.com", host: "internal:3000" })
      ),
      "https://public.example.com"
    );
    // Host alone still works.
    assert.equal(
      publicBaseUrl(headers({ "x-forwarded-proto": "http", host: "plain.example.com" })),
      "http://plain.example.com"
    );
    // A comma-joined proto list takes the first value.
    assert.equal(
      publicBaseUrl(headers({ "x-forwarded-proto": "https,http", host: "x.example.com" })),
      "https://x.example.com"
    );
  });
});

test("assumes https when a proxy sends a host but no protocol", () => {
  withEnv({}, () =>
    assert.equal(publicBaseUrl(headers({ host: "x.example.com" })), "https://x.example.com")
  );
});

test("falls back to localhost when there is nothing to go on", () => {
  withEnv({}, () => assert.equal(publicBaseUrl(), "http://localhost:3000"));
});

test("instance name prefers the configured label, else the reached host", () => {
  withEnv({ SHH_INSTANCE_NAME: "  Our team's shh  " }, () =>
    assert.equal(instanceName(), "Our team's shh")
  );
  withEnv({ SHH_BASE_URL: "https://x.example.com" }, () =>
    assert.equal(instanceName(), "x.example.com")
  );
  withEnv({}, () =>
    assert.equal(instanceName(headers({ host: "reached.example.com" })), "reached.example.com")
  );
});

test("create rate limit parses, defaults, and rejects nonsense", () => {
  const cases: Array<[string | undefined, number]> = [
    [undefined, 60],
    ["", 60],
    ["  ", 60],
    ["0", 0],
    ["5", 5],
    ["1000", 1000],
    ["-1", 60],
    ["banana", 60],
    ["7.9", 7],
  ];
  for (const [value, expected] of cases) {
    withEnv({ SHH_CREATE_RATE_LIMIT: value }, () =>
      assert.equal(createRateLimit(), expected, `SHH_CREATE_RATE_LIMIT=${value}`)
    );
  }
});

test("trusted proxy hops defaults to one and accepts zero", () => {
  const cases: Array<[string | undefined, number]> = [
    [undefined, 1],
    ["", 1],
    ["0", 0],
    ["1", 1],
    ["2", 2],
    ["-3", 1],
    ["banana", 1],
  ];
  for (const [value, expected] of cases) {
    withEnv({ SHH_TRUSTED_PROXY_HOPS: value }, () =>
      assert.equal(trustedProxyHops(), expected, `SHH_TRUSTED_PROXY_HOPS=${value}`)
    );
  }
});

test("the client IP header is normalised for case-insensitive lookup", () => {
  withEnv({ SHH_CLIENT_IP_HEADER: "  CF-Connecting-IP  " }, () =>
    assert.equal(clientIpHeader(), "cf-connecting-ip")
  );
  withEnv({}, () => assert.equal(clientIpHeader(), ""));
});

test("the published expiry catalogue mirrors the source of truth", () => {
  // /api/v1/info serves this; a client builds its expiry menu from it.
  assert.deepEqual(
    expiryCatalogue(),
    EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: o.label, seconds: o.seconds }))
  );
});

test("the default expiry is a real option and burns on read", () => {
  const option = EXPIRY_OPTIONS.find((o) => o.value === DEFAULT_EXPIRY);
  assert.ok(option, "DEFAULT_EXPIRY must appear in EXPIRY_OPTIONS");
  assert.equal(option.seconds, null, "the default should be the safest option");
});
