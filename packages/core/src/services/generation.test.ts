import { beforeEach, describe, expect, it } from "vitest";
import { GenerateGroundTruthsSchema, ListItemsQuerySchema } from "@llmeval/shared";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "./index.js";

describe("GenerationService.generateGroundTruths", () => {
  let s: Services;
  let factory: FakeModelFactory;
  let datasetId: string;
  beforeEach(async () => {
    factory = new FakeModelFactory();
    s = (
      await createTestContext(
        { GENERATION_MODEL: "anthropic:claude-sonnet-5" },
        { modelFactory: factory },
      )
    ).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
    await s.items.add(datasetId, [
      { input: { body: "Need ABC-1" } },
      { input: { body: "Need XYZ-9" } },
      { input: { body: "already has one" }, expected: { productCodes: ["KEEP"] } },
    ]);
    factory.replyFor = (call) => {
      const text = String(call.messages[1]!.content);
      if (text.includes("XYZ-9")) return { error: new Error("model exploded") };
      const code = text.includes("ABC-1") ? "ABC-1" : "OTHER";
      return {
        output: { expected: { productCodes: [code] }, rationale: `Found ${code} in the text.` },
        inputTokens: 5,
        outputTokens: 5,
      };
    };
  });

  it("fills missing ground truths with provenance, leaves existing ones, records failures", async () => {
    const job = await s.generation.generateGroundTruths(
      GenerateGroundTruthsSchema.parse({
        datasetId,
        instructions: "Extract SAP product codes.",
        outputSchema: {
          type: "object",
          properties: { productCodes: { type: "array", items: { type: "string" } } },
          required: ["productCodes"],
        },
      }),
    );
    expect(job.kind).toBe("generate_ground_truths");
    await s.jobs$.wait(job.id);
    const done = await s.jobs$.get(job.id);
    expect(done.status).toBe("completed");
    expect(done.result).toMatchObject({ generated: 1, failed: 1, skipped: 1 });
    expect((done.result as { errors: Array<{ message: string }> }).errors[0]!.message).toBe(
      "model exploded",
    );
    expect(done.progress).toEqual({ done: 2, total: 2, failed: 1 });

    const items = (await s.items.list(datasetId, ListItemsQuerySchema.parse({}))).items;
    expect(items[0]!.expected).toEqual({ productCodes: ["ABC-1"] });
    expect(items[0]!.expectedSource).toBe("generated");
    expect(items[0]!.expectedModel).toBe("anthropic:claude-sonnet-5");
    expect(items[0]!.expectedRationale).toBe("Found ABC-1 in the text.");
    expect(items[0]!.expectedReviewedAt).toBeNull();
    expect(items[1]!.expected).toBeNull();
    expect(items[2]!.expected).toEqual({ productCodes: ["KEEP"] });
    expect((await s.datasets.get(datasetId)).unreviewedGroundTruths).toBe(1);

    const call = factory.calls[0]!;
    expect(String(call.messages[0]!.content)).toMatch(/reference answer/);
    expect(String(call.messages[1]!.content)).toMatch(
      /## Task instructions\nExtract SAP product codes\./,
    );
    expect(call.schema).toMatchObject({
      properties: { expected: { type: "object" }, rationale: { type: "string" } },
    });

    // Review flow: approve, then publish without warning about unreviewed truths
    await s.items.review([items[0]!.id], true);
    expect((await s.items.get(items[0]!.id)).expectedReviewedAt).not.toBeNull();
    const pub = await s.versions.publish(datasetId);
    expect(pub.warnings).toEqual(["1 item(s) have no ground truth"]);
  });

  it("regenerates listed items only with overwrite and validates the model", async () => {
    const items = (await s.items.list(datasetId, ListItemsQuerySchema.parse({}))).items;
    const keep = items[2]!;
    const noOverwrite = await s.generation.generateGroundTruths(
      GenerateGroundTruthsSchema.parse({ datasetId, itemIds: [keep.id] }),
    );
    await s.jobs$.wait(noOverwrite.id);
    expect((await s.jobs$.get(noOverwrite.id)).result).toMatchObject({ generated: 0, skipped: 1 });

    const overwrite = await s.generation.generateGroundTruths(
      GenerateGroundTruthsSchema.parse({ datasetId, itemIds: [keep.id], overwrite: true }),
    );
    await s.jobs$.wait(overwrite.id);
    expect((await s.items.get(keep.id)).expected).toEqual({ productCodes: ["OTHER"] });
    expect((await s.items.get(keep.id)).expectedSource).toBe("generated");

    await expect(
      s.generation.generateGroundTruths(
        GenerateGroundTruthsSchema.parse({ datasetId, model: "openai:gpt-5" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
