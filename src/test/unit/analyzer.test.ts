import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTrees, GrammarLoader, type SourceDocument } from "../../extract/treeSitter";
import { type ZipfLookup, loadZipf } from "../../metrics/zipf";
import { type AnalyzerSources, CommentAnalyzer } from "../../score/analyzer";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
const loader = new GrammarLoader(wasmDir, wasmDir);
const table = loadZipf("data/zipf-en.json");

const trees = new DocumentTrees(loader);
afterEach(() => {
  trees.dispose();
});

const document = (text: string, languageId = "typescript", version = 1): SourceDocument => ({
  languageId,
  version,
  getText: () => text,
});

function analyzer(overrides: Partial<AnalyzerSources> = {}) {
  const sources = {
    tree: (key: string) => trees.get(key),
    hasGrammar: (languageId: string) => loader.supports(languageId),
    vocabulary: vi.fn<() => Promise<ReadonlySet<string>>>(async () => new Set()),
    zipf: vi.fn<() => ZipfLookup>(() => table),
    ...overrides,
  };
  return { analyzer: new CommentAnalyzer(sources), sources };
}

/** Zipf of the rarest word in a doc comment on `symbol`. */
const rarestWithSymbol = async (key: string, symbol: string) => {
  const doc = document(`/** Returns the idempotency token. */\nfunction ${symbol}() {}`);
  await trees.open(key, doc);
  const [scored] = await analyzer().analyzer.analyze(key, doc);
  return scored!.score.contributions.find(({ metric }) => metric === "minZipf")!.value;
};

const SOURCE = [
  "/** Gets the user. */",
  "function getUser() {}",
  "",
  "// ok",
  "const a = 1; // Idempotent DLQ reconciliation isn't never retried unless it wasn't.",
].join("\n");

describe("CommentAnalyzer", () => {
  it("scores comments from the syntax tree, skipping ones too short to read", async () => {
    const doc = document(SOURCE);
    await trees.open("a.ts", doc);
    const { analyzer: subject } = analyzer();
    const scored = await subject.analyze("a.ts", doc);

    expect(scored.map(({ text, words }) => [text, words])).toEqual([
      ["Gets the user.", 3],
      ["Idempotent DLQ reconciliation isn't never retried unless it wasn't.", 9],
    ]);
    const [getter, dense] = scored;
    expect(getter!.redundancy).toMatchObject({ redundant: true });
    expect(getter!.comment.approx).toBe(false);
    expect(dense!.score.score).toBeGreaterThan(getter!.score.score);
    expect(dense!.score.reasons).not.toEqual([]);
  });

  it("treats the documented symbol's name as known", async () => {
    expect(await rarestWithSymbol("b.ts", "idempotencyToken")).toBeGreaterThan(
      await rarestWithSymbol("c.ts", "token"),
    );
  });

  it("waits for the tree without caching, then caches per version", async () => {
    const { analyzer: subject, sources } = analyzer();
    const doc = document(SOURCE);
    expect(await subject.analyze("a.ts", doc)).toEqual([]);

    await trees.open("a.ts", doc);
    const first = subject.analyze("a.ts", doc);
    expect(subject.analyze("a.ts", doc)).toBe(first);
    expect(await first).toHaveLength(2);

    const edited = document(SOURCE, "typescript", 2);
    expect(subject.analyze("a.ts", edited)).not.toBe(first);
    subject.forget("a.ts");
    expect(subject.analyze("a.ts", edited)).not.toBe(first);
    await subject.analyze("a.ts", edited);
    // The frequency table is read once.
    expect(sources.zipf).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed analysis, keeping a newer one", async () => {
    const vocabulary = vi
      .fn<() => Promise<ReadonlySet<string>>>()
      .mockRejectedValueOnce(new Error("findFiles failed"))
      .mockResolvedValue(new Set());
    const { analyzer: subject } = analyzer({ vocabulary });
    const doc = document(SOURCE);
    await trees.open("e.ts", doc);

    await expect(subject.analyze("e.ts", doc)).rejects.toThrow("findFiles failed");
    expect(await subject.analyze("e.ts", doc)).toHaveLength(2);

    // A failure that settles after a newer version was cached leaves that one alone.
    vocabulary.mockRejectedValueOnce(new Error("findFiles failed"));
    const failing = subject.analyze("e.ts", document(SOURCE, "typescript", 2));
    const newer = subject.analyze("e.ts", document(SOURCE, "typescript", 3));
    await expect(failing).rejects.toThrow("findFiles failed");
    expect(subject.analyze("e.ts", document(SOURCE, "typescript", 3))).toBe(newer);
  });

  it("scans fallback languages without a tree, marking them approximate", async () => {
    const doc = document("// Retries the upload when the network drops.\nval x = 1", "kotlin");
    const [scored] = await analyzer().analyzer.analyze("a.kt", doc);
    expect(scored).toMatchObject({ text: "Retries the upload when the network drops." });
    expect(scored!.comment.approx).toBe(true);
  });

  it("has nothing to score in unknown languages or comment-free code", async () => {
    const { analyzer: subject, sources } = analyzer();
    expect(await subject.analyze("a.txt", document("# not code", "plaintext"))).toEqual([]);
    const doc = document("const a = 1;");
    await trees.open("c.ts", doc);
    expect(await subject.analyze("c.ts", doc)).toEqual([]);
    expect(sources.vocabulary).not.toHaveBeenCalled();
  });

  it("knows the workspace vocabulary", async () => {
    const doc = document("// Returns the idempotency shard.\nconst a = 1;");
    await trees.open("d.ts", doc);
    const rarest = async (vocabulary: string[]) => {
      const { analyzer: subject } = analyzer({ vocabulary: async () => new Set(vocabulary) });
      const [scored] = await subject.analyze("d.ts", doc);
      return scored!.score.contributions.find(({ metric }) => metric === "minZipf")!.value;
    };
    expect(await rarest(["idempotency", "shard"])).toBeGreaterThan(await rarest([]));
  });
});
