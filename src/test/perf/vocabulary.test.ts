import { glob, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrammarLoader } from "../../extract/treeSitter";
import { WorkspaceVocabulary } from "../../vocab/workspace";

/** Budget for building the vocabulary of a 5,000-file workspace; CI machines are slower. */
const BUDGET_MS = 15_000;
const FILES = 5_000;

const NOUNS = ["ledger", "invoice", "account", "batch", "payment", "refund", "tax", "rate"];
const VERBS = ["settle", "split", "merge", "audit", "round", "post", "void", "match"];

const capitalized = (word: string): string => word[0]!.toUpperCase() + word.slice(1);

/** A source file of about 40 lines; its identifiers combine words differently per file. */
function source(i: number): string {
  const noun = NOUNS[i % NOUNS.length]!;
  const lines = [`import { ${noun}Store } from "./store";`, ""];
  for (let f = 0; f < 6; f++) {
    const verb = VERBS[(i + f) % VERBS.length]!;
    const other = NOUNS[(i + f + 3) % NOUNS.length]!;
    lines.push(
      `/** ${capitalized(verb)}s the ${noun} for the ${other}. */`,
      `export function ${verb}${capitalized(noun)}${capitalized(other)}(${other}Id: string): number {`,
      `  const pending${capitalized(noun)} = ${noun}Store.find(${other}Id);`,
      `  return pending${capitalized(noun)}.total;`,
      "}",
      "",
    );
  }
  return lines.join("\n");
}

/** Files are known by their path relative to the workspace. */
const uri = (relative: string) => ({ path: relative, toString: () => relative });

describe("performance", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vocabulary-"));
    for (let folder = 0; folder < FILES / 100; folder++) {
      await mkdir(path.join(root, `module${folder}`));
    }
    await Promise.all(
      Array.from({ length: FILES }, (_, i) =>
        writeFile(path.join(root, `module${Math.floor(i / 100)}`, `file${i}.ts`), source(i)),
      ),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(`builds the vocabulary of a ${FILES}-file workspace in under ${BUDGET_MS}ms, without blocking scoring`, async () => {
    const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
    const none = { dispose: () => {} };
    const vocabulary = new WorkspaceVocabulary(
      {
        findFiles: async (include, exclude, maxResults) => {
          const found = [];
          for await (const file of glob(include, { cwd: root, exclude: [exclude] })) {
            found.push(uri(file.split(path.sep).join("/")));
            if (found.length === maxResults) {
              break;
            }
          }
          return found;
        },
        readFile: (file) => readFile(path.join(root, file.path)),
        relativePath: (file) => file.path,
        onDidSaveTextDocument: () => none,
        onDidDeleteFiles: () => none,
        onDidRenameFiles: () => none,
      },
      new GrammarLoader(wasmDir, wasmDir),
      (file, error) => {
        throw new Error(`${file}: ${String(error)}`);
      },
    );

    const start = performance.now();
    // What scoring asks for: answered at once, while the scan runs in the background.
    expect(vocabulary.current().size).toBe(0);
    expect(performance.now() - start).toBeLessThan(50);

    const words = await vocabulary.words();
    const time = performance.now() - start;
    console.log(`Vocabulary of ${FILES} files: ${words.size} words in ${time.toFixed(0)}ms`);
    expect([...words]).toEqual(expect.arrayContaining([...NOUNS, ...VERBS, "pending", "store"]));
    expect(time).toBeLessThan(BUDGET_MS);
    vocabulary.dispose();
  });
});
