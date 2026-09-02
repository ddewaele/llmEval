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

  it("discovers installed Ollama models and scopes availability to them", async () => {
    const reg = new ModelRegistry(loadConfig({}));
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:latest" }] }),
      )) as typeof fetch;
    const res = await reg.discoverOllama({ fetch: fakeFetch });
    expect(res).toEqual({ reachable: true, installed: ["qwen2.5:7b", "llama3.1:latest"] });
    expect(reg.get("ollama:qwen2.5:7b")).toMatchObject({
      available: true,
      provider: "ollama",
      pricing: { inputPerMTok: 0 },
    });
    expect(reg.get("ollama:llama3.2")?.available).toBe(false); // built-in but not installed
    expect(() => reg.resolve("ollama:llama3.2")).toThrow(
      /not installed in Ollama \(ollama pull llama3.2\)/,
    );

    const down = new ModelRegistry(loadConfig({}));
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await down.discoverOllama({ fetch: failing })).toEqual({
      reachable: false,
      installed: [],
    });
    expect(down.get("ollama:llama3.2")?.available).toBe(false);
    expect(down.catalog().ollama.reachable).toBe(false);
  });

  it("falls back to an available local model when the configured default has no key", async () => {
    const reg = new ModelRegistry(loadConfig({}));
    await reg.discoverOllama({
      fetch: (async () =>
        new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }))) as typeof fetch,
    });
    const d = reg.catalog().defaults;
    expect(d.generation).toEqual({
      configured: "anthropic:claude-opus-5",
      available: false,
      effective: "ollama:qwen2.5:7b",
      fallback: true,
    });
    expect(reg.resolveDefault("generation").id).toBe("ollama:qwen2.5:7b");

    const withKey = new ModelRegistry(loadConfig({ ANTHROPIC_API_KEY: "k" }));
    expect(withKey.defaultInfo("judge")).toMatchObject({
      available: true,
      effective: "anthropic:claude-opus-5",
      fallback: false,
    });

    const nothing = new ModelRegistry(loadConfig({}));
    await nothing.discoverOllama({
      fetch: (async () => {
        throw new Error("down");
      }) as typeof fetch,
    });
    expect(() => nothing.resolveDefault("default")).toThrow(
      /DEFAULT_MODEL=anthropic:claude-opus-5 is not usable .*no other model is available/,
    );
  });

  it("rejects unknown or unavailable models unless allowed", () => {
    const strict = new ModelRegistry(loadConfig({}));
    expect(() => strict.resolve("anthropic:claude-opus-5")).toThrow(
      /ANTHROPIC_API_KEY is not set. Available models: ollama:llama3.2/,
    );
    expect(() => strict.resolve("mystery:model")).toThrow(/Unknown model/);
    expect(() => strict.resolve("nocolon")).toThrow(/provider:model/);
    const lax = new ModelRegistry(loadConfig({ ALLOW_UNLISTED_MODELS: "true" }));
    expect(lax.resolve("mystery:model").pricing).toBeNull();
  });
});
