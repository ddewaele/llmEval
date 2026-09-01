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
