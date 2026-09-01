import { z } from "zod";
import { BoolLikeSchema, IdSchema } from "./common.js";
import { JsonValueSchema } from "./json.js";
import { RunItemStatusSchema, RunSchema } from "./run.js";

export const CompareRunsQuerySchema = z.object({
  a: IdSchema.describe("Baseline run id"),
  b: IdSchema.describe("Candidate run id"),
  onlyRegressions: BoolLikeSchema.default(false).describe(
    "Only items where some scorer got worse in b (lower score, or pass → fail)",
  ),
  scorerKey: z.string().optional().describe("Restrict deltas and regressions to one scorer key"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type CompareRunsQuery = z.infer<typeof CompareRunsQuerySchema>;

const SideSchema = z.object({
  runItemId: IdSchema,
  status: RunItemStatusSchema,
  output: JsonValueSchema.nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  scores: z.record(z.string(), z.number().nullable()),
  passed: z.record(z.string(), z.boolean().nullable()),
});

export const ComparedItemSchema = z.object({
  itemId: IdSchema,
  position: z.number().int(),
  input: JsonValueSchema,
  expected: JsonValueSchema.nullable(),
  a: SideSchema.nullable(),
  b: SideSchema.nullable(),
  /** score(b) − score(a) per scorer key present on both sides. */
  deltas: z.record(z.string(), z.number().nullable()),
  regression: z.boolean(),
  improvement: z.boolean(),
});
export type ComparedItem = z.infer<typeof ComparedItemSchema>;

export const AggregateDeltaSchema = z.object({
  key: z.string(),
  meanScoreA: z.number().nullable(),
  meanScoreB: z.number().nullable(),
  meanScoreDelta: z.number().nullable(),
  passRateA: z.number().nullable(),
  passRateB: z.number().nullable(),
  passRateDelta: z.number().nullable(),
});

export const RunComparisonSchema = z.object({
  a: RunSchema,
  b: RunSchema,
  sameVersion: z.boolean(),
  aggregateDeltas: z.array(AggregateDeltaSchema),
  latencyDeltaMs: z.number().nullable(),
  costDeltaUsd: z.number().nullable(),
  summary: z.object({
    compared: z.number().int(),
    regressions: z.number().int(),
    improvements: z.number().int(),
    onlyInA: z.number().int(),
    onlyInB: z.number().int(),
  }),
  items: z.array(ComparedItemSchema),
  truncated: z.boolean(),
});
export type RunComparison = z.infer<typeof RunComparisonSchema>;
