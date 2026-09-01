import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { JsonObject, ModelParams, RenderedMessage } from "@llmeval/shared";
import { loadConfig, type Config } from "./config.js";
import { openDatabase, type Db } from "./db/client.js";
import type { ChatModel, ChatModelFactory, InvokeOptions, ModelResponse } from "./llm/client.js";
import { createServices, type CreateServicesOptions, type Services } from "./services/index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/**
 * Fresh SQLite database in a temp file per test. Not `:memory:`: the libsql local client
 * opens a separate connection for transactions, and every `:memory:` connection is its own
 * empty database.
 */
export async function createTestContext(
  env: Record<string, string> = {},
  opts: Omit<CreateServicesOptions, "config"> = {},
): Promise<{ db: Db; services: Services; config: Config }> {
  const config = loadConfig({ ANTHROPIC_API_KEY: "test-key", ...env });
  const dir = mkdtempSync(join(tmpdir(), "llmeval-test-"));
  const { db, client } = await openDatabase({ path: join(dir, "test.sqlite") });
  cleanups.push(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const services = createServices(db, {
    config,
    modelFiles: [],
    modelFactory: opts.modelFactory ?? new FakeModelFactory(),
    engine: { backoffMs: 1, defaultTimeoutMs: 5_000, ...opts.engine },
    ...opts,
  });
  return { db, services, config };
}

export type FakeReply =
  | { output: unknown; inputTokens?: number; outputTokens?: number }
  | { error: Error }
  | { hang: true };

export interface FakeCall {
  messages: RenderedMessage[];
  schema?: JsonObject;
  modelId: string;
}

/**
 * Scripted model: `replyFor` decides the response per call (default: echoes the last user
 * message). Records every call for assertions.
 */
export class FakeModelFactory implements ChatModelFactory {
  calls: FakeCall[] = [];
  replyFor: (call: FakeCall, index: number) => FakeReply = (call) => ({
    output: `echo: ${String(call.messages[call.messages.length - 1]?.content ?? "")}`,
    inputTokens: 10,
    outputTokens: 5,
  });

  async create(modelId: string, _params: ModelParams): Promise<ChatModel> {
    const respond = async (
      messages: RenderedMessage[],
      schema: JsonObject | undefined,
      options: InvokeOptions,
    ): Promise<ModelResponse> => {
      const call: FakeCall = { messages, schema, modelId };
      const index = this.calls.push(call) - 1;
      const reply = this.replyFor(call, index);
      if ("hang" in reply) {
        await new Promise<void>((_, reject) => {
          const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (options.signal?.aborted) onAbort();
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      if ("error" in reply) throw reply.error;
      const r = reply as { output: unknown; inputTokens?: number; outputTokens?: number };
      return {
        output: r.output,
        usage:
          r.inputTokens === undefined
            ? null
            : { inputTokens: r.inputTokens, outputTokens: r.outputTokens ?? 0 },
        raw: { modelId, fake: true },
      };
    };
    return {
      invoke: (m, o = {}) => respond(m, undefined, o),
      invokeStructured: (m, s, o = {}) => respond(m, s, o),
    };
  }
}
