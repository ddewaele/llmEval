import { describe, expect, it } from "vitest";
import { estimateCost } from "./pricing.js";

describe("estimateCost", () => {
  it("prices fresh input, cache reads and output separately", () => {
    const pricing = { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 };
    expect(estimateCost(pricing, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(5);
    expect(
      estimateCost(pricing, {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 500_000,
      }),
    ).toBe(2.5 + 0.25 + 2.5);
  });
  it("returns null without pricing", () => {
    expect(estimateCost(null, { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
