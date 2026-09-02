import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the first .env found in the working directory, the server package or the repo root, so
 * `pnpm dev` (root) and `pnpm --filter @llmeval/server …` (apps/server) behave the same.
 * Environment variables already set take precedence over the file.
 */
export function loadEnvFile(): string | null {
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
