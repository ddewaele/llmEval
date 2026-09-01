import { describe, expect, it } from "vitest";
import { ItemMetadataSchema, NewItemSchema } from "./item.js";

describe("item schemas", () => {
  it("defaults metadata.source to manual and keeps extra keys", () => {
    const parsed = ItemMetadataSchema.parse({ tags: ["a"], custom: { nested: 1 } });
    expect(parsed.source).toBe("manual");
    expect(parsed.custom).toEqual({ nested: 1 });
  });

  it("accepts string, object and messages-array inputs", () => {
    expect(NewItemSchema.parse({ input: "hello" }).input).toBe("hello");
    expect(NewItemSchema.parse({ input: { q: "x" } }).input).toEqual({ q: "x" });
    const messages = [{ role: "user", content: "hi" }];
    expect(NewItemSchema.parse({ input: messages }).input).toEqual(messages);
  });
});
