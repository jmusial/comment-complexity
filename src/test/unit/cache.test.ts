import { describe, expect, it } from "vitest";
import { DocumentCache, commentKey } from "../../cache";

describe("DocumentCache", () => {
  const context = [new Set(["ledger"]), {}];

  it("finds results from the document's previous analysis, keeping only the ones still used", () => {
    const cache = new DocumentCache<number>();
    const first = cache.begin("a.ts", context);
    expect(first.get("x")).toBeUndefined();
    first.set("x", 1);
    first.set("y", 2);
    // Within one pass too, as for a comment repeated in the file.
    expect(first.get("x")).toBe(1);

    const second = cache.begin("a.ts", context);
    expect(second.get("x")).toBe(1);
    // "y" was not asked for, so the next pass no longer has it.
    expect(cache.size).toBe(1);
    expect(cache.begin("a.ts", context).get("y")).toBeUndefined();
  });

  it("keeps documents apart", () => {
    const cache = new DocumentCache<number>();
    cache.begin("a.ts", context).set("x", 1);
    expect(cache.begin("b.ts", context).get("x")).toBeUndefined();
    expect(cache.begin("a.ts", context).get("x")).toBe(1);
  });

  it("starts empty when the shared context changes, by identity", () => {
    const cache = new DocumentCache<number>();
    cache.begin("a.ts", context).set("x", 1);
    // An equal but new set is a new vocabulary.
    expect(cache.begin("a.ts", [new Set(["ledger"]), context[1]]).get("x")).toBeUndefined();
    cache.begin("a.ts", context).set("x", 1);
    expect(cache.begin("a.ts", [context[0]]).get("x")).toBeUndefined();
  });

  it("forgets a document, or everything", () => {
    const cache = new DocumentCache<number>();
    cache.begin("a.ts", context).set("x", 1);
    cache.begin("b.ts", context).set("x", 1);
    cache.forget("a.ts");
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.begin("b.ts", context).get("x")).toBeUndefined();
  });
});

describe("commentKey", () => {
  it("tells apart comments that differ in any part", () => {
    const keys = new Set([
      commentKey("jsdoc", "/** Gets it. */", "get"),
      commentKey("jsdoc", "/** Gets it. */", "set"),
      commentKey("jsdoc", "/** Gets it. */", undefined),
      commentKey("plain", "/** Gets it. */", "get"),
      commentKey("jsdoc", "/** Gets that. */", "get"),
    ]);
    expect(keys.size).toBe(5);
    expect(commentKey("jsdoc", "x", "get")).toBe(commentKey("jsdoc", "x", "get"));
  });
});
