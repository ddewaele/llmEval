import type { ModelPricing } from "@llmeval/shared";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

/** USD cost estimate, or null when pricing is unknown. Never guesses. */
export function estimateCost(
  pricing: ModelPricing | null | undefined,
  usage: TokenUsage,
): number | null {
  if (!pricing) return null;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cacheRead);
  const cacheRate = pricing.cacheReadPerMTok ?? pricing.inputPerMTok;
  const cost =
    (freshInput * pricing.inputPerMTok +
      cacheRead * cacheRate +
      usage.outputTokens * pricing.outputPerMTok) /
    1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
