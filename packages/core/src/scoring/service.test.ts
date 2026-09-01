import { beforeEach, describe, expect, it } from "vitest";
import { ListRunItemsQuerySchema, StartRunSchema } from "@llmeval/shared";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "../services/index.js";

describe("scoring during and after runs", () => {
  let s: Services;
  let factory: FakeModelFactory;
  let datasetId: string;
  beforeEach(async () => {
    factory = new FakeModelFactory();
    s = (await createTestContext({}, { modelFactory: factory })).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
    await s.items.add(datasetId, [
      { input: { body: "Need ABC-1 and DEF-2" }, expected: { productCodes: ["ABC-1", "DEF-2"] } },
      { input: { body: "Need XYZ-9" }, expected: { productCodes: ["XYZ-9"] } },
      { input: { body: "Nothing here" }, expected: { productCodes: [] } },
    ]);
    factory.replyFor = (call) => {
      const text = JSON.stringify(call.messages);
      if (text.includes("ABC-1"))
        return { output: { productCodes: ["ABC-1"] }, inputTokens: 1, outputTokens: 1 };
      if (text.includes("XYZ-9"))
        return { output: { productCodes: ["XYZ-9"] }, inputTokens: 1, outputTokens: 1 };
      return { output: { productCodes: ["HALLUCINATED"] }, inputTokens: 1, outputTokens: 1 };
    };
  });

  it("scores items inline and aggregates per scorer", async () => {
    const run = await s.runs.start(
      StartRunSchema.parse({
        datasetId,
        userTemplate: "{{body}}",
        outputSchema: { type: "object" },
        scorers: [
          { key: "codes", type: "set_overlap", config: { path: "productCodes", passThreshold: 1 } },
          { key: "strict", type: "json_equal" },
        ],
      }),
    );
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    const codes = done.aggregates.scorers.find((a) => a.key === "codes")!;
    expect(codes.scoredCount).toBe(3);
    expect(codes.passedCount).toBe(1);
    expect(codes.passRate).toBeCloseTo(1 / 3, 4);
    // F1 values: 0.6667, 1, 0 → mean 0.5556
    expect(codes.meanScore).toBeCloseTo(0.5556, 3);
    const strict = done.aggregates.scorers.find((a) => a.key === "strict")!;
    expect(strict.passRate).toBeCloseTo(1 / 3, 4);
    expect(done.aggregates.latency.p50Ms).not.toBeNull();

    const items = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(items[0]!.scores.map((sc) => sc.scorerKey)).toEqual(["codes", "strict"]);
    expect(items[0]!.scores[0]!.details).toMatchObject({ missing: ["def-2"] });

    const failing = await s.runs.listItems(
      run.id,
      ListRunItemsQuerySchema.parse({ scorerKey: "codes" }),
    );
    expect(failing.items.map((i) => i.position)).toEqual([1, 3]);
    const low = await s.runs.listItems(
      run.id,
      ListRunItemsQuerySchema.parse({ scorerKey: "codes", maxScore: 0.1 }),
    );
    expect(low.items.map((i) => i.position)).toEqual([3]);
  });

  it("re-scores an existing run with a new scorer without re-executing, and can overwrite", async () => {
    const run = await s.runs.start(
      StartRunSchema.parse({
        datasetId,
        userTemplate: "{{body}}",
        outputSchema: { type: "object" },
      }),
    );
    await s.runs.wait(run.id);
    const callsAfterRun = factory.calls.length;

    const job = await s.scoring.scoreRun(run.id, {
      key: "codes",
      type: "set_overlap",
      config: { path: "productCodes" },
    });
    expect(job.kind).toBe("rescore");
    await s.jobs$.wait(job.id);
    const finished = await s.jobs$.get(job.id);
    expect(finished.status).toBe("completed");
    expect(finished.progress).toEqual({ done: 3, total: 3 });
    expect(factory.calls).toHaveLength(callsAfterRun);

    const after = await s.runs.get(run.id);
    expect(after.scorers.map((sc) => sc.key)).toEqual(["codes"]);
    expect(after.aggregates.scorers[0]!.scoredCount).toBe(3);

    await expect(
      s.scoring.scoreRun(run.id, { key: "codes", type: "exact_match", config: {} }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const job2 = await s.scoring.scoreRun(
      run.id,
      { key: "codes", type: "exact_match", config: {} },
      { overwrite: true },
    );
    await s.jobs$.wait(job2.id);
    const again = await s.runs.get(run.id);
    expect(again.scorers[0]!.type).toBe("exact_match");
    const items = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(
      items.every((i) => i.scores.length === 1 && i.scores[0]!.scorerType === "exact_match"),
    ).toBe(true);
  });

  it("records scorer errors per item without failing the run", async () => {
    const run = await s.runs.start(
      StartRunSchema.parse({
        datasetId,
        scorers: [{ key: "bad", type: "regex", config: { pattern: "(" } }],
      }),
    );
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    expect(done.aggregates.scorers[0]!.errorCount).toBe(3);
    const [first] = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(first!.scores[0]!.error).toMatch(/Invalid regular expression/);
  });
});
