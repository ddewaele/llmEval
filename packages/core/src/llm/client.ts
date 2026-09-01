import type { JsonObject, ModelParams, RenderedMessage } from "@llmeval/shared";
import type { Config } from "../config.js";
import type { TokenUsage } from "./pricing.js";

export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ModelResponse {
  /** Text output, or the parsed object when an output schema was given. */
  output: unknown;
  usage: TokenUsage | null;
  /** Provider metadata worth keeping (trimmed). */
  raw: JsonObject;
}

/** The only surface the engine needs from a chat model; LangChain models are adapted to it. */
export interface ChatModel {
  invoke(messages: RenderedMessage[], options?: InvokeOptions): Promise<ModelResponse>;
  invokeStructured(
    messages: RenderedMessage[],
    schema: JsonObject,
    options?: InvokeOptions,
  ): Promise<ModelResponse>;
}

export interface ChatModelFactory {
  create(modelId: string, params: ModelParams): Promise<ChatModel>;
}

type LcMessage = { role: string; content: unknown };
type LcAiMessage = {
  content: unknown;
  text?: string;
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { cache_read?: number };
  };
  response_metadata?: Record<string, unknown>;
};
type LcRunnable = {
  invoke(input: LcMessage[], options?: Record<string, unknown>): Promise<unknown>;
};
type LcChatModel = LcRunnable & {
  withStructuredOutput(schema: unknown, options?: Record<string, unknown>): LcRunnable;
};

/** Builds LangChain chat models via initChatModel from "provider:model" ids. */
export class LangChainModelFactory implements ChatModelFactory {
  constructor(private readonly config: Config) {}

  async create(modelId: string, params: ModelParams): Promise<ChatModel> {
    const { initChatModel } = await import("langchain/chat_models/universal");
    const { timeoutMs: _timeout, maxTokens, ...rest } = params;
    const provider = modelId.split(":")[0];
    const fields: Record<string, unknown> = { ...rest, maxRetries: 0 };
    if (maxTokens !== undefined) fields.maxTokens = maxTokens;
    if (provider === "ollama") fields.baseUrl = this.config.OLLAMA_BASE_URL;
    if (provider === "anthropic" && this.config.ANTHROPIC_API_KEY)
      fields.apiKey = this.config.ANTHROPIC_API_KEY;
    if (provider === "openai" && this.config.OPENAI_API_KEY)
      fields.apiKey = this.config.OPENAI_API_KEY;
    const model = (await initChatModel(modelId, fields)) as unknown as LcChatModel;
    return new LangChainChatModel(model, modelId);
  }
}

class LangChainChatModel implements ChatModel {
  constructor(
    private readonly model: LcChatModel,
    private readonly modelId: string,
  ) {}

  async invoke(messages: RenderedMessage[], options: InvokeOptions = {}): Promise<ModelResponse> {
    const ai = (await this.model.invoke(toLc(messages), callOptions(options))) as LcAiMessage;
    return { output: messageText(ai), usage: usageOf(ai), raw: rawOf(ai, this.modelId) };
  }

  async invokeStructured(
    messages: RenderedMessage[],
    schema: JsonObject,
    options: InvokeOptions = {},
  ): Promise<ModelResponse> {
    const structured = this.model.withStructuredOutput(schema, { includeRaw: true });
    const res = (await structured.invoke(toLc(messages), callOptions(options))) as {
      raw: LcAiMessage;
      parsed: unknown;
    };
    return { output: res.parsed, usage: usageOf(res.raw), raw: rawOf(res.raw, this.modelId) };
  }
}

function toLc(messages: RenderedMessage[]): LcMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function callOptions(o: InvokeOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (o.signal) out.signal = o.signal;
  if (o.timeoutMs) out.timeout = o.timeoutMs;
  return out;
}

export function messageText(ai: LcAiMessage): string {
  if (typeof ai.content === "string") return ai.content;
  if (typeof ai.text === "string") return ai.text;
  if (Array.isArray(ai.content)) {
    return ai.content
      .map((b) =>
        b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

function usageOf(ai: LcAiMessage): TokenUsage | null {
  const u = ai.usage_metadata;
  if (!u || (u.input_tokens === undefined && u.output_tokens === undefined)) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.input_token_details?.cache_read,
  };
}

function rawOf(ai: LcAiMessage, modelId: string): JsonObject {
  const meta = ai.response_metadata ?? {};
  const keep: JsonObject = { modelId };
  for (const k of ["model", "model_name", "id", "stop_reason", "finish_reason", "stop_details"]) {
    if (k in meta && meta[k] !== undefined) keep[k] = meta[k] as JsonObject[string];
  }
  return keep;
}
