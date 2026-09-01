import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { and, eq, isNull } from "drizzle-orm";
import {
  AppError,
  type ImportMapping,
  type ImportRequest,
  type ImportResult,
  type JsonValue,
  type NewItem,
} from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { itemRevisions, items } from "../db/schema.js";
import { canonicalJson, sha256 } from "../util/hash.js";
import type { ItemService } from "./items.js";

type Row = Record<string, unknown>;
type Parsed = { rows: Row[]; columns?: string[] };
type RowError = { row: number; message: string };

/** Normalised hash of an input used for duplicate detection (case/whitespace-insensitive). */
export function inputDedupKey(input: JsonValue): string {
  return sha256(canonicalJson(normalise(input)));
}

function normalise(v: JsonValue): JsonValue {
  if (typeof v === "string") return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  }
  return v;
}

export class ImportService {
  constructor(
    private readonly db: Db,
    private readonly itemService: ItemService,
  ) {}

  async import(datasetId: string, req: ImportRequest): Promise<ImportResult> {
    const raw = await this.loadContent(req);
    const parsed = await this.parse(req, raw);
    const { candidates, errors } = this.toItems(parsed, req);

    let skippedDuplicates = 0;
    const accepted: NewItem[] = [];
    if (req.dedupe) {
      const seen = await this.existingInputKeys(datasetId);
      for (const c of candidates) {
        const key = inputDedupKey(c.input);
        if (seen.has(key)) {
          skippedDuplicates++;
          continue;
        }
        seen.add(key);
        accepted.push(c);
      }
    } else {
      accepted.push(...candidates);
    }

    const base: Omit<ImportResult, "added" | "items"> = {
      dryRun: req.dryRun,
      format: req.format,
      totalRows: parsed.rows.length,
      skippedDuplicates,
      errors,
      columns: parsed.columns,
      preview: accepted.slice(0, 5).map((i) => ({
        input: i.input,
        expected: i.expected ?? null,
        metadata: { source: "imported", ...i.metadata },
      })),
    };
    if (req.dryRun) return { ...base, added: accepted.length };
    const created = await this.itemService.add(datasetId, accepted);
    return { ...base, added: created.length, items: created };
  }

  // -- loading & parsing -----------------------------------------------------------------------

  private async loadContent(req: ImportRequest): Promise<string | Buffer> {
    if (req.path) {
      try {
        return await readFile(req.path);
      } catch (err) {
        throw new AppError("VALIDATION", `Cannot read file ${req.path}: ${(err as Error).message}`);
      }
    }
    if (req.content === undefined) {
      throw new AppError("VALIDATION", "Provide either content or path");
    }
    return req.format === "xlsx" ? Buffer.from(req.content, "base64") : req.content;
  }

  private async parse(req: ImportRequest, raw: string | Buffer): Promise<Parsed> {
    switch (req.format) {
      case "json":
        return { rows: parseJsonArray(asText(raw)) };
      case "jsonl":
        return { rows: parseJsonl(asText(raw)) };
      case "csv":
        return parseCsv(asText(raw));
      case "xlsx":
        return parseXlsx(Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "base64"), req.sheet);
    }
  }

  // -- mapping ---------------------------------------------------------------------------------

  private toItems(
    parsed: Parsed,
    req: ImportRequest,
  ): { candidates: NewItem[]; errors: RowError[] } {
    const mapping: ImportMapping = { parseJson: true, ...req.mapping };
    const tabular = parsed.columns !== undefined;
    const candidates: NewItem[] = [];
    const errors: RowError[] = [];
    parsed.rows.forEach((row, idx) => {
      try {
        const item = tabular
          ? mapTabularRow(row, parsed.columns!, mapping)
          : mapRecordRow(row, mapping);
        if (req.tags?.length) {
          item.metadata = {
            ...item.metadata,
            tags: [...new Set([...(item.metadata?.tags ?? []), ...req.tags])],
          };
        }
        candidates.push(item);
      } catch (err) {
        errors.push({ row: idx + 1, message: (err as Error).message });
      }
    });
    return { candidates, errors };
  }

  private async existingInputKeys(datasetId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ input: itemRevisions.input })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(and(eq(items.datasetId, datasetId), isNull(items.deletedAt)));
    return new Set(rows.map((r) => inputDedupKey(r.input)));
  }
}

// -- format parsers ----------------------------------------------------------------------------

function asText(raw: string | Buffer): string {
  return Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
}

function parseJsonArray(text: string): Row[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new AppError("VALIDATION", `Invalid JSON: ${(err as Error).message}`);
  }
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : null;
  if (!arr) throw new AppError("VALIDATION", "JSON must be an array of items or {items: [...]}");
  return arr.map(toRow);
}

function parseJsonl(text: string): Row[] {
  const rows: Row[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(toRow(JSON.parse(line)));
    } catch (err) {
      throw new AppError("VALIDATION", `Invalid JSON on line ${i + 1}: ${(err as Error).message}`);
    }
  });
  return rows;
}

function toRow(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  // A bare string/array/number becomes the input itself.
  return { input: value };
}

function parseCsv(text: string): Parsed {
  const result = Papa.parse<Row>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  const fatal = result.errors.find(
    (e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter",
  );
  if (fatal) throw new AppError("VALIDATION", `Invalid CSV: ${fatal.message}`);
  const columns = (result.meta.fields ?? []).filter((f) => f !== "");
  if (columns.length === 0) throw new AppError("VALIDATION", "CSV has no header row");
  return { rows: result.data, columns };
}

async function parseXlsx(buffer: Buffer, sheet?: string): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw new AppError("VALIDATION", `Invalid xlsx: ${(err as Error).message}`);
  }
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) {
    const names = wb.worksheets.map((w) => w.name).join(", ");
    throw new AppError("VALIDATION", `Worksheet "${sheet}" not found. Available: ${names}`);
  }
  const header = ws.getRow(1);
  const columns: string[] = [];
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    columns[col] = String(cellValue(cell.value) ?? `column${col}`).trim();
  });
  const names = columns.filter(Boolean);
  if (names.length === 0) throw new AppError("VALIDATION", "xlsx sheet has no header row");
  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Row = {};
    let empty = true;
    columns.forEach((name, col) => {
      if (!name) return;
      const v = cellValue(row.getCell(col).value);
      record[name] = v === null || v === undefined ? "" : v;
      if (record[name] !== "") empty = false;
    });
    if (!empty) rows.push(record);
  });
  return { rows, columns: names };
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("richText" in o) return (o.richText as Array<{ text: string }>).map((t) => t.text).join("");
    if ("result" in o) return cellValue(o.result as ExcelJS.CellValue);
    if ("text" in o)
      return typeof o.text === "string" ? o.text : cellValue(o.text as ExcelJS.CellValue);
    if ("error" in o) return null;
    return JSON.stringify(v);
  }
  return v;
}

// -- row mapping ------------------------------------------------------------------------------

const RESERVED = new Set(["input", "expected", "metadata", "tags", "id", "expectedSource"]);

/** JSON/JSONL objects: explicit input/expected/metadata keys, else the whole object is the input. */
function mapRecordRow(row: Row, mapping: ImportMapping): NewItem {
  const hasInput = "input" in row;
  const input = (hasInput ? row.input : stripReserved(row)) as JsonValue;
  if (input === undefined || input === null || input === "") {
    throw new Error("Row has no input");
  }
  const expected = row.expected === undefined ? undefined : (row.expected as JsonValue);
  const metadata: NewItem["metadata"] = { source: "imported" };
  if (row.metadata && typeof row.metadata === "object") Object.assign(metadata, row.metadata);
  const tags = parseTags(row.tags);
  if (tags) metadata.tags = tags;
  metadata.source = "imported";
  return {
    input,
    ...(expected !== undefined && expected !== null
      ? { expected: splitExpected(expected, mapping), expectedSource: "imported" as const }
      : {}),
    metadata,
  };
}

function stripReserved(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !RESERVED.has(k)));
}

function mapTabularRow(row: Row, columns: string[], mapping: ImportMapping): NewItem {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const pick = (spec: string | string[] | undefined, fallback: string): string[] | undefined => {
    if (spec === undefined) {
      const c = lower.get(fallback);
      return c ? [c] : undefined;
    }
    const list = Array.isArray(spec) ? spec : [spec];
    for (const c of list) {
      if (!columns.includes(c))
        throw new Error(`Column "${c}" not found (have: ${columns.join(", ")})`);
    }
    return list;
  };
  const expectedCols = pick(mapping.expected, "expected");
  const tagCol = mapping.tags ?? lower.get("tags");
  let inputCols = pick(mapping.input, "input");
  if (!inputCols) {
    const used = new Set([...(expectedCols ?? []), ...(tagCol ? [tagCol] : [])]);
    inputCols = columns.filter((c) => !used.has(c));
  }
  const cell = (c: string): JsonValue => coerceCell(row[c], mapping.parseJson);

  const input: JsonValue =
    inputCols.length === 1
      ? cell(inputCols[0]!)
      : Object.fromEntries(inputCols.map((c) => [c, cell(c)]));
  if (isBlank(input)) throw new Error("Row has no input");

  let expected: JsonValue | undefined;
  if (expectedCols) {
    expected =
      expectedCols.length === 1
        ? cell(expectedCols[0]!)
        : Object.fromEntries(expectedCols.map((c) => [c, cell(c)]));
    if (isBlank(expected)) expected = undefined;
    else expected = splitExpected(expected, mapping);
  }
  const metadata: NewItem["metadata"] = { source: "imported" };
  const tags = tagCol ? parseTags(row[tagCol]) : undefined;
  if (tags) metadata.tags = tags;
  return {
    input,
    ...(expected !== undefined ? { expected, expectedSource: "imported" as const } : {}),
    metadata,
  };
}

function coerceCell(v: unknown, parseJson: boolean): JsonValue {
  if (v === undefined || v === null) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v).trim();
  if (parseJson && /^[[{]/.test(s)) {
    try {
      return JSON.parse(s) as JsonValue;
    } catch {
      return s;
    }
  }
  return s;
}

function splitExpected(expected: JsonValue, mapping: ImportMapping): JsonValue {
  if (mapping.expectedSplit && typeof expected === "string") {
    return expected
      .split(mapping.expectedSplit)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return expected;
}

function parseTags(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

function isBlank(v: JsonValue): boolean {
  if (v === "" || v === null) return true;
  if (typeof v === "object" && !Array.isArray(v)) {
    return Object.values(v).every((x) => x === "" || x === null);
  }
  return false;
}
