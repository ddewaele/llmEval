import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "@llmeval/shared";

/** Compact JSON for an LLM caller: no indentation, long strings truncated in list views. */
export function jsonResult(value: unknown, opts: { truncate?: number } = {}): CallToolResult {
  const text = JSON.stringify(opts.truncate ? truncateStrings(value, opts.truncate) : value);
  return { content: [{ type: "text", text }] };
}

export function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof AppError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? `INTERNAL: ${err.message}`
        : "INTERNAL: unknown error";
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function truncateStrings(value: unknown, max: number): unknown {
  if (typeof value === "string") {
    return value.length > max
      ? `${value.slice(0, max)}… [${value.length - max} more chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, max));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateStrings(v, max),
      ]),
    );
  }
  return value;
}
