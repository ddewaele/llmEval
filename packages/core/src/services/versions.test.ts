import { beforeEach, describe, expect, it } from "vitest";
import { PaginationQuerySchema } from "@llmeval/shared";
import { createTestContext } from "../test-utils.js";
import type { Services } from "./index.js";

describe("VersionService", () => {
  let s: Services;
  let datasetId: string;
  beforeEach(async () => {
    s = (await createTestContext()).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
  });

  it("publishes immutable versions and diffs them", async () => {
    const [a, b] = await s.items.add(datasetId, [
      { input: "a", expected: "1" },
      { input: "b", expected: "2" },
    ]);
    const v1 = await s.versions.publish(datasetId, { label: "first" });
    expect(v1.version.number).toBe(1);
    expect(v1.version.itemCount).toBe(2);
    expect(v1.warnings).toEqual([]);
    expect(await s.versions.hasUnpublishedChanges(datasetId)).toBe(false);

    // Same draft again is refused
    await expect(s.versions.publish(datasetId)).rejects.toMatchObject({ code: "CONFLICT" });

    // Edit one, delete one, add one → v2
    await s.items.update(a!.id, { input: "a-edited" });
    await s.items.delete([b!.id]);
    await s.items.add(datasetId, [{ input: "c" }]);
    expect(await s.versions.hasUnpublishedChanges(datasetId)).toBe(true);
    const v2 = await s.versions.publish(datasetId);
    expect(v2.version.number).toBe(2);
    expect(v2.warnings).toEqual(["1 item(s) have no ground truth"]);

    // v1 still has the original content
    const v1Items = await s.versions.allItems(datasetId, 1);
    expect(v1Items.map((i) => i.input)).toEqual(["a", "b"]);
    const v2Items = await s.versions.allItems(datasetId, 2);
    expect(v2Items.map((i) => i.input)).toEqual(["a-edited", "c"]);

    const diff = await s.versions.diff(datasetId, 1, 2);
    expect(diff.added.map((i) => i.input)).toEqual(["c"]);
    expect(diff.removed.map((i) => i.input)).toEqual(["b"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.from.input).toBe("a");
    expect(diff.changed[0]!.to.input).toBe("a-edited");
    expect(diff.unchanged).toBe(0);

    // draft equals v2 right now
    const pending = await s.versions.diff(datasetId, 2, "draft");
    expect(pending.added).toEqual([]);
    expect(pending.unchanged).toBe(2);

    expect((await s.versions.list(datasetId)).map((v) => v.number)).toEqual([2, 1]);
    expect((await s.datasets.get(datasetId)).latestVersion).toBe(2);
  });

  it("refuses to publish an empty draft and warns about unreviewed ground truths", async () => {
    await expect(s.versions.publish(datasetId)).rejects.toMatchObject({ code: "VALIDATION" });
    await s.items.add(datasetId, [{ input: "x", expected: "guess", expectedSource: "generated" }]);
    const res = await s.versions.publish(datasetId);
    expect(res.warnings[0]).toMatch(/not reviewed/);
    const [item] = await s.versions.allItems(datasetId, 1);
    expect(item!.expectedReviewed).toBe(false);
  });

  it("paginates version items and exports JSONL", async () => {
    await s.items.add(datasetId, [{ input: "1" }, { input: "2" }, { input: "3" }]);
    await s.versions.publish(datasetId);
    const p1 = await s.versions.listItems(datasetId, 1, PaginationQuerySchema.parse({ limit: 2 }));
    expect(p1.items.map((i) => i.input)).toEqual(["1", "2"]);
    const p2 = await s.versions.listItems(
      datasetId,
      1,
      PaginationQuerySchema.parse({ limit: 2, cursor: p1.nextCursor }),
    );
    expect(p2.items.map((i) => i.input)).toEqual(["3"]);
    expect(p2.nextCursor).toBeNull();

    const jsonl = await s.versions.exportJsonl(datasetId, 1);
    const lines = jsonl.split("\n").map((l) => JSON.parse(l) as { input: string });
    expect(lines.map((l) => l.input)).toEqual(["1", "2", "3"]);
    await expect(s.versions.get(datasetId, 9)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
