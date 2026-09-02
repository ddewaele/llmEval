/**
 * Insert sample datasets, ground truths, runs and scores so every screen has something to show.
 *
 *   pnpm seed            # adds the samples (refuses if they already exist)
 *   pnpm seed --reset    # deletes existing sample datasets (tag "sample") and re-creates them
 *   pnpm seed --db PATH  # target another database file
 *
 * Runs are executed by a deterministic stand-in model (`seed:deterministic-v1`), so no provider
 * key or Ollama is needed and the result is the same every time.
 */
import { createServices, loadConfig, openDatabase } from "@llmeval/core";
import { loadEnvFile } from "../src/env-file.js";
import { seedSampleData } from "../src/seed/seed.js";
import { SeedModelFactory } from "../src/seed/seed-model.js";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const dbArg = args.indexOf("--db");
loadEnvFile();
const base = loadConfig();
const config = {
  ...base,
  ALLOW_UNLISTED_MODELS: true,
  LLMEVAL_DB_PATH: dbArg >= 0 ? args[dbArg + 1]! : base.LLMEVAL_DB_PATH,
};

const { db, client } = await openDatabase({ path: config.LLMEVAL_DB_PATH });
const factory = new SeedModelFactory();
const services = createServices(db, { config, modelFactory: factory });
try {
  const result = await seedSampleData(services, factory, { reset });
  console.log(`Seeded ${config.LLMEVAL_DB_PATH}:`);
  for (const d of result.datasets)
    console.log(`  dataset ${d.name}  (${d.items} items, v${d.version})  /datasets/${d.id}`);
  for (const r of result.runs) console.log(`  run ${r.name}  ${r.status}  /runs/${r.id}`);
  console.log(`  ${result.jobs.length} background job(s)`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  client.close();
}
