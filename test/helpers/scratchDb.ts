import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Points lib/db at a throwaway SQLite file.
 *
 * `lib/db` reads `SHH_DB_PATH` lazily — on the first `getDb()` call, not at
 * import time — and then caches the connection for the process. Every import
 * in a file is evaluated before any test body runs, so importing this module
 * anywhere in the file is enough; its position among the imports does not
 * matter.
 *
 * `assertUsingScratchDb()` is the actual safety net. It catches the cases that
 * would otherwise write to ./data/secrets.db: forgetting this import entirely,
 * or a future module that opens the database at import time and so latches the
 * default path before this runs.
 */
export const SCRATCH_DB_PATH = path.join(
  os.tmpdir(),
  `shh-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
);

process.env.SHH_DB_PATH = SCRATCH_DB_PATH;

/** Throws unless the live connection really is the scratch database. */
export function assertUsingScratchDb(actualPath: string): void {
  if (path.resolve(actualPath) !== path.resolve(SCRATCH_DB_PATH)) {
    throw new Error(
      `Refusing to run: tests are connected to ${actualPath}, not the scratch ` +
        `database ${SCRATCH_DB_PATH}. Either this file does not import ` +
        `"./helpers/scratchDb", or something opened the database before it ran.`
    );
  }
}

export function removeScratchDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(SCRATCH_DB_PATH + suffix, { force: true });
  }
}
