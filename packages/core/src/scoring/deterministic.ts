import { z } from "zod";
import type { ScoreResult, Scorer } from "./types.js";
import {
  asText,
  candidates,
  jsonEqual,
  jsonSubset,
  normaliseText,
  pick,
  toStringSet,
} from "./util.js";

const pathField = z
  .string()
  .optional()
  .describe("Dot path into the output (and expected) to compare, e.g. 'productCodes'");
const textOpts = {
  caseInsensitive: z.boolean().default(false),
  trim: z.boolean().default(true).describe("Trim and collapse whitespace before comparing"),
  path: pathField,
};

const ExactMatchConfig = z.object(textOpts);
export const exactMatch: Scorer<z.infer<typeof ExactMatchConfig>> = {
  type: "exact_match",
  description:
    "1 when the output text equals the expected text (or any entry when expected is an array of acceptable answers). Non-string values are compared as JSON.",
  usesLlm: false,
  configSchema: ExactMatchConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const out = normaliseText(asText(pick(output, config.path)), config);
    const hit = candidates(expected).some((c) => normaliseText(asText(c), config) === out);
    return { score: hit ? 1 : 0, passed: hit };
  },
};

const ContainsConfig = z.object({
  ...textOpts,
  needle: z
    .string()
    .optional()
    .describe("Text that must appear in the output. Defaults to the expected value(s)"),
});
export const contains: Scorer<z.infer<typeof ContainsConfig>> = {
  type: "contains",
  description:
    "1 when the output contains the needle, or the expected text (any entry when expected is an array).",
  usesLlm: false,
  configSchema: ContainsConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const out = normaliseText(asText(pick(output, config.path)), config);
    const needles =
      config.needle !== undefined ? [config.needle] : candidates(expected).map(asText);
    const hit = needles.some((n) => n.length > 0 && out.includes(normaliseText(n, config)));
    return { score: hit ? 1 : 0, passed: hit };
  },
};

const RegexConfig = z.object({
  pattern: z.string().min(1),
  flags: z.string().default(""),
  path: pathField,
  compareGroup: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("When set, the captured group (0 = whole match) must equal the expected text"),
  caseInsensitive: z.boolean().default(false),
});
export const regex: Scorer<z.infer<typeof RegexConfig>> = {
  type: "regex",
  description:
    "1 when the pattern matches the output; with compareGroup, the captured text must equal expected.",
  usesLlm: false,
  configSchema: RegexConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const re = new RegExp(config.pattern, config.flags);
    const text = asText(pick(output, config.path));
    const m = re.exec(text);
    if (!m) return { score: 0, passed: false, rationale: "no match" };
    if (config.compareGroup === undefined)
      return { score: 1, passed: true, details: { match: m[0] } };
    const captured = normaliseText(m[config.compareGroup] ?? "", config);
    const hit = candidates(expected).some((c) => normaliseText(asText(c), config) === captured);
    return { score: hit ? 1 : 0, passed: hit, details: { captured } };
  },
};

const JsonEqualConfig = z.object({
  path: pathField,
  subset: z
    .boolean()
    .default(false)
    .describe("Pass when expected is a deep subset of the output rather than strictly equal"),
});
export const jsonEqualScorer: Scorer<z.infer<typeof JsonEqualConfig>> = {
  type: "json_equal",
  description:
    "1 when output and expected are structurally equal as JSON (key order ignored); subset mode accepts extra keys in the output.",
  usesLlm: false,
  configSchema: JsonEqualConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const out = pick(output, config.path);
    const exp = pick(expected, config.path);
    const hit = config.subset ? jsonSubset(exp, out) : jsonEqual(exp, out);
    return { score: hit ? 1 : 0, passed: hit };
  },
};

const NumericConfig = z.object({
  path: pathField,
  abs: z.number().nonnegative().default(0).describe("Absolute tolerance"),
  rel: z.number().nonnegative().default(0).describe("Relative tolerance (fraction of expected)"),
});
export const numericTolerance: Scorer<z.infer<typeof NumericConfig>> = {
  type: "numeric_tolerance",
  description:
    "1 when the numeric output is within abs or rel tolerance of the expected number (numbers inside strings are parsed).",
  usesLlm: false,
  configSchema: NumericConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const out = toNumber(pick(output, config.path));
    const exp = toNumber(pick(expected, config.path));
    if (out === null || exp === null) {
      return {
        score: 0,
        passed: false,
        rationale: "not numeric",
        details: { output: out, expected: exp },
      };
    }
    const tolerance = Math.max(config.abs, Math.abs(exp) * config.rel);
    const diff = Math.abs(out - exp);
    const hit = diff <= tolerance;
    return { score: hit ? 1 : 0, passed: hit, details: { diff, tolerance } };
  },
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

const SetOverlapConfig = z.object({
  path: pathField,
  caseInsensitive: z.boolean().default(true),
  split: z
    .string()
    .optional()
    .describe("Delimiter to split a string output/expected into a list, e.g. ','"),
  passThreshold: z.number().min(0).max(1).default(1).describe("Pass when F1 >= threshold"),
});
export const setOverlap: Scorer<z.infer<typeof SetOverlapConfig>> = {
  type: "set_overlap",
  description:
    "Compares output and expected as sets of strings (e.g. product codes): score is F1, details hold precision, recall, missing and extra entries. Pass when F1 >= passThreshold.",
  usesLlm: false,
  configSchema: SetOverlapConfig,
  async score({ expected, output, config }): Promise<ScoreResult> {
    const out = toStringSet(pick(output, config.path), config);
    const exp = toStringSet(pick(expected, config.path), config);
    const tp = [...out].filter((x) => exp.has(x)).length;
    const precision = out.size === 0 ? (exp.size === 0 ? 1 : 0) : tp / out.size;
    const recall = exp.size === 0 ? (out.size === 0 ? 1 : 0) : tp / exp.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const missing = [...exp].filter((x) => !out.has(x));
    const extra = [...out].filter((x) => !exp.has(x));
    return {
      score: round(f1),
      passed: f1 >= config.passThreshold,
      details: {
        precision: round(precision),
        recall: round(recall),
        f1: round(f1),
        missing,
        extra,
      },
    };
  },
};

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export const deterministicScorers: Scorer<unknown>[] = [
  exactMatch,
  contains,
  regex,
  jsonEqualScorer,
  numericTolerance,
  setOverlap,
] as Scorer<unknown>[];
