import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../metrics/tokens";
import { loadZipf } from "../../metrics/zipf";

describe("tokenize", () => {
  it("tags words with the bundled model", () => {
    const tokens = tokenize("Returns the cached user.");

    expect(tokens.map((token) => token.text)).toEqual(["Returns", "the", "cached", "user", "."]);
    expect(tokens[0]?.normal).toBe("returns");
    expect(tokens.map((token) => token.pos)).toEqual(
      expect.arrayContaining(["DET", "NOUN", "PUNCT"]),
    );
  });

  it("tags each line of normalized text on its own", () => {
    expect(tokenize("First line\n\nSecond line").map((token) => token.text)).toEqual([
      "First",
      "line",
      "Second",
      "line",
    ]);
  });
});

describe("loadZipf", () => {
  const zipf = loadZipf(path.resolve("data/zipf-en.json"));

  it("reads wordfreq's values", () => {
    expect(zipf("the")).toBe(7.73);
    expect(zipf("function")).toBe(4.78);
  });

  it("returns undefined for unlisted words", () => {
    expect(zipf("zzzqqq")).toBeUndefined();
  });
});
