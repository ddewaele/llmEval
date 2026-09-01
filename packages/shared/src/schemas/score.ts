import { z } from "zod";
import { IdSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";

export const ScorerSpecSchema = z.object({
  key: z.string().min(1).max(64).describe("Unique key within the run, e.g. 'exact' or 'judge'"),
  type: z.string().min(1).describe("Scorer type, see list_scorers"),
  config: JsonObjectSchema.default({}),
});
export type ScorerSpec = z.infer<typeof ScorerSpecSchema>;

export const ScoreSchema = z.object({
  id: IdSchema,
  runItemId: IdSchema,
  scorerKey: z.string(),
  scorerType: z.string(),
  score: z.number().min(0).max(1).nullable(),
  passed: z.boolean().nullable(),
  rationale: z.string().nullable(),
  details: JsonValueSchema.nullable(),
  judgeModel: z.string().nullable(),
  judgeTokens: z.number().int().nullable(),
  judgeCostUsd: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;

export const ScorerAggregateSchema = z.object({
  key: z.string(),
  type: z.string(),
  scoredCount: z.number().int(),
  errorCount: z.number().int(),
  meanScore: z.number().nullable(),
  passRate: z.number().nullable().describe("passed / scored, null when no scorer reports pass"),
  passedCount: z.number().int(),
});
export type ScorerAggregate = z.infer<typeof ScorerAggregateSchema>;

export const RunAggregatesSchema = z.object({
  scorers: z.array(ScorerAggregateSchema),
  latency: z.object({
    meanMs: z.number().nullable(),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
  }),
});
export type RunAggregates = z.infer<typeof RunAggregatesSchema>;

export const ScorerInfoSchema = z.object({
  type: z.string(),
  description: z.string(),
  configSchema: JsonObjectSchema.describe("JSON Schema of the scorer config"),
  usesLlm: z.boolean(),
});
export type ScorerInfo = z.infer<typeof ScorerInfoSchema>;

export const ScoreRunSchema = z.object({
  scorer: ScorerSpecSchema,
  overwrite: z
    .boolean()
    .default(false)
    .describe("Replace existing scores for this key; otherwise a duplicate key is refused"),
});
export type ScoreRun = z.infer<typeof ScoreRunSchema>;
