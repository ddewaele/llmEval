import { describe, expect, it } from "vitest";
import { createTestContext } from "@llmeval/core/test-utils";
import { SEED_MODEL, SEED_TAG, seedSampleData } from "./seed.js";
import { SeedModelFactory } from "./seed-model.js";

describe("seedSampleData", () => {
  it("creates datasets, versions, scored runs and a rescore job deterministically", async () => {
    const factory = new SeedModelFactory();
    const { services } = await createTestContext(
      { ALLOW_UNLISTED_MODELS: "true" },
      { modelFactory: factory },
    );
    const result = await seedSampleData(services, factory);
    expect(result.datasets.map((d) => d.name)).toEqual([
      "Email classification (sample)",
      "SAP product codes (sample)",
      "Review sentiment (sample)",
    ]);
    expect(result.runs).toHaveLength(4);

    const datasets = await services.datasets.list();
    expect(datasets.every((d) => d.tags.includes(SEED_TAG))).toBe(true);
    const sentiment = datasets.find((d) => d.name.startsWith("Review"))!;
    expect(sentiment.unreviewedGroundTruths).toBe(1);
    expect(sentiment.latestVersion).toBe(1);

    const [emailA, emailB] = result.runs;
    const a = await services.runs.get(emailA!.id);
    const b = await services.runs.get(emailB!.id);
    expect(a.status).toBe("completed");
    expect(a.config.model).toBe(SEED_MODEL);
    const exactA = a.aggregates.scorers.find((s) => s.key === "exact")!;
    const exactB = b.aggregates.scorers.find((s) => s.key === "exact")!;
    expect(exactA.passRate).toBe(0.875); // 7 of 8
    expect(exactB.passRate).toBe(0.625); // regressed variant: 5 of 8 (3 regressions, 1 improvement)
    expect(a.aggregates.scorers.find((s) => s.key === "judge")!.scoredCount).toBe(8);
    expect(a.inputTokens).toBeGreaterThan(0);

    const cmp = await services.compare.compare({
      a: emailA!.id,
      b: emailB!.id,
      onlyRegressions: false,
      limit: 50,
    });
    expect(cmp.summary.regressions).toBeGreaterThanOrEqual(3);

    const codesRun = await services.runs.get(result.runs[2]!.id);
    const overlap = codesRun.aggregates.scorers.find((s) => s.key === "codes")!;
    expect(overlap.scoredCount).toBe(6);
    expect(overlap.passedCount).toBe(4);

    const sentimentRun = await services.runs.get(result.runs[3]!.id);
    expect(sentimentRun.scorers.map((s) => s.key)).toEqual(["label", "confidence", "format"]);
    expect((await services.jobs$.get(result.jobs[0]!)).status).toBe("completed");

    // unpublished draft change exists on the email dataset
    const email = datasets.find((d) => d.name.startsWith("Email"))!;
    expect(await services.versions.hasUnpublishedChanges(email.id)).toBe(true);

    await expect(seedSampleData(services, factory)).rejects.toMatchObject({ code: "CONFLICT" });
    const again = await seedSampleData(services, factory, { reset: true });
    expect(again.datasets).toHaveLength(3);
    expect((await services.datasets.list()).filter((d) => d.tags.includes(SEED_TAG))).toHaveLength(
      3,
    );
  });
});
