import { beforeEach, describe, expect, it } from "vitest";
import { ListItemsQuerySchema } from "@llmeval/shared";
import { createTestContext } from "../test-utils.js";
import type { Services } from "./index.js";

const q = (extra: Record<string, unknown> = {}) => ListItemsQuerySchema.parse(extra);

describe("ItemService", () => {
  let s: Services;
  let datasetId: string;
  beforeEach(async () => {
    s = (await createTestContext()).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
  });

  it("adds items in order with defaults", async () => {
    const added = await s.items.add(datasetId, [
      { input: "one", expected: "1" },
      { input: { q: "two" }, metadata: { tags: ["t"], source: "imported" } },
    ]);
    expect(added.map((i) => i.position)).toEqual([1, 2]);
    expect(added[0]!.expectedSource).toBe("human");
    expect(added[0]!.expectedReviewedAt).not.toBeNull();
    expect(added[1]!.expected).toBeNull();
    expect(added[1]!.expectedSource).toBeNull();
    expect(added[1]!.metadata).toEqual({ tags: ["t"], source: "imported" });
    expect((await s.datasets.get(datasetId)).draftItemCount).toBe(2);
  });

  it("paginates with a stable cursor", async () => {
    await s.items.add(
      datasetId,
      Array.from({ length: 5 }, (_, i) => ({ input: `i${i}` })),
    );
    const p1 = await s.items.list(datasetId, q({ limit: 2 }));
    expect(p1.items.map((i) => i.input)).toEqual(["i0", "i1"]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await s.items.list(datasetId, q({ limit: 2, cursor: p1.nextCursor }));
    expect(p2.items.map((i) => i.input)).toEqual(["i2", "i3"]);
    const p3 = await s.items.list(datasetId, q({ limit: 2, cursor: p2.nextCursor }));
    expect(p3.items.map((i) => i.input)).toEqual(["i4"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("filters by missing expected, tag and search", async () => {
    await s.items.add(datasetId, [
      { input: "alpha", expected: "a", metadata: { tags: ["x"] } },
      { input: "beta" },
    ]);
    expect((await s.items.list(datasetId, q({ filter: "missing_expected" }))).items).toHaveLength(
      1,
    );
    expect((await s.items.list(datasetId, q({ tag: "x" }))).items[0]!.input).toBe("alpha");
    expect((await s.items.list(datasetId, q({ search: "bet" }))).items[0]!.input).toBe("beta");
  });

  it("creates a new revision on edit and keeps the old one", async () => {
    const [item] = await s.items.add(datasetId, [{ input: "v1" }]);
    const edited = await s.items.update(item!.id, { input: "v2" });
    expect(edited.revisionId).not.toBe(item!.revisionId);
    expect(edited.input).toBe("v2");
    // no-op edit keeps the revision
    const same = await s.items.update(item!.id, { input: "v2" });
    expect(same.revisionId).toBe(edited.revisionId);
    // reverting to previous content reuses the earlier revision
    const back = await s.items.update(item!.id, { input: "v1" });
    expect(back.revisionId).toBe(item!.revisionId);
  });

  it("marks expected as human-reviewed when edited, and supports review toggling", async () => {
    const [item] = await s.items.add(datasetId, [
      { input: "x", expected: "guess", expectedSource: "generated" },
    ]);
    expect(item!.expectedReviewedAt).toBeNull();
    expect((await s.items.list(datasetId, q({ filter: "unreviewed" }))).items).toHaveLength(1);

    await s.items.review([item!.id], true);
    expect((await s.items.get(item!.id)).expectedReviewedAt).not.toBeNull();
    expect((await s.items.list(datasetId, q({ filter: "unreviewed" }))).items).toHaveLength(0);

    const edited = await s.items.update(item!.id, { expected: "truth" });
    expect(edited.expectedSource).toBe("human");
    expect(edited.expectedReviewedAt).not.toBeNull();
  });

  it("soft-deletes items", async () => {
    const [a, b] = await s.items.add(datasetId, [{ input: "a" }, { input: "b" }]);
    expect(await s.items.delete([a!.id])).toEqual({ deleted: 1 });
    const list = await s.items.list(datasetId, q());
    expect(list.items.map((i) => i.id)).toEqual([b!.id]);
    await expect(s.items.get(a!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
