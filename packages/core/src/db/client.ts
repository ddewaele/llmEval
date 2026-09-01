import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";

export type Db = LibSQLDatabase<typeof schema>;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export interface OpenDatabaseOptions {
  /**
   * File path, or ":memory:". Note: with ":memory:" transactions run on a separate connection
   * and therefore a separate empty database, so prefer a temp file for tests.
   */
  path: string;
  /** Apply pending migrations on open (default true). */
  migrate?: boolean;
}

export async function openDatabase(opts: OpenDatabaseOptions): Promise<{ db: Db; client: Client }> {
  const isMemory = opts.path === ":memory:";
  if (!isMemory) mkdirSync(dirname(resolve(opts.path)), { recursive: true });
  const client = createClient({ url: isMemory ? ":memory:" : `file:${opts.path}` });
  await client.execute("PRAGMA foreign_keys = ON");
  if (!isMemory) {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA busy_timeout = 5000");
  }
  const db = drizzle(client, { schema });
  if (opts.migrate !== false) await migrate(db, { migrationsFolder });
  return { db, client };
}
