import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  decrypt,
  encrypt,
  fromBase64Url,
  generateKey,
  toBase64Url,
} from "@/lib/crypto";

// The encryption layer is the load-bearing part of the threat model: the
// database holds only what these functions produce, so anything recoverable
// from ciphertext alone is a total compromise.

test("round-trips plaintext unchanged", () => {
  const key = generateKey();
  for (const plaintext of [
    "hunter2",
    "",
    "line one\nline two\r\nline three",
    "unicode: 🔐 café ñ 日本語",
    "  leading and trailing whitespace  ",
    "a".repeat(100 * 1024), // the documented 100 KB ceiling
  ]) {
    assert.equal(decrypt(encrypt(plaintext, key), key), plaintext);
  }
});

test("generates 32-byte keys", () => {
  assert.equal(generateKey().length, 32);
});

test("rejects keys that are not 32 bytes", () => {
  for (const size of [0, 16, 31, 33, 64]) {
    assert.throws(() => encrypt("x", randomBytes(size)), /invalid key length/);
  }
});

test("uses a fresh IV every time, so identical plaintexts differ", () => {
  // Reusing an IV under the same key breaks GCM catastrophically. Two
  // encryptions of the same input must not produce the same bytes.
  const key = generateKey();
  const a = encrypt("same input", key);
  const b = encrypt("same input", key);

  assert.notEqual(a.iv.toString("hex"), b.iv.toString("hex"));
  assert.notEqual(a.ciphertext.toString("hex"), b.ciphertext.toString("hex"));
  assert.equal(a.iv.length, 12);
});

test("the wrong key cannot decrypt", () => {
  const blob = encrypt("hunter2", generateKey());
  assert.throws(() => decrypt(blob, generateKey()));
});

test("tampering with any part of the blob is detected", () => {
  // GCM authenticates ciphertext and IV. Each of these must fail loudly
  // rather than return garbage plaintext.
  const key = generateKey();

  const flipFirstByte = (buf: Buffer) => {
    const copy = Buffer.from(buf);
    copy[0] ^= 0xff;
    return copy;
  };

  for (const field of ["ciphertext", "iv", "authTag"] as const) {
    const blob = encrypt("hunter2", key);
    const tampered = { ...blob, [field]: flipFirstByte(blob[field]) };
    assert.throws(
      () => decrypt(tampered, key),
      `tampering with ${field} should have been rejected`
    );
  }
});

test("truncated ciphertext is rejected", () => {
  const key = generateKey();
  const blob = encrypt("hunter2 and then some more text", key);
  assert.throws(() =>
    decrypt({ ...blob, ciphertext: blob.ciphertext.subarray(0, 4) }, key)
  );
});

test("base64url encoding is URL-safe and round-trips", () => {
  // The key travels in a URL fragment, so it must survive without escaping:
  // no '+', '/' or '=' may appear.
  for (let i = 0; i < 200; i++) {
    const buf = randomBytes(32);
    const encoded = toBase64Url(buf);

    assert.match(encoded, /^[A-Za-z0-9_-]+$/, `not URL-safe: ${encoded}`);
    assert.deepEqual(fromBase64Url(encoded), buf);
  }
});

test("base64url decoding restores padding for every length", () => {
  for (let len = 1; len <= 40; len++) {
    const buf = randomBytes(len);
    assert.deepEqual(fromBase64Url(toBase64Url(buf)), buf);
  }
});

test("a key survives the encode/decode trip and still decrypts", () => {
  // This is the real path: the key is base64url'd into a URL, then parsed
  // back out of a request body on reveal.
  const key = generateKey();
  const blob = encrypt("hunter2", key);
  const recovered = fromBase64Url(toBase64Url(key));
  assert.equal(decrypt(blob, recovered), "hunter2");
});
