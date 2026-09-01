import { z } from "zod";
import type { JsonObject, RenderedMessage } from "@llmeval/shared";
import type { Config } from "../config.js";
import type { ChatModel, ChatModelFactory } from "../llm/client.js";
import type { ModelRegistry } from "../llm/models.js";
import { estimateCost } from "../llm/pricing.js";
import type { ScoreResult, Scorer } from "./types.js";

export const LlmJudgeConfig = z.object({
  model: z.string().optional().describe("Judge model as provider:model; defaults to JUDGE_MODEL"),
  rubric: z
    .string()
    .default(
      "Judge whether the output is correct and complete with respect to the expected answer. Minor wording differences are fine; missing or wrong facts are not.",
    )
    .describe("Grading instructions the judge must follow"),
  passThreshold: z.number().min(0).max(1).default(0.7),
  includeInput: z.boolean().default(true).describe("Show the original input to the judge"),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type LlmJudgeConfigType = z.infer<typeof LlmJudgeConfig>;

const VERDICT_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 1, description: "0 = wrong, 1 = fully correct" },
    pass: { type: "boolean" },
    rationale: { type: "string", description: "One or two sentences explaining the score" },
  },
  required: ["score", "pass", "rationale"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "You are an impartial grader for an LLM evaluation. Compare the candidate output with the expected answer strictly according to the rubric. " +
  "Do not solve the task yourself and do not reward style. Return only the requested JSON verdict.";

export interface LlmJudgeDeps {
  config: Config;
  models: ModelRegistry;
  factory: ChatModelFactory;
}

/** LLM-as-judge: asks a grader model for {score, pass, rationale} given input, expected and output. */
export function createLlmJudge(deps: LlmJudgeDeps): Scorer<LlmJudgeConfigType> {
  const cache = new Map<string, Promise<ChatModel>>();
  const modelFor = (id: string) => {
    let p = cache.get(id);
    if (!p) {
      p = deps.factory.create(id, { temperature: 0 });
      cache.set(id, p);
    }
    return p;
  };

  return {
    type: "llm_judge",
    description:
      "Asks a judge model to grade the output against the expected answer following a rubric; returns score 0-1, pass (score >= passThreshold) and a rationale. Costs one extra model call per item.",
    usesLlm: true,
    configSchema: LlmJudgeConfig,
    async score({ input, expected, output, config, signal }): Promise<ScoreResult> {
      const modelId = config.model ?? deps.config.JUDGE_MODEL;
      const info = deps.models.resolve(modelId);
      const model = await modelFor(info.id);
      const sections = [
        config.includeInput ? `## Input\n${fmt(input)}` : null,
        `## Expected answer\n${expected === null ? "(none provided; judge on the rubric alone)" : fmt(expected)}`,
        `## Candidate output\n${fmt(output)}`,
        `## Rubric\n${config.rubric}`,
        "Return JSON with score (0-1), pass (boolean) and rationale.",
      ].filter((s): s is string => s !== null);
      const messages: RenderedMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: sections.join("\n\n") },
      ];
      const res = await model.invokeStructured(messages, VERDICT_SCHEMA, {
        signal,
        timeoutMs: config.timeoutMs,
      });
      const verdict = parseVerdict(res.output);
      const score = Math.min(1, Math.max(0, verdict.score));
      const tokens = (res.usage?.inputTokens ?? 0) + (res.usage?.outputTokens ?? 0);
      const costUsd = res.usage ? estimateCost(info.pricing, res.usage) : null;
      return {
        score,
        passed: verdict.pass ?? score >= config.passThreshold,
        rationale: verdict.rationale,
        judge: { model: info.id, tokens, costUsd },
      };
    },
  };
}

function fmt(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function parseVerdict(v: unknown): { score: number; pass?: boolean; rationale: string } {
  const o = (typeof v === "string" ? safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.score !== "number") {
    throw new Error(`Judge returned an unexpected verdict: ${JSON.stringify(v).slice(0, 200)}`);
  }
  return {
    score: o.score,
    pass: typeof o.pass === "boolean" ? o.pass : undefined,
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
