import { z } from "zod";
import { IdSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";

export const GenerateGroundTruthsSchema = z.object({
  datasetId: IdSchema,
  itemIds: z
    .array(IdSchema)
    .min(1)
    .max(5000)
    .optional()
    .describe("Items to generate for. Default: every draft item without a ground truth"),
  instructions: z
    .string()
    .max(20_000)
    .optional()
    .describe("Task description for the generator, e.g. what a correct answer looks like"),
  model: z.string().optional().describe("provider:model; defaults to GENERATION_MODEL"),
  outputSchema: JsonObjectSchema.optional().describe(
    "JSON Schema the generated `expected` must match (e.g. {type:'object', properties:{productCodes:{type:'array'}}}). Default: free text",
  ),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Also regenerate items that already have a ground truth (only with itemIds)"),
  concurrency: z.number().int().min(1).max(16).default(4),
});
export type GenerateGroundTruths = z.infer<typeof GenerateGroundTruthsSchema>;

export const GenerationResultSchema = z.object({
  generated: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ itemId: IdSchema, message: z.string() })),
});
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

export const GenerateItemsSchema = z.object({
  datasetId: IdSchema,
  description: z
    .string()
    .min(1)
    .max(20_000)
    .describe("What the dataset tests: the task, the kind of inputs, edge cases to cover"),
  count: z.number().int().min(1).max(500).default(20).describe("How many new items to produce"),
  seedItemIds: z
    .array(IdSchema)
    .max(50)
    .optional()
    .describe("Existing items to show the generator as examples (few-shot)"),
  inputSchema: JsonObjectSchema.optional().describe(
    "JSON Schema for each generated input; defaults to the dataset's inputSchema, else free text",
  ),
  withExpected: z
    .boolean()
    .default(true)
    .describe("Also draft a ground truth per item (stored as generated / unreviewed)"),
  expectedSchema: JsonObjectSchema.optional().describe("JSON Schema for generated expected values"),
  model: z.string().optional().describe("provider:model; defaults to GENERATION_MODEL"),
  tags: z.array(z.string().min(1)).optional().describe("Tags added to every generated item"),
  batchSize: z.number().int().min(1).max(50).default(10).describe("Items requested per model call"),
});
export type GenerateItems = z.infer<typeof GenerateItemsSchema>;

export const ItemGenerationResultSchema = z.object({
  generated: z.number().int(),
  duplicatesDropped: z.number().int(),
  rounds: z.number().int(),
  failedRounds: z.number().int(),
  errors: z.array(z.string()),
  itemIds: z.array(IdSchema),
});
export type ItemGenerationResult = z.infer<typeof ItemGenerationResultSchema>;
