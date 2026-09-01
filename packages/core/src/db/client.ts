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
  // `timeout` is the busy timeout applied to every connection the client opens. Note that the
  // libsql client hands the current connection to each transaction and lazily opens a new one
  // afterwards, so connection-scoped PRAGMAs (foreign_keys) do not survive the first transaction.
  // Services therefore never rely on FK enforcement or ON DELETE CASCADE; deletes are explicit.
  const client = createClient({ url: isMemory ? ":memory:" : `file:${opts.path}`, timeout: 5000 });
  if (!isMemory) await client.execute("PRAGMA journal_mode = WAL");
  const db = drizzle(client, { schema });
  if (opts.migrate !== false) await migrate(db, { migrationsFolder });
  return { db, client };
}
