import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createServices, loadConfig, openDatabase } from "@llmeval/core";
import { createApp } from "../src/app.js";

/**
 * Load the first .env found in the working directory or any parent up to the repo root, so
 * `pnpm dev` (root) and `pnpm --filter @llmeval/server start` (apps/server) behave the same.
 * Environment variables already set take precedence over the file.
 */
function loadEnvFile(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), resolve(here, ".."), resolve(here, "../../..")];
  for (const dir of candidates) {
    const file = resolve(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return null;
}
const envFile = loadEnvFile();

const config = loadConfig();
const { db } = await openDatabase({ path: config.LLMEVAL_DB_PATH });
const services = createServices(db, { config });
const ollama = await services.models.discoverOllama();
console.log(
  ollama.reachable
    ? `Ollama at ${config.OLLAMA_BASE_URL}: ${ollama.installed.length} model(s) installed`
    : `Ollama at ${config.OLLAMA_BASE_URL}: not reachable`,
);
for (const [purpose, d] of Object.entries(services.models.catalog().defaults)) {
  if (!d.available) {
    console.warn(
      `Warning: ${purpose} model ${d.configured} is not usable; ${d.effective ? `falling back to ${d.effective}` : "no model available"}`,
    );
  }
}
const recovered = await services.runs.recover();
const interruptedJobs = await services.jobs$.recover();
if (interruptedJobs.length) console.log(`Marked ${interruptedJobs.length} job(s) interrupted`);
if (recovered.resumed.length)
  console.log(`Resumed ${recovered.resumed.length} run(s) after restart`);
if (recovered.interrupted.length) {
  console.log(`Marked ${recovered.interrupted.length} run(s) interrupted (AUTO_RESUME=false)`);
}
const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const app = createApp({ services, config, log: true, staticDir });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`llmEval API listening on http://localhost:${info.port}`);
  console.log(envFile ? `Loaded ${envFile}` : "No .env file found; using process environment only");
  console.log(`OpenAPI: http://localhost:${info.port}/openapi.json  DB: ${config.LLMEVAL_DB_PATH}`);
  console.log(
    `Web UI: http://localhost:${info.port}/ (run 'pnpm build' first; or 'pnpm dev:web' for Vite on :5173)`,
  );
});
