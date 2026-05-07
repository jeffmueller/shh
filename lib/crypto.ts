import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  if (key.length !== KEY_BYTES) throw new Error("invalid key length");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error("invalid key length");
  const decipher = createDecipheriv(ALGO, key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
