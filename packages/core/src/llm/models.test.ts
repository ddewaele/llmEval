import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { ModelRegistry } from "./models.js";

describe("ModelRegistry", () => {
  it("reports availability from configured credentials", () => {
    const reg = new ModelRegistry(loadConfig({ ANTHROPIC_API_KEY: "k" }));
    const byProvider = Object.fromEntries(reg.list().map((m) => [m.id, m.available]));
    expect(byProvider["anthropic:claude-opus-5"]).toBe(true);
    expect(byProvider["openai:gpt-5"]).toBe(false);
    expect(byProvider["ollama:llama3.2"]).toBe(true);
  });

  it("merges extra models over built-ins", () => {
    const reg = new ModelRegistry(loadConfig({}), [
      {
        id: "openai:gpt-5",
        provider: "openai",
        displayName: "GPT-5",
        pricing: { inputPerMTok: 1, outputPerMTok: 2 },
        structuredOutput: true,
      },
    ]);
    expect(reg.get("openai:gpt-5")?.pricing).toEqual({ inputPerMTok: 1, outputPerMTok: 2 });
  });

  it("rejects unknown or unavailable models unless allowed", () => {
    const strict = new ModelRegistry(loadConfig({}));
    expect(() => strict.resolve("anthropic:claude-opus-5")).toThrow(/not configured/);
    expect(() => strict.resolve("mystery:model")).toThrow(/Unknown model/);
    expect(() => strict.resolve("nocolon")).toThrow(/provider:model/);
    const lax = new ModelRegistry(loadConfig({ ALLOW_UNLISTED_MODELS: "true" }));
    expect(lax.resolve("mystery:model").pricing).toBeNull();
  });
});
