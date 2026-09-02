import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@llmeval/shared";
import { createTestContext } from "../test-utils.js";
import type { Services } from "./index.js";

describe("DatasetService", () => {
  let s: Services;
  beforeEach(async () => {
    s = (await createTestContext()).services;
  });

  it("creates, lists, gets and updates a dataset", async () => {
    const ds = await s.datasets.create({
      name: "sap-codes",
      description: "d",
      tags: ["sap"],
      generationBrief: "Emails with SAP codes",
    });
    expect(ds.generationBrief).toBe("Emails with SAP codes");
    expect((await s.datasets.update(ds.id, { generationBrief: null })).generationBrief).toBeNull();
    expect(ds.id).toHaveLength(26);
    const list = await s.datasets.list();
    expect(list.map((d) => d.name)).toEqual(["sap-codes"]);
    expect(list[0]!.draftItemCount).toBe(0);
    expect(list[0]!.latestVersion).toBeNull();

    const updated = await s.datasets.update(ds.id, { name: "renamed", description: null });
    expect(updated.name).toBe("renamed");
    expect(updated.description).toBeNull();
    expect((await s.datasets.get(ds.id)).tags).toEqual(["sap"]);
  });

  it("archives datasets and hides them from the default listing", async () => {
    const ds = await s.datasets.create({ name: "a" });
    await s.datasets.archive(ds.id);
    expect(await s.datasets.list()).toHaveLength(0);
    expect(await s.datasets.list({ includeArchived: true })).toHaveLength(1);
  });

  it("deletes a dataset with its items", async () => {
    const ds = await s.datasets.create({ name: "a" });
    await s.items.add(ds.id, [{ input: "x" }]);
    const [item] = await s.items.add(ds.id, [{ input: "y" }]);
    await s.datasets.delete(ds.id);
    await expect(s.datasets.get(ds.id)).rejects.toBeInstanceOf(AppError);
    await expect(s.items.get(item!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for unknown ids", async () => {
    await expect(s.datasets.get("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
