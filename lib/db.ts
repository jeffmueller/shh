import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.SHH_DB_PATH || path.join(process.cwd(), "data", "secrets.db");
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      id              TEXT PRIMARY KEY,
      ciphertext      BLOB NOT NULL,
      iv              BLOB NOT NULL,
      auth_tag        BLOB NOT NULL,
      password_hash   TEXT,
      expires_at      INTEGER,
      burn_after_read INTEGER NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at);
  `);

  return db;
}

export interface SecretRow {
  id: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  password_hash: string | null;
  expires_at: number | null;
  burn_after_read: number;
  created_at: number;
}
