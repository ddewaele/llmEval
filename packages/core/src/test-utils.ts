import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { openDatabase, type Db } from "./db/client.js";
import { createServices, type Services } from "./services/index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/**
 * Fresh SQLite database in a temp file per test. Not `:memory:`: the libsql local client
 * opens a separate connection for transactions, and every `:memory:` connection is its own
 * empty database.
 */
export async function createTestContext(): Promise<{ db: Db; services: Services }> {
  const dir = mkdtempSync(join(tmpdir(), "llmeval-test-"));
  const { db, client } = await openDatabase({ path: join(dir, "test.sqlite") });
  cleanups.push(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, services: createServices(db) };
}
