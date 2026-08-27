import test from "node:test";
import assert from "node:assert/strict";

import { authRequired, checkApiAuth, configuredTokens } from "@/lib/apiAuth";

function withTokens(value: string | undefined, fn: () => void) {
  const saved = process.env.SHH_API_TOKENS;
  if (value === undefined) delete process.env.SHH_API_TOKENS;
  else process.env.SHH_API_TOKENS = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.SHH_API_TOKENS;
    else process.env.SHH_API_TOKENS = saved;
  }
}

const auth = (value: string) => new Headers({ authorization: value });

const TOKEN = "tok-alpha-0123456789abcdef";
const SECOND = "tok-beta-fedcba9876543210";

test("no configured tokens means the API is open", () => {
  for (const value of [undefined, "", "   ", ",", " , , "]) {
    withTokens(value, () => {
      assert.equal(authRequired(), false, `${JSON.stringify(value)} should leave auth off`);
      assert.equal(checkApiAuth(new Headers()), null, "an open API must accept no header");
    });
  }
});

test("configuring tokens turns auth on", () => {
  withTokens(TOKEN, () => {
    assert.equal(authRequired(), true);
    assert.equal(checkApiAuth(auth(`Bearer ${TOKEN}`)), null);
  });
});

test("a missing header is rejected with a bearer challenge", () => {
  withTokens(TOKEN, () => {
    const failure = checkApiAuth(new Headers());
    assert.ok(failure);
    assert.equal(failure.code, "unauthorized");
    assert.equal(failure.status, 401);
    // Clients rely on this to distinguish "needs a token" from other failures.
    assert.match(failure.headers?.["WWW-Authenticate"] ?? "", /^Bearer/);
  });
});

test("a wrong token is rejected", () => {
  withTokens(TOKEN, () => {
    for (const presented of ["wrong", "", TOKEN + "x", TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
      const failure = checkApiAuth(auth(`Bearer ${presented}`));
      assert.ok(failure, `"${presented}" should have been rejected`);
      assert.equal(failure.status, 401);
    }
  });
});

test("the scheme keyword is case-insensitive and tolerates extra spacing", () => {
  withTokens(TOKEN, () => {
    for (const header of [
      `Bearer ${TOKEN}`,
      `bearer ${TOKEN}`,
      `BEARER ${TOKEN}`,
      `Bearer    ${TOKEN}`,
      `  Bearer ${TOKEN}  `,
    ]) {
      assert.equal(checkApiAuth(auth(header)), null, `"${header}" should be accepted`);
    }
  });
});

test("other auth schemes are rejected", () => {
  withTokens(TOKEN, () => {
    for (const header of [TOKEN, `Basic ${TOKEN}`, `Token ${TOKEN}`, "Bearer", "Bearer "]) {
      assert.ok(checkApiAuth(auth(header)), `"${header}" should have been rejected`);
    }
  });
});

test("every token in a list is accepted, however it is separated", () => {
  for (const separator of [",", ", ", " ", "\n", ",,", " , "]) {
    withTokens(`${TOKEN}${separator}${SECOND}`, () => {
      assert.deepEqual(configuredTokens(), [TOKEN, SECOND]);
      assert.equal(checkApiAuth(auth(`Bearer ${TOKEN}`)), null, "first token");
      assert.equal(checkApiAuth(auth(`Bearer ${SECOND}`)), null, "second token");
      assert.ok(checkApiAuth(auth("Bearer neither")), "an unlisted token must fail");
    });
  }
});

test("surrounding whitespace in the configured list is ignored", () => {
  withTokens(`   ${TOKEN} ,  ${SECOND}   `, () => {
    assert.deepEqual(configuredTokens(), [TOKEN, SECOND]);
    assert.equal(checkApiAuth(auth(`Bearer ${SECOND}`)), null);
  });
});

test("tokens are read per call, so rotation needs no restart", () => {
  withTokens(TOKEN, () => {
    assert.equal(checkApiAuth(auth(`Bearer ${TOKEN}`)), null);
    process.env.SHH_API_TOKENS = SECOND;
    assert.ok(checkApiAuth(auth(`Bearer ${TOKEN}`)), "the revoked token should stop working");
    assert.equal(checkApiAuth(auth(`Bearer ${SECOND}`)), null);
  });
});

test("a token containing regex or shell metacharacters is compared literally", () => {
  const awkward = "tok-.*$^[]{}()|\\+?-_=/";
  withTokens(awkward, () => {
    assert.equal(checkApiAuth(auth(`Bearer ${awkward}`)), null);
    assert.ok(checkApiAuth(auth("Bearer tok-anything")), "must not be treated as a pattern");
  });
});
