import { z } from "zod";
import { IdSchema, PaginationQuerySchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { RunAggregatesSchema, ScoreSchema, ScorerSpecSchema } from "./score.js";

export const ModelParamsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    /** Per-item wall clock limit in milliseconds (default 120000). */
    timeoutMs: z.number().int().positive().optional(),
  })
  .catchall(z.unknown())
  .describe("Model parameters passed to the provider (temperature, maxTokens, topP, …)");
export type ModelParams = z.infer<typeof ModelParamsSchema>;

/** What to send to the model for each item. Snapshotted onto the run. */
export const TaskConfigSchema = z.object({
  model: z.string().describe("provider:model id, see list_models"),
  params: ModelParamsSchema.default({}),
  systemPrompt: z.string().nullable().default(null),
  userTemplate: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Mustache-style template rendered against the item input: {{field}}, {{nested.path}}, {{json field}}, or {{input}} for string inputs. Ignored for chat-message inputs",
    ),
  outputSchema: JsonObjectSchema.nullable()
    .default(null)
    .describe("JSON Schema; when set the model is forced to return a matching object"),
});
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunItemStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RunItemStatus = z.infer<typeof RunItemStatusSchema>;

export const StartRunSchema = z.object({
  datasetId: IdSchema,
  versionNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Defaults to the latest version; unpublished draft changes are auto-published first"),
  name: z.string().max(200).optional(),
  model: z.string().optional().describe("provider:model; defaults to DEFAULT_MODEL"),
  params: ModelParamsSchema.optional(),
  systemPrompt: z.string().optional(),
  userTemplate: z.string().optional(),
  outputSchema: JsonObjectSchema.optional(),
  scorers: z.array(ScorerSpecSchema).default([]),
  concurrency: z.number().int().min(1).max(32).optional(),
  maxCostUsd: z
    .number()
    .positive()
    .optional()
    .describe("Abort the run when estimated cost exceeds this"),
  triggeredBy: z.enum(["ui", "mcp", "api"]).default("api"),
});
export type StartRun = z.infer<typeof StartRunSchema>;

export const RunSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  versionId: IdSchema,
  versionNumber: z.number().int(),
  name: z.string().nullable(),
  config: TaskConfigSchema,
  scorers: z.array(ScorerSpecSchema),
  status: RunStatusSchema,
  concurrency: z.number().int(),
  triggeredBy: z.string(),
  totalItems: z.number().int(),
  completedItems: z.number().int(),
  failedItems: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number().nullable(),
  maxCostUsd: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  aggregates: RunAggregatesSchema,
});
export type Run = z.infer<typeof RunSchema>;

export const RenderedMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: JsonValueSchema,
});
export type RenderedMessage = z.infer<typeof RenderedMessageSchema>;

export const RunItemSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  itemId: IdSchema,
  revisionId: IdSchema,
  position: z.number().int(),
  status: RunItemStatusSchema,
  attempt: z.number().int(),
  input: JsonValueSchema,
  expected: JsonValueSchema.nullable(),
  renderedMessages: z.array(RenderedMessageSchema).nullable(),
  output: JsonValueSchema.nullable(),
  rawResponse: JsonValueSchema.nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  scores: z.array(ScoreSchema),
});
export type RunItem = z.infer<typeof RunItemSchema>;

export const ListRunsQuerySchema = PaginationQuerySchema.extend({
  datasetId: IdSchema.optional(),
  status: RunStatusSchema.optional(),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

export const ListRunItemsQuerySchema = PaginationQuerySchema.extend({
  status: RunItemStatusSchema.optional(),
  scorerKey: z
    .string()
    .optional()
    .describe("Only items that failed this scorer (passed=false, or score <= maxScore when given)"),
  maxScore: z.coerce.number().min(0).max(1).optional(),
});
export type ListRunItemsQuery = z.infer<typeof ListRunItemsQuerySchema>;

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    run: RunSchema,
  }),
  z.object({
    type: z.literal("item"),
    runId: IdSchema,
    runItemId: IdSchema,
    itemId: IdSchema,
    status: RunItemStatusSchema,
    completedItems: z.number().int(),
    failedItems: z.number().int(),
    totalItems: z.number().int(),
  }),
  z.object({
    type: z.literal("run"),
    runId: IdSchema,
    status: RunStatusSchema,
    error: z.string().nullable(),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
