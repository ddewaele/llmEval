import { describe, expect, it } from "vitest";
import type { JsonValue } from "@llmeval/shared";
import { ScorerRegistry } from "./registry.js";

const reg = new ScorerRegistry();
async function score(
  type: string,
  expected: JsonValue | null,
  output: JsonValue | null,
  config: Record<string, unknown> = {},
) {
  const s = reg.get(type);
  return s.score({ input: null, expected, output, config: s.configSchema.parse(config) });
}

describe("deterministic scorers", () => {
  it("exact_match handles normalisation, paths and multi-reference expected", async () => {
    expect((await score("exact_match", "Paris", "  paris ", { caseInsensitive: true })).score).toBe(
      1,
    );
    expect((await score("exact_match", "Paris", "paris")).score).toBe(0);
    expect((await score("exact_match", ["Paris", "paris"], "paris")).passed).toBe(true);
    expect((await score("exact_match", { a: 1 }, { a: 1 })).score).toBe(1);
    expect((await score("exact_match", "x", { answer: "x" }, { path: "answer" })).score).toBe(1);
  });

  it("contains uses expected or an explicit needle", async () => {
    expect((await score("contains", "ABC-1", "Codes: ABC-1, DEF")).score).toBe(1);
    expect(
      (await score("contains", null, "hello world", { needle: "WORLD", caseInsensitive: true }))
        .score,
    ).toBe(1);
    expect((await score("contains", "zzz", "hello")).score).toBe(0);
  });

  it("regex matches and compares captured groups", async () => {
    expect((await score("regex", null, "Total: 42 EUR", { pattern: "\\d+ EUR" })).score).toBe(1);
    const r = await score("regex", "42", "Total: 42 EUR", {
      pattern: "Total: (\\d+)",
      compareGroup: 1,
    });
    expect(r.score).toBe(1);
    expect(r.details).toEqual({ captured: "42" });
    expect((await score("regex", null, "nothing", { pattern: "\\d+" })).rationale).toBe("no match");
  });

  it("json_equal ignores key order and supports subset mode", async () => {
    expect((await score("json_equal", { a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).score).toBe(1);
    expect((await score("json_equal", { a: 1 }, { a: 1, extra: true })).score).toBe(0);
    expect(
      (await score("json_equal", { a: 1 }, { a: 1, extra: true }, { subset: true })).score,
    ).toBe(1);
    expect((await score("json_equal", ["x"], ["x"], { path: "codes" })).score).toBe(1);
  });

  it("numeric_tolerance parses numbers and applies tolerances", async () => {
    expect((await score("numeric_tolerance", 100, "The answer is 101", { abs: 1 })).score).toBe(1);
    expect((await score("numeric_tolerance", 100, 104, { rel: 0.05 })).score).toBe(1);
    expect((await score("numeric_tolerance", 100, 106, { rel: 0.05 })).score).toBe(0);
    expect((await score("numeric_tolerance", 100, "none")).rationale).toBe("not numeric");
  });

  it("set_overlap computes precision/recall/F1 with missing and extra entries", async () => {
    const r = await score("set_overlap", ["ABC-1", "DEF-2"], ["abc-1", "XYZ-9"], {
      passThreshold: 0.5,
    });
    expect(r.score).toBe(0.5);
    expect(r.passed).toBe(true);
    expect(r.details).toEqual({
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      missing: ["def-2"],
      extra: ["xyz-9"],
    });
    expect((await score("set_overlap", [], [])).score).toBe(1);
    expect((await score("set_overlap", ["A"], "A, B", { split: "," })).details).toMatchObject({
      recall: 1,
      precision: 0.5,
    });
    const nested = await score(
      "set_overlap",
      { productCodes: ["A"] },
      { productCodes: ["A"] },
      { path: "productCodes" },
    );
    expect(nested.score).toBe(1);
  });

  it("registry lists scorers with JSON schemas and validates specs", () => {
    const list = reg.list();
    expect(list.map((s) => s.type)).toEqual([
      "exact_match",
      "contains",
      "regex",
      "json_equal",
      "numeric_tolerance",
      "set_overlap",
    ]);
    expect(list[0]!.configSchema).toMatchObject({ type: "object" });
    expect(() => reg.validate([{ key: "a", type: "nope", config: {} }])).toThrow(/Unknown scorer/);
    expect(() => reg.validate([{ key: "a", type: "regex", config: {} }])).toThrow(/Invalid config/);
    const [v] = reg.validate([{ key: "a", type: "exact_match", config: {} }]);
    expect(v!.config).toEqual({ caseInsensitive: false, trim: true });
  });
});
