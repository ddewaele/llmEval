import { z } from "zod";

export const ModelPricingSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  cacheReadPerMTok: z.number().nonnegative().optional(),
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelInfoSchema = z.object({
  /** LangChain-style "provider:model" id, e.g. "anthropic:claude-opus-5". */
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  pricing: ModelPricingSchema.nullable().describe("USD per million tokens; null when unknown"),
  structuredOutput: z.boolean(),
  notes: z.string().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const AvailableModelSchema = ModelInfoSchema.extend({
  available: z.boolean().describe("Whether the provider credentials/endpoint are configured"),
});
export type AvailableModel = z.infer<typeof AvailableModelSchema>;
