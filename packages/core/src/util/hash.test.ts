import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash } from "./hash.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });
  it("produces the same hash regardless of key order", () => {
    expect(contentHash({ input: { x: 1, y: 2 }, expected: null })).toBe(
      contentHash({ expected: null, input: { y: 2, x: 1 } }),
    );
  });
});
