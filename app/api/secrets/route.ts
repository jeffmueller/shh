import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { encrypt, generateKey, toBase64Url } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { isValidExpiry, resolveExpiry } from "@/lib/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PLAINTEXT_BYTES = 100 * 1024;
const MAX_PASSWORD_LEN = 256;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { plaintext, expiry, password } = (body || {}) as {
    plaintext?: unknown;
    expiry?: unknown;
    password?: unknown;
  };

  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return NextResponse.json({ error: "plaintext required" }, { status: 400 });
  }
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) {
    return NextResponse.json({ error: "secret exceeds 100 KB limit" }, { status: 413 });
  }
  if (!isValidExpiry(expiry)) {
    return NextResponse.json({ error: "invalid expiry" }, { status: 400 });
  }
  let passwordHash: string | null = null;
  if (password !== undefined && password !== null && password !== "") {
    if (typeof password !== "string" || password.length > MAX_PASSWORD_LEN) {
      return NextResponse.json({ error: "invalid password" }, { status: 400 });
    }
    passwordHash = await hashPassword(password);
  }

  const id = randomUUID();
  const key = generateKey();
  const { ciphertext, iv, authTag } = encrypt(plaintext, key);
  const { burnAfterRead, expiresAt } = resolveExpiry(expiry);
  const createdAt = Math.floor(Date.now() / 1000);

  const db = getDb();
  db.prepare(
    `INSERT INTO secrets (id, ciphertext, iv, auth_tag, password_hash, expires_at, burn_after_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, ciphertext, iv, authTag, passwordHash, expiresAt, burnAfterRead ? 1 : 0, createdAt);

  return NextResponse.json({ id, key: toBase64Url(key) }, { status: 201 });
}
