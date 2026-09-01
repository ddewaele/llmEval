import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { AppError, ModelInfoSchema, type AvailableModel, type ModelInfo } from "@llmeval/shared";
import type { Config } from "../config.js";

const anthropic = (
  model: string,
  displayName: string,
  input: number,
  output: number,
): ModelInfo => ({
  id: `anthropic:${model}`,
  provider: "anthropic",
  displayName,
  pricing: { inputPerMTok: input, outputPerMTok: output, cacheReadPerMTok: input * 0.1 },
  structuredOutput: true,
});

/**
 * Built-in registry. Pricing is reference data that goes stale; override or extend it with a
 * `models.json` file (array of ModelInfo) at the repo root or at MODELS_JSON.
 */
export const BUILTIN_MODELS: ModelInfo[] = [
  anthropic("claude-opus-5", "Claude Opus 5", 5, 25),
  anthropic("claude-sonnet-5", "Claude Sonnet 5", 2, 10),
  anthropic("claude-haiku-4-5", "Claude Haiku 4.5", 1, 5),
  anthropic("claude-fable-5-1", "Claude Fable 5.1", 10, 50),
  {
    id: "openai:gpt-5",
    provider: "openai",
    displayName: "GPT-5",
    pricing: null,
    structuredOutput: true,
    notes: "Add pricing in models.json to enable cost estimates",
  },
  {
    id: "openai:gpt-5-mini",
    provider: "openai",
    displayName: "GPT-5 mini",
    pricing: null,
    structuredOutput: true,
    notes: "Add pricing in models.json to enable cost estimates",
  },
  {
    id: "ollama:llama3.2",
    provider: "ollama",
    displayName: "Llama 3.2 (local)",
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    structuredOutput: true,
    notes: "Requires a running Ollama with the model pulled",
  },
];

const ModelsFileSchema = z.array(ModelInfoSchema);

export class ModelRegistry {
  private readonly models: Map<string, ModelInfo>;

  constructor(
    private readonly config: Config,
    extra: ModelInfo[] = [],
  ) {
    this.models = new Map(BUILTIN_MODELS.map((m) => [m.id, m]));
    for (const m of extra) this.models.set(m.id, m);
  }

  static fromFiles(config: Config, paths: string[] = ["./models.json"]): ModelRegistry {
    const extra: ModelInfo[] = [];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      extra.push(...ModelsFileSchema.parse(JSON.parse(readFileSync(p, "utf8"))));
    }
    return new ModelRegistry(config, extra);
  }

  list(): AvailableModel[] {
    return [...this.models.values()].map((m) => ({
      ...m,
      available: this.isAvailable(m.provider),
    }));
  }

  get(id: string): AvailableModel | undefined {
    const m = this.models.get(id);
    return m ? { ...m, available: this.isAvailable(m.provider) } : undefined;
  }

  /** Validate a "provider:model" string for use in a run. */
  resolve(id: string): AvailableModel {
    const known = this.get(id);
    if (known) {
      if (!known.available) {
        throw new AppError(
          "INVALID_STATE",
          `Provider ${known.provider} is not configured for ${id}`,
        );
      }
      return known;
    }
    const [provider, ...rest] = id.split(":");
    if (!provider || rest.length === 0) {
      throw new AppError("VALIDATION", `Model id must be "provider:model", got "${id}"`);
    }
    if (!this.config.ALLOW_UNLISTED_MODELS) {
      throw new AppError(
        "VALIDATION",
        `Unknown model "${id}". Use list_models, add it to models.json, or set ALLOW_UNLISTED_MODELS=true`,
      );
    }
    return {
      id,
      provider,
      displayName: rest.join(":"),
      pricing: null,
      structuredOutput: true,
      available: this.isAvailable(provider),
    };
  }

  private isAvailable(provider: string): boolean {
    switch (provider) {
      case "anthropic":
        return Boolean(this.config.ANTHROPIC_API_KEY);
      case "openai":
        return Boolean(this.config.OPENAI_API_KEY);
      case "ollama":
        return true;
      default:
        return this.config.ALLOW_UNLISTED_MODELS;
    }
  }
}
