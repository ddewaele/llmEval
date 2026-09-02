import { beforeEach, describe, expect, it } from "vitest";
import { GenerateItemsSchema, ListItemsQuerySchema } from "@llmeval/shared";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "./index.js";

describe("ItemGenerator.generateItems", () => {
  let s: Services;
  let factory: FakeModelFactory;
  let datasetId: string;
  beforeEach(async () => {
    factory = new FakeModelFactory();
    s = (await createTestContext({}, { modelFactory: factory })).services;
    datasetId = (
      await s.datasets.create({
        name: "ds",
        inputSchema: {
          type: "object",
          properties: { body: { type: "string" } },
          required: ["body"],
        },
      })
    ).id;
    await s.items.add(datasetId, [
      { input: { body: "Existing mail about ABC-1" }, expected: ["ABC-1"] },
    ]);
  });

  it("generates deduplicated synthetic items with generated ground truths until the count is reached", async () => {
    let round = 0;
    factory.replyFor = () => {
      round++;
      const mk = (n: number) => ({
        input: { body: `Mail ${n} about CODE-${n}` },
        expected: [`CODE-${n}`],
        rationale: `Mentions CODE-${n}`,
      });
      if (round === 1)
        return {
          output: {
            items: [
              mk(1),
              mk(2),
              { input: { body: "existing MAIL about abc-1" }, expected: ["dup"] },
              mk(2),
            ],
          },
          inputTokens: 1,
          outputTokens: 1,
        };
      return { output: { items: [mk(3), mk(4), mk(5)] }, inputTokens: 1, outputTokens: 1 };
    };
    const job = await s.itemGenerator.generateItems(
      GenerateItemsSchema.parse({
        datasetId,
        description: "Emails asking for SAP product codes",
        count: 4,
        batchSize: 4,
        tags: ["synthetic-v1"],
      }),
    );
    expect(job.kind).toBe("generate_items");
    await s.jobs$.wait(job.id);
    const done = await s.jobs$.get(job.id);
    expect(done.status).toBe("completed");
    expect(done.result).toMatchObject({
      generated: 4,
      duplicatesDropped: 2,
      rounds: 2,
      failedRounds: 0,
    });
    expect(done.progress).toMatchObject({ done: 4, total: 4 });

    const items = (await s.items.list(datasetId, ListItemsQuerySchema.parse({}))).items;
    expect(items).toHaveLength(5);
    const synthetic = items.filter((i) => i.metadata.source === "synthetic");
    expect(synthetic.map((i) => (i.input as { body: string }).body)).toEqual([
      "Mail 1 about CODE-1",
      "Mail 2 about CODE-2",
      "Mail 3 about CODE-3",
      "Mail 4 about CODE-4",
    ]);
    expect(synthetic[0]!.expected).toEqual(["CODE-1"]);
    expect(synthetic[0]!.expectedSource).toBe("generated");
    expect(synthetic[0]!.expectedModel).toBe("anthropic:claude-opus-5");
    expect(synthetic[0]!.expectedRationale).toBe("Mentions CODE-1");
    expect(synthetic[0]!.expectedReviewedAt).toBeNull();
    expect(synthetic[0]!.metadata.tags).toEqual(["synthetic-v1"]);
    expect(synthetic[0]!.metadata.jobId).toBe(job.id);

    const call = factory.calls[0]!;
    expect(String(call.messages[1]!.content)).toMatch(/## Dataset description\nEmails asking/);
    expect(String(call.messages[1]!.content)).toMatch(/## Input schema/);
    expect(String(call.messages[1]!.content)).toMatch(
      /## Example items\n- input: \{"body":"Existing mail about ABC-1"\}/,
    );
    expect(call.schema).toMatchObject({ properties: { items: { type: "array" } } });
    // second round lists the freshly generated inputs to avoid
    expect(String(factory.calls[1]!.messages[1]!.content)).toMatch(/Mail 1 about CODE-1/);
  });

  it("uses the dataset's generation brief when no description is given, and requires one otherwise", async () => {
    await expect(
      s.itemGenerator.generateItems(GenerateItemsSchema.parse({ datasetId, count: 1 })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await s.datasets.update(datasetId, { generationBrief: "Emails asking about SAP parts" });
    factory.replyFor = () => ({
      output: { items: [{ input: { body: "New mail" } }] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const job = await s.itemGenerator.generateItems(
      GenerateItemsSchema.parse({ datasetId, count: 1, withExpected: false }),
    );
    await s.jobs$.wait(job.id);
    expect((await s.jobs$.get(job.id)).params.description).toBe("Emails asking about SAP parts");
    expect(String(factory.calls[0]!.messages[1]!.content)).toMatch(
      /## Dataset description\nEmails asking about SAP parts/,
    );
    expect((await s.jobs$.list(datasetId)).map((j) => j.kind)).toEqual(["generate_items"]);
  });

  it("stops after repeated duplicate-only rounds and records failures", async () => {
    let round = 0;
    factory.replyFor = () => {
      round++;
      if (round === 1) return { error: new Error("boom") };
      return {
        output: { items: [{ input: { body: "Existing mail about ABC-1" }, expected: ["x"] }] },
        inputTokens: 1,
        outputTokens: 1,
      };
    };
    const job = await s.itemGenerator.generateItems(
      GenerateItemsSchema.parse({ datasetId, description: "d", count: 3, withExpected: false }),
    );
    await s.jobs$.wait(job.id);
    const done = await s.jobs$.get(job.id);
    expect(done.status).toBe("completed");
    expect(done.result).toMatchObject({
      generated: 0,
      duplicatesDropped: 3,
      rounds: 4,
      failedRounds: 1,
      errors: ["boom"],
    });
    expect((await s.datasets.get(datasetId)).draftItemCount).toBe(1);
  });
});
