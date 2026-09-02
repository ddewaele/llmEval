import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  AppError,
  ModelInfoSchema,
  type AvailableModel,
  type DefaultModelInfo,
  type ModelCatalog,
  type ModelInfo,
  type ModelPurpose,
} from "@llmeval/shared";
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

const PROVIDER_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: "OLLAMA_BASE_URL (server must be running)",
};

export class ModelRegistry {
  private readonly models: Map<string, ModelInfo>;
  /** Model names reported by the Ollama server; null until discovery ran. */
  private ollamaInstalled: Set<string> | null = null;
  private ollamaReachable: boolean | null = null;

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

  /**
   * Ask the local Ollama server which models are installed and register each as
   * `ollama:<name>`. After discovery, Ollama models are available only when installed.
   * Best effort: an unreachable server just marks Ollama as unavailable.
   */
  async discoverOllama(
    opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ): Promise<{ reachable: boolean; installed: string[] }> {
    const doFetch = opts.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
    try {
      const url = `${this.config.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`;
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const installed = (data.models ?? []).map((m) => m.name);
      for (const name of installed) {
        const id = `ollama:${name}`;
        if (!this.models.has(id)) {
          this.models.set(id, {
            id,
            provider: "ollama",
            displayName: `${name} (local)`,
            pricing: { inputPerMTok: 0, outputPerMTok: 0 },
            structuredOutput: true,
            notes: "Discovered from the local Ollama server",
          });
        }
      }
      this.ollamaInstalled = new Set(installed);
      this.ollamaReachable = true;
      return { reachable: true, installed };
    } catch {
      this.ollamaInstalled = new Set();
      this.ollamaReachable = false;
      return { reachable: false, installed: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  list(): AvailableModel[] {
    return [...this.models.values()].map((m) => ({ ...m, available: this.isAvailable(m) }));
  }

  /** Models, effective defaults per purpose and Ollama status, for the API/MCP/web. */
  catalog(): ModelCatalog {
    return {
      models: this.list(),
      defaults: {
        default: this.defaultInfo("default"),
        judge: this.defaultInfo("judge"),
        generation: this.defaultInfo("generation"),
      },
      ollama: {
        baseUrl: this.config.OLLAMA_BASE_URL,
        reachable: this.ollamaReachable,
        installed: [...(this.ollamaInstalled ?? [])],
      },
    };
  }

  get(id: string): AvailableModel | undefined {
    const m = this.models.get(id);
    return m ? { ...m, available: this.isAvailable(m) } : undefined;
  }

  configuredDefault(purpose: ModelPurpose): string {
    switch (purpose) {
      case "default":
        return this.config.DEFAULT_MODEL;
      case "judge":
        return this.config.JUDGE_MODEL;
      case "generation":
        return this.config.GENERATION_MODEL;
    }
  }

  defaultInfo(purpose: ModelPurpose): DefaultModelInfo {
    const configured = this.configuredDefault(purpose);
    const known = this.get(configured);
    if (known?.available)
      return { configured, available: true, effective: configured, fallback: false };
    const fallback = this.firstAvailable();
    return {
      configured,
      available: false,
      effective: fallback?.id ?? null,
      fallback: fallback !== null,
    };
  }

  /**
   * The model to use when a request names none: the configured default when its provider is
   * usable, otherwise the first available model (local Ollama models first, since they are free).
   */
  resolveDefault(purpose: ModelPurpose): AvailableModel {
    const info = this.defaultInfo(purpose);
    if (info.effective) return this.resolve(info.effective);
    const envName =
      purpose === "default"
        ? "DEFAULT_MODEL"
        : purpose === "judge"
          ? "JUDGE_MODEL"
          : "GENERATION_MODEL";
    throw new AppError(
      "INVALID_STATE",
      `${envName}=${info.configured} is not usable (${this.unavailableReason(info.configured)}) and no other model is available. ` +
        "Configure a provider key in .env, start Ollama with a pulled model, or pass a model explicitly (see list_models).",
    );
  }

  /** Validate a "provider:model" string for use in a run. */
  resolve(id: string): AvailableModel {
    const known = this.get(id);
    if (known) {
      if (!known.available) {
        const avail = this.list()
          .filter((m) => m.available)
          .map((m) => m.id);
        throw new AppError(
          "INVALID_STATE",
          `${id} is not usable: ${this.unavailableReason(id)}. Available models: ${avail.length ? avail.join(", ") : "none"}.`,
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
      available: this.isAvailable({ id, provider }),
    };
  }

  private firstAvailable(): AvailableModel | null {
    const avail = this.list().filter((m) => m.available);
    return avail.find((m) => m.provider === "ollama") ?? avail[0] ?? null;
  }

  private unavailableReason(id: string): string {
    const provider = id.split(":")[0] ?? "";
    if (provider === "ollama") {
      if (this.ollamaReachable === false)
        return `Ollama at ${this.config.OLLAMA_BASE_URL} is not reachable`;
      return `model is not installed in Ollama (ollama pull ${id.slice("ollama:".length)})`;
    }
    return `${PROVIDER_ENV[provider] ?? "provider credentials"} is not set`;
  }

  private isAvailable(m: { id: string; provider: string }): boolean {
    switch (m.provider) {
      case "anthropic":
        return Boolean(this.config.ANTHROPIC_API_KEY);
      case "openai":
        return Boolean(this.config.OPENAI_API_KEY);
      case "ollama":
        if (this.ollamaInstalled === null) return true; // discovery not run: assume usable
        return this.ollamaInstalled.has(m.id.slice("ollama:".length));
      default:
        return this.config.ALLOW_UNLISTED_MODELS;
    }
  }
}
