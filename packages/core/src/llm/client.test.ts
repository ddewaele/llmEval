import { describe, expect, it } from "vitest";
import { LangChainChatModel, ModelTimeoutError } from "./client.js";

const msg = (content: string) => ({
  content,
  usage_metadata: { input_tokens: 3, output_tokens: 2 },
  response_metadata: {},
});
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

describe("LangChainChatModel timeout and cancellation handling", () => {
  it("returns text and usage on success", async () => {
    const m = new LangChainChatModel({ invoke: async () => msg("hello") }, "fake:one");
    const res = await m.invoke([{ role: "user", content: "hi" }], { timeoutMs: 1000 });
    expect(res.output).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2, cacheReadTokens: undefined });
  });

  it("turns an Ollama-style empty resolution after the deadline into a timeout error", async () => {
    // Ollama resolves with whatever it has (nothing) when the signal fires instead of throwing.
    const m = new LangChainChatModel(
      {
        invoke: async (_i, o) => {
          await wait(500, (o as { signal: AbortSignal }).signal);
          return msg("");
        },
      },
      "ollama:slow",
    );
    await expect(
      m.invoke([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ModelTimeoutError);
  });

  it("turns an abort-flavoured rejection caused by the deadline into a timeout error", async () => {
    const m = new LangChainChatModel(
      {
        invoke: async (_i, o) => {
          const signal = (o as { signal: AbortSignal }).signal;
          await wait(500, signal);
          throw Object.assign(new Error("The operation was aborted due to timeout"), {
            name: "TimeoutError",
          });
        },
      },
      "x:y",
    );
    await expect(
      m.invoke([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Timed out after 20 ms",
    });
  });

  it("reports a run cancellation as AbortError, not as a timeout", async () => {
    const controller = new AbortController();
    const m = new LangChainChatModel(
      {
        invoke: async (_i, o) => {
          await wait(500, (o as { signal: AbortSignal }).signal);
          return msg("");
        },
      },
      "x:y",
    );
    const p = m.invoke([{ role: "user", content: "hi" }], {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: "AbortError", message: "cancelled" });
  });

  it("passes provider errors through unchanged", async () => {
    const m = new LangChainChatModel(
      {
        invoke: async () => {
          throw Object.assign(new Error("rate limited"), { status: 429 });
        },
      },
      "x:y",
    );
    await expect(
      m.invoke([{ role: "user", content: "hi" }], { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
