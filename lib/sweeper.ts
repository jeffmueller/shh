import { getDb } from "./db";

export function deleteExpired(now: number = Math.floor(Date.now() / 1000)): number {
  const db = getDb();
  const stmt = db.prepare(
    "DELETE FROM secrets WHERE expires_at IS NOT NULL AND expires_at <= ?"
  );
  const result = stmt.run(now);
  return result.changes;
}
