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

export const ModelPurposeSchema = z.enum(["default", "judge", "generation"]);
export type ModelPurpose = z.infer<typeof ModelPurposeSchema>;

export const DefaultModelInfoSchema = z.object({
  configured: z.string().describe("Value of DEFAULT_MODEL / JUDGE_MODEL / GENERATION_MODEL"),
  available: z.boolean().describe("Whether the configured model can be used right now"),
  effective: z
    .string()
    .nullable()
    .describe(
      "Model actually used when none is given: the configured one, or an available fallback",
    ),
  fallback: z.boolean().describe("True when effective differs from configured"),
});
export type DefaultModelInfo = z.infer<typeof DefaultModelInfoSchema>;

export const ModelCatalogSchema = z.object({
  models: z.array(AvailableModelSchema),
  defaults: z.object({
    default: DefaultModelInfoSchema,
    judge: DefaultModelInfoSchema,
    generation: DefaultModelInfoSchema,
  }),
  ollama: z.object({
    baseUrl: z.string(),
    reachable: z.boolean().nullable().describe("null until discovery has run"),
    installed: z.array(z.string()).describe("Model names reported by the Ollama server"),
  }),
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
