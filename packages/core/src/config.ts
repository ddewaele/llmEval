import { z } from "zod";

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes"].includes(v.toLowerCase())));

export const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  LLMEVAL_DB_PATH: z.string().default("./data/llmeval.sqlite"),
  MCP_BEARER_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  DEFAULT_MODEL: z.string().default("anthropic:claude-opus-5"),
  JUDGE_MODEL: z.string().default("anthropic:claude-opus-5"),
  GENERATION_MODEL: z.string().default("anthropic:claude-opus-5"),
  MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Per-item model call timeout; local models on modest hardware can need several minutes. */
  ITEM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
  AUTO_RESUME: boolFromEnv.default(true),
  ALLOW_UNLISTED_MODELS: boolFromEnv.default(false),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Parse configuration from an env-like record. Empty strings count as unset. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  return ConfigSchema.parse(cleaned);
}
