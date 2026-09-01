import type { z } from "zod";
import type { JsonValue } from "@llmeval/shared";

export interface ScoreContext<C> {
  input: JsonValue;
  expected: JsonValue | null;
  output: JsonValue | null;
  config: C;
  signal?: AbortSignal;
}

export interface ScoreResult {
  /** 0..1 */
  score: number;
  passed?: boolean;
  rationale?: string;
  details?: JsonValue;
  /** LLM-judge bookkeeping. */
  judge?: { model: string; tokens: number; costUsd: number | null };
}

export interface Scorer<C = unknown> {
  type: string;
  description: string;
  usesLlm: boolean;
  configSchema: z.ZodType<C>;
  score(ctx: ScoreContext<C>): Promise<ScoreResult>;
}
