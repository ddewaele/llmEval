import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createServices, loadConfig, openDatabase } from "@llmeval/core";
import { createApp } from "../src/app.js";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; rely on the environment
}

const config = loadConfig();
const { db } = await openDatabase({ path: config.LLMEVAL_DB_PATH });
const services = createServices(db, { config });
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
  console.log(`OpenAPI: http://localhost:${info.port}/openapi.json  DB: ${config.LLMEVAL_DB_PATH}`);
  console.log(
    `Web UI: http://localhost:${info.port}/ (run 'pnpm build' first; or 'pnpm dev:web' for Vite on :5173)`,
  );
});
