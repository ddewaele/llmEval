import type { JsonValue } from "@llmeval/shared";
import { resolvePath } from "../llm/template.js";
import { canonicalJson } from "../util/hash.js";

export function pick(value: JsonValue | null, path: string | undefined): JsonValue | null {
  if (value === null || !path) return value;
  return resolvePath(value, path) ?? null;
}

export function asText(value: JsonValue | null): string {
  if (value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function normaliseText(
  s: string,
  opts: { caseInsensitive?: boolean; trim?: boolean },
): string {
  let out = s;
  if (opts.trim !== false) out = out.trim().replace(/\s+/g, " ");
  if (opts.caseInsensitive) out = out.toLowerCase();
  return out;
}

/** `expected` may list several acceptable answers; returns them as candidates. */
export function candidates(expected: JsonValue | null): Array<JsonValue | null> {
  return Array.isArray(expected) ? expected : [expected];
}

export function jsonEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/** True when every key/value in `subset` appears (deeply) in `superset`. */
export function jsonSubset(subset: JsonValue | null, superset: JsonValue | null): boolean {
  if (subset === null || typeof subset !== "object") return jsonEqual(subset, superset);
  if (Array.isArray(subset)) {
    if (!Array.isArray(superset)) return false;
    return subset.every((s) => superset.some((x) => jsonSubset(s, x)));
  }
  if (superset === null || typeof superset !== "object" || Array.isArray(superset)) return false;
  return Object.entries(subset).every(([k, v]) => k in superset && jsonSubset(v, superset[k]!));
}

export function toStringSet(
  value: JsonValue | null,
  opts: { caseInsensitive?: boolean; split?: string },
): Set<string> {
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string" && opts.split) items = value.split(opts.split);
  else if (value === null) items = [];
  else items = [value];
  return new Set(
    items
      .map((v) =>
        normaliseText(typeof v === "string" ? v : JSON.stringify(v), {
          caseInsensitive: opts.caseInsensitive,
        }),
      )
      .filter((s) => s.length > 0),
  );
}
