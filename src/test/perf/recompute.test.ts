import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { DocumentTrees, GrammarLoader, type TextChange } from "../../extract/treeSitter";
import { loadZipf } from "../../metrics/zipf";
import { CommentAnalyzer } from "../../score/analyzer";
import { DEFAULT_SETTINGS } from "../../settings";

const EDITS = 15;

/** A TypeScript file of `lines` lines with a comment every few lines, each worded differently. */
function source(lines: number): string {
  const out: string[] = [];
  for (let i = 0; out.length < lines; i++) {
    out.push(
      "/**",
      ` * Returns the ledger entry ${i} after settling every open invoice for the account.`,
      " * Retries when the network drops, unless the idempotency key was already used.",
      " */",
      `export function entry${i}(id: string): string {`,
      `  // Normalizes identifier ${i} before the lookup, since callers pass mixed case.`,
      "  return id.toLowerCase();",
      "}",
      "",
    );
  }
  return out.slice(0, lines).join("\n");
}

const median = (values: number[]): number => values.toSorted((a, b) => a - b)[values.length >> 1]!;

describe("performance", () => {
  // Rescoring after an edit, once the file has been parsed and scored. The 50k-line file has more
  // comments than a size-capped cache would hold; its budget leaves room for slower CI machines.
  it.each([
    [5_000, 50],
    [50_000, 250],
  ])("rescores a %i-line file in under %ims after an edit", async (lines, budget) => {
    const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
    const trees = new DocumentTrees(new GrammarLoader(wasmDir, wasmDir));
    const zipf = loadZipf("data/zipf-en.json");
    // Like the workspace vocabulary: one set until the workspace changes.
    const vocabulary = new Set(["ledger", "idempotency"]);
    const analyzer = new CommentAnalyzer({
      tree: (key) => trees.get(key),
      hasGrammar: () => true,
      vocabulary: async () => vocabulary,
      zipf: () => zipf,
      settings: () => DEFAULT_SETTINGS,
    });
    let text = source(lines);
    let version = 1;
    const document = { languageId: "typescript", version, getText: () => text };
    await trees.open("big.ts", { ...document });
    const first = await analyzer.analyze("big.ts", { ...document });
    expect(first.length).toBeGreaterThan(lines / 5);

    const timings: number[] = [];
    for (let edit = 0; edit < EDITS; edit++) {
      // Type one character into a comment somewhere in the file, as a user would.
      const offset = text.indexOf("Normalizes", (text.length / EDITS) * edit);
      const change: TextChange = {
        range: offsetRange(text, offset),
        rangeOffset: offset,
        rangeLength: 0,
        text: "x",
      };
      text = text.slice(0, offset) + "x" + text.slice(offset);
      version++;
      const edited = { languageId: "typescript", version, getText: () => text };

      const start = performance.now();
      trees.update("big.ts", edited, [change]);
      const scored = await analyzer.analyze("big.ts", edited);
      timings.push(performance.now() - start);
      expect(scored).toHaveLength(first.length);
    }
    const time = median(timings);
    console.log(`${lines} lines, rescore after edit: median ${time.toFixed(1)}ms of ${EDITS}`);
    expect(time).toBeLessThan(budget);
    trees.dispose();
  });
});

function offsetRange(text: string, offset: number): TextChange["range"] {
  const before = text.slice(0, offset).split("\n");
  const position = { line: before.length - 1, character: before.at(-1)!.length };
  return { start: position, end: position };
}
