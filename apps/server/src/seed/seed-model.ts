import type { ChatModel, ChatModelFactory, InvokeOptions, ModelResponse } from "@llmeval/core";
import type { JsonObject, JsonValue, RenderedMessage } from "@llmeval/shared";

/** One scripted answer: which input it belongs to (substring of the rendered prompt) and what to say. */
export interface ScriptedAnswer {
  match: string;
  good: JsonValue;
  regressed: JsonValue;
}

/**
 * Deterministic stand-in for a chat model, used to seed realistic runs without calling a provider.
 * Task calls are answered from a script keyed by a substring of the prompt; judge calls compare the
 * expected and candidate sections of the judge prompt and return a verdict.
 */
export class SeedModelFactory implements ChatModelFactory {
  variant: "good" | "regressed" = "good";
  private readonly answers: ScriptedAnswer[] = [];

  script(answers: ScriptedAnswer[]): void {
    this.answers.push(...answers);
  }

  async create(modelId: string): Promise<ChatModel> {
    const respond = async (
      messages: RenderedMessage[],
      schema: JsonObject | undefined,
      _options: InvokeOptions,
    ): Promise<ModelResponse> => {
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 60)));
      const prompt = messages
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");
      const output = isJudgeCall(schema, prompt) ? judge(prompt) : this.answer(prompt, schema);
      const outText = typeof output === "string" ? output : JSON.stringify(output);
      return {
        output,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(outText.length / 4),
        },
        raw: { modelId, seeded: true },
      };
    };
    return {
      invoke: (m, o = {}) => respond(m, undefined, o),
      invokeStructured: (m, s, o = {}) => respond(m, s, o),
    };
  }

  private answer(prompt: string, schema: JsonObject | undefined): JsonValue {
    const hit = this.answers.find((a) => prompt.includes(a.match));
    if (hit) return this.variant === "good" ? hit.good : hit.regressed;
    return schema ? {} : "I am not sure.";
  }
}

function isJudgeCall(schema: JsonObject | undefined, prompt: string): boolean {
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  return "rationale" in props && prompt.includes("## Candidate output");
}

function judge(prompt: string): JsonValue {
  const expected = section(prompt, "## Expected answer");
  const candidate = section(prompt, "## Candidate output");
  const same = normalise(expected) === normalise(candidate);
  return same
    ? { score: 1, pass: true, rationale: "The candidate output matches the expected answer." }
    : {
        score: 0.2,
        pass: false,
        rationale: `The candidate output differs from the expected answer (expected ${expected.slice(0, 60)}, got ${candidate.slice(0, 60)}).`,
      };
}

function section(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  if (start < 0) return "";
  const body = prompt.slice(start + heading.length);
  const end = body.indexOf("\n## ");
  return (end < 0 ? body : body.slice(0, end)).trim();
}

function normalise(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s.trim().toLowerCase();
  }
}
