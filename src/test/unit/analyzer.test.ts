import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTrees, GrammarLoader, type SourceDocument } from "../../extract/treeSitter";
import { type ZipfLookup, loadZipf } from "../../metrics/zipf";
import { type AnalyzerSources, CommentAnalyzer } from "../../score/analyzer";
import { DEFAULT_WEIGHTS, type Weights } from "../../score/composite";
import { DEFAULT_SETTINGS, type Settings } from "../../settings";

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
    settings: () => DEFAULT_SETTINGS,
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

  it("reuses results of unchanged comments across versions", async () => {
    const vocabulary = new Set<string>();
    const { analyzer: subject } = analyzer({ vocabulary: async () => vocabulary });
    const doc = document(SOURCE);
    await trees.open("f.ts", doc);
    const before = await subject.analyze("f.ts", doc);

    // Moved down a line by an edit above: same comments, so the same results.
    const moved = document(`\n${SOURCE}`, "typescript", 2);
    await trees.open("f.ts", moved);
    const after = await subject.analyze("f.ts", moved);
    expect(after.map(({ score }) => score)).toEqual(before.map(({ score }) => score));
    expect(after[0]!.score).toBe(before[0]!.score);
    expect(after[0]!.comment.range.start.row).toBe(1);
  });

  it("rescores everything when the vocabulary changes", async () => {
    let vocabulary: ReadonlySet<string> = new Set();
    const { analyzer: subject } = analyzer({ vocabulary: async () => vocabulary });
    const doc = document(SOURCE);
    await trees.open("g.ts", doc);
    const [before] = await subject.analyze("g.ts", doc);
    vocabulary = new Set(["user"]);
    subject.forget("g.ts");
    const [after] = await subject.analyze("g.ts", doc);
    expect(after!.score).not.toBe(before!.score);
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

  describe("with settings", () => {
    const LONG = `// ${"The upload is retried when the network drops for a while. ".repeat(3)}\nconst a = 1;`;

    async function scoreWith(settings: Partial<Settings>, source = LONG) {
      const doc = document(source);
      await trees.open("s.ts", doc);
      const { analyzer: subject } = analyzer({
        settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
      });
      const [scored] = await subject.analyze("s.ts", doc);
      return scored!.score;
    }

    it("uses the configured weights", async () => {
      const onlyLength = Object.fromEntries(
        Object.entries(DEFAULT_WEIGHTS).map(([metric, config]) => [
          metric,
          { ...config, weight: metric === "commentLength" ? 1 : 0 },
        ]),
      ) as Weights;
      const score = await scoreWith({ weights: onlyLength });
      expect(
        score.contributions.filter(({ points }) => points > 0).map(({ metric }) => metric),
      ).toEqual(["commentLength"]);
    });

    it("uses the configured readability ramp", async () => {
      // 33 words: past the default ramp's middle, just into a later one.
      expect((await scoreWith({})).readability).toBeCloseTo(0.65);
      expect((await scoreWith({ ramp: { start: 30, end: 60 } })).readability).toBeCloseTo(0.1);
    });

    it("treats whitelisted acronyms as known", async () => {
      const source = "// Retries SQS calls on failure.\nconst a = 1;";
      expect((await scoreWith({}, source)).reasons).toContain("Undefined acronym: SQS");
      const known = await scoreWith({ acronyms: new Set(["sqs"]) }, source);
      expect(known.reasons).not.toContain("Undefined acronym: SQS");
    });

    it("rescores after clear", async () => {
      let settings: Settings = DEFAULT_SETTINGS;
      const { analyzer: subject } = analyzer({ settings: () => settings });
      const doc = document(LONG);
      await trees.open("t.ts", doc);
      const before = await subject.analyze("t.ts", doc);
      settings = { ...DEFAULT_SETTINGS, ramp: { start: 30, end: 60 } };
      expect(await subject.analyze("t.ts", doc)).toBe(before);
      subject.clear();
      expect((await subject.analyze("t.ts", doc))[0]!.score.readability).toBeCloseTo(0.1);
    });
  });
});
