import { beforeEach, describe, expect, it } from "vitest";
import { ListRunItemsQuerySchema, StartRunSchema } from "@llmeval/shared";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "../services/index.js";

describe("llm_judge scorer", () => {
  let s: Services;
  let factory: FakeModelFactory;
  let datasetId: string;
  beforeEach(async () => {
    factory = new FakeModelFactory();
    s = (
      await createTestContext(
        { JUDGE_MODEL: "anthropic:claude-haiku-4-5" },
        { modelFactory: factory },
      )
    ).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
    await s.items.add(datasetId, [
      { input: "Capital of France?", expected: "Paris" },
      { input: "Capital of Spain?", expected: "Madrid" },
    ]);
    factory.replyFor = (call) => {
      const isJudge =
        call.schema !== undefined && "rationale" in (call.schema.properties as object);
      if (isJudge) {
        const user = String(call.messages[1]!.content);
        const good = user.includes("Candidate output\nParis");
        return {
          output: {
            score: good ? 1 : 0.2,
            pass: good,
            rationale: good ? "Exact city." : "Wrong city.",
          },
          inputTokens: 100,
          outputTokens: 20,
        };
      }
      const q = String(call.messages[call.messages.length - 1]!.content);
      return {
        output: q.includes("France") ? "Paris" : "Barcelona",
        inputTokens: 5,
        outputTokens: 1,
      };
    };
  });

  it("grades outputs with a judge model, recording rationale, tokens and cost", async () => {
    const run = await s.runs.start(
      StartRunSchema.parse({
        datasetId,
        scorers: [
          {
            key: "judge",
            type: "llm_judge",
            config: { rubric: "City must match exactly.", passThreshold: 0.5 },
          },
        ],
      }),
    );
    await s.runs.wait(run.id);
    const items = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    const [good, bad] = items.map((i) => i.scores[0]!);
    expect(good).toMatchObject({
      score: 1,
      passed: true,
      rationale: "Exact city.",
      judgeModel: "anthropic:claude-haiku-4-5",
      judgeTokens: 120,
    });
    // haiku: 100 * $1/M + 20 * $5/M
    expect(good!.judgeCostUsd).toBeCloseTo(0.0002, 9);
    expect(bad).toMatchObject({ score: 0.2, passed: false, rationale: "Wrong city." });

    const judgeCalls = factory.calls.filter((c) => c.schema !== undefined);
    expect(judgeCalls).toHaveLength(2);
    expect(String(judgeCalls[0]!.messages[0]!.content)).toMatch(/impartial grader/);
    expect(String(judgeCalls[0]!.messages[1]!.content)).toMatch(
      /## Rubric\nCity must match exactly\./,
    );
    expect(judgeCalls[0]!.modelId).toBe("anthropic:claude-haiku-4-5");

    const agg = (await s.runs.get(run.id)).aggregates.scorers[0]!;
    expect(agg.meanScore).toBeCloseTo(0.6, 6);
    expect(agg.passRate).toBe(0.5);
  });

  it("records judge failures as scorer errors and honours a per-scorer model", async () => {
    const base = factory.replyFor;
    factory.replyFor = (call, i) =>
      call.schema ? { error: new Error("judge down") } : base(call, i);
    const run = await s.runs.start(
      StartRunSchema.parse({
        datasetId,
        scorers: [
          { key: "judge", type: "llm_judge", config: { model: "anthropic:claude-opus-5" } },
        ],
      }),
    );
    await s.runs.wait(run.id);
    const [first] = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(first!.scores[0]!.error).toBe("judge down");
    expect(factory.calls.find((c) => c.schema)!.modelId).toBe("anthropic:claude-opus-5");
    expect(s.scorers.list().find((x) => x.type === "llm_judge")!.usesLlm).toBe(true);
  });
});
