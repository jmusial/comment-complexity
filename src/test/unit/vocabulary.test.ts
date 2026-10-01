import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { GrammarLoader } from "../../extract/treeSitter";
import { minZipf, undefinedAcronyms } from "../../metrics/short";
import type { Token } from "../../metrics/tokens";
import { Vocabulary, identifierWords, languageForPath } from "../../vocab/vocabulary";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
const loader = new GrammarLoader(wasmDir, wasmDir);

async function wordsOf(source: string, languageId = "typescript"): Promise<Set<string>> {
  const parser = (await loader.createParser(languageId))!;
  const tree = parser.parse(source)!;
  try {
    return identifierWords(tree);
  } finally {
    tree.delete();
    parser.delete();
  }
}

describe("Vocabulary", () => {
  it("tracks the words each file contributes", () => {
    const vocabulary = new Vocabulary();
    vocabulary.set("a.ts", ["ledger", "entry"]);
    vocabulary.set("b.ts", ["ledger", "invoice"]);
    expect([...vocabulary.words()].toSorted()).toEqual(["entry", "invoice", "ledger"]);

    // Replacing a file's words drops the ones it no longer uses.
    vocabulary.set("a.ts", ["ledger"]);
    expect(vocabulary.words().has("entry")).toBe(false);

    // A word stays while any file still uses it.
    vocabulary.remove("a.ts");
    expect([...vocabulary.words()].toSorted()).toEqual(["invoice", "ledger"]);
    expect(vocabulary.files).toBe(1);
  });

  it("caps the size, keeping the most widespread words, ties alphabetical", () => {
    const vocabulary = new Vocabulary(3);
    vocabulary.set("a", ["alpha", "beta"]);
    vocabulary.set("b", ["beta", "gamma"]);
    vocabulary.set("c", ["beta", "gamma", "delta"]);
    // beta in 3 files, gamma in 2, alpha and delta in 1: alpha wins the tie.
    expect([...vocabulary.words()]).toEqual(["beta", "gamma", "alpha"]);
  });

  it("returns the cached set until a file changes", () => {
    const vocabulary = new Vocabulary();
    vocabulary.set("a", ["ledger"]);
    const first = vocabulary.words();
    expect(vocabulary.words()).toBe(first);

    // Removing a file it never saw changes nothing.
    vocabulary.remove("unknown");
    expect(vocabulary.words()).toBe(first);

    vocabulary.set("b", ["invoice"]);
    expect(vocabulary.words()).not.toBe(first);
    expect(vocabulary.words().has("invoice")).toBe(true);
  });
});

describe("Vocabulary.rename", () => {
  it("moves a file's words to its new key", () => {
    const vocabulary = new Vocabulary();
    vocabulary.set("a.ts", ["ledger"]);
    vocabulary.rename("a.ts", "b.ts");
    vocabulary.remove("a.ts");
    expect([...vocabulary.words()]).toEqual(["ledger"]);
    vocabulary.remove("b.ts");
    expect([...vocabulary.words()]).toEqual([]);
  });

  it("ignores a file it does not know", () => {
    const vocabulary = new Vocabulary();
    vocabulary.set("a.ts", ["ledger"]);
    const before = vocabulary.words();
    vocabulary.rename("unknown.ts", "b.ts");
    expect(vocabulary.words()).toBe(before);
    expect(vocabulary.files).toBe(1);
  });
});

describe("identifierWords", () => {
  it("skips single letters and parts with digits", async () => {
    expect(await wordsOf("const x = 1;\nlet utf8Value = 2;")).toEqual(new Set(["value"]));
  });

  it("reads identifiers, not comments or strings", async () => {
    const words = await wordsOf(
      [
        "// Retries the flaky upstream call.",
        "const maxRetryCount = 3;",
        "function fetchInvoiceTotal(invoiceId: string) {",
        '  return "not an identifier";',
        "}",
        "class LedgerEntry { ttlSeconds = 60; }",
      ].join("\n"),
    );
    expect(words).toEqual(
      new Set([
        "max",
        "retry",
        "count",
        "fetch",
        "invoice",
        "total",
        "id",
        "ledger",
        "entry",
        "ttl",
        "seconds",
      ]),
    );
  });

  it("reads Ruby constants too", async () => {
    const words = await wordsOf("class Store\n  MAX_SIZE = 10\nend\n", "ruby");
    expect(words).toEqual(new Set(["store", "max", "size"]));
  });
});

describe("languageForPath", () => {
  it.each([
    ["src/ledger.ts", "typescript"],
    ["App.TSX", "typescriptreact"],
    ["lib/store.rb", "ruby"],
    ["include/pool.hpp", "cpp"],
    ["Makefile", undefined],
    ["notes.md", undefined],
    ["release.v2/README", undefined],
  ])("%s → %s", (file, languageId) => {
    expect(languageForPath(file)).toBe(languageId);
  });
});

const token = (text: string, pos: Token["pos"]): Token => ({
  text,
  normal: text.toLowerCase(),
  pos,
});

/** Only the everyday words are listed; the rest count as rare. */
const zipf = (word: string): number | undefined =>
  word === "expires" ? 4 : word === "after" ? 6 : undefined;

describe("workspace terms in metrics", () => {
  it("are neither rare nor undefined acronyms", async () => {
    const vocabulary = new Vocabulary();
    vocabulary.set("ledger.ts", await wordsOf("const idempotencyKey = TTL_MS;"));
    const tokens = [
      token("Idempotency", "NOUN"),
      token("expires", "VERB"),
      token("after", "ADP"),
      token("TTL", "PROPN"),
    ];

    const without = { identifiers: new Set<string>(), vocabulary: new Set<string>(), zipf };
    expect(undefinedAcronyms(tokens, without).value).toBe(1);
    expect(minZipf(tokens, without).reason).toBe('Rare word: "Idempotency"');

    const withWorkspace = { ...without, vocabulary: vocabulary.words() };
    expect(undefinedAcronyms(tokens, withWorkspace).value).toBe(0);
    expect(minZipf(tokens, withWorkspace)).toEqual({ value: 4 });
  });
});
