import { beforeEach, describe, expect, it } from "vitest";
import { CompareRunsQuerySchema, StartRunSchema } from "@llmeval/shared";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "./index.js";

describe("CompareService", () => {
  let s: Services;
  let factory: FakeModelFactory;
  let datasetId: string;
  beforeEach(async () => {
    factory = new FakeModelFactory();
    s = (await createTestContext({}, { modelFactory: factory })).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
    await s.items.add(datasetId, [
      { input: "q1", expected: "a1" },
      { input: "q2", expected: "a2" },
      { input: "q3", expected: "a3" },
    ]);
  });

  async function runWith(answers: Record<string, string>) {
    factory.replyFor = (call) => ({
      output: answers[String(call.messages[0]!.content)] ?? "?",
      inputTokens: 1,
      outputTokens: 1,
    });
    const run = await s.runs.start(
      StartRunSchema.parse({ datasetId, scorers: [{ key: "exact", type: "exact_match" }] }),
    );
    await s.runs.wait(run.id);
    return run.id;
  }

  it("reports per-item deltas, regressions, improvements and aggregate deltas", async () => {
    const a = await runWith({ q1: "a1", q2: "a2", q3: "wrong" });
    const b = await runWith({ q1: "a1", q2: "wrong", q3: "a3" });
    const cmp = await s.compare.compare(CompareRunsQuerySchema.parse({ a, b }));
    expect(cmp.sameVersion).toBe(true);
    expect(cmp.summary).toEqual({
      compared: 3,
      regressions: 1,
      improvements: 1,
      onlyInA: 0,
      onlyInB: 0,
    });
    expect(cmp.items.map((i) => [i.position, i.deltas.exact, i.regression, i.improvement])).toEqual(
      [
        [1, 0, false, false],
        [2, -1, true, false],
        [3, 1, false, true],
      ],
    );
    expect(cmp.items[1]!.a!.output).toBe("a2");
    expect(cmp.items[1]!.b!.output).toBe("wrong");
    expect(cmp.aggregateDeltas).toEqual([
      {
        key: "exact",
        meanScoreA: 0.6667,
        meanScoreB: 0.6667,
        meanScoreDelta: 0,
        passRateA: 0.6667,
        passRateB: 0.6667,
        passRateDelta: 0,
      },
    ]);
    expect(cmp.costDeltaUsd).toBe(0);

    const only = await s.compare.compare(
      CompareRunsQuerySchema.parse({ a, b, onlyRegressions: "true" }),
    );
    expect(only.items.map((i) => i.position)).toEqual([2]);
    expect(only.summary.regressions).toBe(1);
  });

  it("handles items present in only one run across versions", async () => {
    const a = await runWith({ q1: "a1", q2: "a2", q3: "a3" });
    await s.items.add(datasetId, [{ input: "q4", expected: "a4" }]);
    const b = await runWith({ q1: "a1", q2: "a2", q3: "a3", q4: "a4" });
    const cmp = await s.compare.compare(CompareRunsQuerySchema.parse({ a, b }));
    expect(cmp.sameVersion).toBe(false);
    expect(cmp.summary.onlyInB).toBe(1);
    expect(cmp.items[3]!.a).toBeNull();
    expect(cmp.items[3]!.input).toBe("q4");
    await expect(
      s.compare.compare(CompareRunsQuerySchema.parse({ a, b: a })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
