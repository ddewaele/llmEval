import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Any JSON value. Deliberately non-recursive (nested values are `unknown`) so the schema can be
 * rendered to OpenAPI / JSON Schema without a self-referencing definition; payloads arrive via
 * JSON.parse and are therefore JSON by construction.
 */
export const JsonValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ])
  .describe("Any JSON value") as unknown as z.ZodType<JsonValue>;

export const JsonObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("A JSON object") as unknown as z.ZodType<JsonObject>;
