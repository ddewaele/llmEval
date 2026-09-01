import { createHash } from "node:crypto";
import type { JsonValue } from "@llmeval/shared";

/** Deterministic JSON serialisation: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function contentHash(parts: Record<string, JsonValue | null | undefined>): string {
  return sha256(canonicalJson(parts as JsonValue));
}
