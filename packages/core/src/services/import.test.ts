import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportRequestSchema, ListItemsQuerySchema } from "@llmeval/shared";
import { createTestContext } from "../test-utils.js";
import type { Services } from "./index.js";

const req = (r: Record<string, unknown>) => ImportRequestSchema.parse(r);

describe("ImportService", () => {
  let s: Services;
  let datasetId: string;
  beforeEach(async () => {
    s = (await createTestContext()).services;
    datasetId = (await s.datasets.create({ name: "ds" })).id;
  });

  it("imports a JSON array with explicit fields and bare values", async () => {
    const content = JSON.stringify([
      { input: "q1", expected: "a1", tags: "x, y" },
      { input: { a: 1 }, expected: { b: 2 }, metadata: { notes: "n" } },
      "bare string",
    ]);
    const res = await s.imports.import(datasetId, req({ format: "json", content }));
    expect(res.added).toBe(3);
    expect(res.errors).toEqual([]);
    const items = (await s.items.list(datasetId, ListItemsQuerySchema.parse({}))).items;
    expect(items[0]!.metadata).toEqual({ source: "imported", tags: ["x", "y"] });
    expect(items[0]!.expectedSource).toBe("imported");
    expect(items[1]!.metadata.notes).toBe("n");
    expect(items[2]!.input).toBe("bare string");
  });

  it("imports JSONL where objects without input become the input", async () => {
    const content = [
      '{"subject":"Order","body":"5x ABC","expected":["ABC"]}',
      "",
      '{"input":"x"}',
    ].join("\n");
    const res = await s.imports.import(datasetId, req({ format: "jsonl", content }));
    expect(res.added).toBe(2);
    const [first] = (await s.items.list(datasetId, ListItemsQuerySchema.parse({}))).items;
    expect(first!.input).toEqual({ subject: "Order", body: "5x ABC" });
    expect(first!.expected).toEqual(["ABC"]);
  });

  it("imports CSV with a column mapping, split expected, dedupe and row errors", async () => {
    const csv = [
      "subject,body,codes,tags",
      'Order 1,Need 5x ABC-123 and DEF-9,"ABC-123, DEF-9",sap',
      "Order 2,Please quote XYZ,XYZ,",
      "order 1,need 5x abc-123 and def-9,ABC-123,dup",
      ",,ABC,",
    ].join("\n");
    const dry = await s.imports.import(
      datasetId,
      req({
        format: "csv",
        content: csv,
        dryRun: true,
        mapping: { input: ["subject", "body"], expected: "codes", expectedSplit: "," },
        tags: ["customer-sheet"],
      }),
    );
    expect(dry.columns).toEqual(["subject", "body", "codes", "tags"]);
    expect(dry.totalRows).toBe(4);
    expect(dry.added).toBe(2);
    expect(dry.skippedDuplicates).toBe(1);
    expect(dry.errors).toEqual([{ row: 4, message: "Row has no input" }]);
    expect(dry.preview[0]).toEqual({
      input: { subject: "Order 1", body: "Need 5x ABC-123 and DEF-9" },
      expected: ["ABC-123", "DEF-9"],
      metadata: { source: "imported", tags: ["sap", "customer-sheet"] },
    });
    expect((await s.datasets.get(datasetId)).draftItemCount).toBe(0);

    const real = await s.imports.import(
      datasetId,
      req({
        format: "csv",
        content: csv,
        mapping: { input: ["subject", "body"], expected: "codes", expectedSplit: "," },
      }),
    );
    expect(real.added).toBe(2);
    expect(real.items).toHaveLength(2);
    // Re-import skips everything already present
    const again = await s.imports.import(
      datasetId,
      req({
        format: "csv",
        content: csv,
        mapping: { input: ["subject", "body"], expected: "codes" },
      }),
    );
    expect(again.added).toBe(0);
    expect(again.skippedDuplicates).toBe(3);
  });

  it("defaults tabular mapping to input/expected columns and reports unknown columns", async () => {
    const csv = "Input,Expected\nhello,world\n";
    const res = await s.imports.import(datasetId, req({ format: "csv", content: csv }));
    expect(res.added).toBe(1);
    expect(res.items![0]!.input).toBe("hello");
    expect(res.items![0]!.expected).toBe("world");

    const bad = await s.imports.import(
      datasetId,
      req({ format: "csv", content: csv, mapping: { input: "nope" }, dryRun: true }),
    );
    expect(bad.errors[0]!.message).toMatch(/Column "nope" not found/);
  });

  it("imports an xlsx workbook from base64 content", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Mails");
    ws.addRow(["Subject", "Body", "Expected codes"]);
    ws.addRow(["Order", "Need ABC-1", "ABC-1;ABC-2"]);
    ws.addRow(["Quote", { richText: [{ text: "Rich " }, { text: "text" }] }, "Q-9"]);
    ws.addRow([null, null, null]);
    const content = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
    const res = await s.imports.import(
      datasetId,
      req({
        format: "xlsx",
        content,
        sheet: "Mails",
        mapping: { input: ["Subject", "Body"], expected: "Expected codes", expectedSplit: ";" },
      }),
    );
    expect(res.columns).toEqual(["Subject", "Body", "Expected codes"]);
    expect(res.added).toBe(2);
    expect(res.items![0]!.expected).toEqual(["ABC-1", "ABC-2"]);
    expect(res.items![1]!.input).toEqual({ Subject: "Quote", Body: "Rich text" });

    await expect(
      s.imports.import(datasetId, req({ format: "xlsx", content, sheet: "Missing" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects malformed content and missing sources", async () => {
    await expect(
      s.imports.import(datasetId, req({ format: "json", content: "not json" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(s.imports.import(datasetId, req({ format: "csv" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      s.imports.import(datasetId, req({ format: "csv", path: "/nonexistent/file.csv" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
