import { z } from "zod";
import { AppError, type JsonObject, type ScorerInfo, type ScorerSpec } from "@llmeval/shared";
import { deterministicScorers } from "./deterministic.js";
import type { Scorer } from "./types.js";

export class ScorerRegistry {
  private readonly scorers = new Map<string, Scorer<unknown>>();

  constructor(scorers: Scorer<unknown>[] = deterministicScorers) {
    for (const s of scorers) this.register(s);
  }

  register(scorer: Scorer<unknown>): void {
    this.scorers.set(scorer.type, scorer);
  }

  get(type: string): Scorer<unknown> {
    const s = this.scorers.get(type);
    if (!s) {
      throw new AppError(
        "VALIDATION",
        `Unknown scorer type "${type}". Available: ${[...this.scorers.keys()].join(", ")}`,
      );
    }
    return s;
  }

  list(): ScorerInfo[] {
    return [...this.scorers.values()].map((s) => ({
      type: s.type,
      description: s.description,
      usesLlm: s.usesLlm,
      configSchema: z.toJSONSchema(s.configSchema as z.ZodType, { io: "input" }) as JsonObject,
    }));
  }

  /** Validate and normalise a list of scorer specs (types exist, configs parse, keys unique). */
  validate(specs: ScorerSpec[]): ScorerSpec[] {
    const keys = new Set<string>();
    return specs.map((spec) => {
      if (keys.has(spec.key))
        throw new AppError("VALIDATION", `Duplicate scorer key "${spec.key}"`);
      keys.add(spec.key);
      const scorer = this.get(spec.type);
      const parsed = scorer.configSchema.safeParse(spec.config);
      if (!parsed.success) {
        throw new AppError(
          "VALIDATION",
          `Invalid config for scorer "${spec.key}" (${spec.type})`,
          parsed.error.issues,
        );
      }
      return { ...spec, config: parsed.data as JsonObject };
    });
  }
}
