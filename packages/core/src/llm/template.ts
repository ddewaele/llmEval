import type { JsonValue } from "@llmeval/shared";

const TAG = /\{\{\s*(json\s+)?([A-Za-z0-9_.$[\]-]+)\s*\}\}/g;

/**
 * Minimal, logic-free template renderer: `{{path}}`, `{{nested.path}}`, `{{json path}}`.
 * For string inputs the whole value is available as `{{input}}`. Non-string values render as
 * JSON. Missing paths render as an empty string and are reported.
 */
export function renderTemplate(
  template: string,
  input: JsonValue,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(TAG, (_m, jsonFlag: string | undefined, path: string) => {
    const value = resolvePath(input, path);
    if (value === undefined) {
      missing.push(path);
      return "";
    }
    if (jsonFlag) return JSON.stringify(value);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
  return { text, missing };
}

export function resolvePath(input: JsonValue, path: string): JsonValue | undefined {
  if (path === "input" && (typeof input !== "object" || input === null || !("input" in input))) {
    return input;
  }
  let cur: JsonValue | undefined = input;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, JsonValue>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
