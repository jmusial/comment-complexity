import { glob, readFile } from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { DocumentTrees, GrammarLoader } from "../src/extract/treeSitter";
import { loadZipf } from "../src/metrics/zipf";
import { CommentAnalyzer, type ScoredComment } from "../src/score/analyzer";
import { DEFAULT_SETTINGS } from "../src/settings";
import { LANGUAGE_BY_EXTENSION } from "../src/vocab/vocabulary";
import { WorkspaceVocabulary } from "../src/vocab/workspace";

/**
 * Scores every supported file under a folder the way the extension would, to find crashes, slow
 * files and odd scores on real code: `pnpm smoke <folder>`. Not run in CI; see scripts/README.md.
 */

/**
 * Fallback-scanned languages by extension; grammar languages come from the vocabulary's map.
 * `.m` is left out: it is as often MATLAB as Objective-C, and VS Code decides that, not the name.
 */
const FALLBACK_EXTENSIONS = new Map([
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["swift", "swift"],
  ["mm", "objective-cpp"],
  ["dart", "dart"],
  ["scala", "scala"],
  ["groovy", "groovy"],
]);

const languageOf = (file: string): string | undefined => {
  const extension = path.extname(file).slice(1).toLowerCase();
  return LANGUAGE_BY_EXTENSION.get(extension) ?? FALLBACK_EXTENSIONS.get(extension);
};

/** How many entries each top list shows. */
const TOP = 10;

interface FileResult {
  readonly file: string;
  readonly languageId: string;
  readonly bytes: number;
  readonly ms: number;
  readonly comments: readonly ScoredComment[];
}

/** Files are known by their path relative to the folder. */
const uri = (relative: string) => ({ path: relative, toString: () => relative });
type Uri = ReturnType<typeof uri>;

const ms = (value: number): string => `${value.toFixed(0)}ms`;

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");

async function main(): Promise<void> {
  const root = process.argv[2];
  if (root === undefined) {
    throw new Error("Usage: pnpm smoke <folder>");
  }
  const loader = new GrammarLoader(wasmDir, wasmDir);
  const none = { dispose: () => {} };
  const vocabulary = new WorkspaceVocabulary<Uri>(
    {
      findFiles: async (include, exclude, maxResults) => {
        const found: Uri[] = [];
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
    loader,
    (file, error) => console.error(`vocabulary: ${file}: ${String(error)}`),
  );

  let start = performance.now();
  const words = await vocabulary.words();
  const vocabularyMs = performance.now() - start;

  const trees = new DocumentTrees(loader);
  const zipf = loadZipf("data/zipf-en.json");
  const analyzer = new CommentAnalyzer({
    tree: (key) => trees.get(key),
    hasGrammar: (languageId) => loader.supports(languageId),
    vocabulary: async () => words,
    zipf: () => zipf,
    settings: () => DEFAULT_SETTINGS,
  });

  const files: string[] = [];
  for await (const file of glob("**/*", { cwd: root, exclude: ["**/{node_modules,.git}/**"] })) {
    if (languageOf(file) !== undefined) {
      files.push(file);
    }
  }
  files.sort();

  const results: FileResult[] = [];
  const failures: { file: string; error: string }[] = [];
  start = performance.now();
  for (const [i, file] of files.entries()) {
    const languageId = languageOf(file)!;
    let text: string;
    try {
      text = await readFile(path.join(root, file), "utf8");
    } catch {
      // A directory named like a source file, or a broken link.
      continue;
    }
    const document = { languageId, version: 1, getText: () => text };
    const fileStart = performance.now();
    try {
      await trees.open(file, document);
      const comments = await analyzer.analyze(file, document);
      results.push({
        file,
        languageId,
        bytes: text.length,
        ms: performance.now() - fileStart,
        comments,
      });
    } catch (error) {
      failures.push({ file, error: error instanceof Error ? error.message : String(error) });
    } finally {
      trees.close(file);
      analyzer.forget(file);
    }
    if ((i + 1) % 2_000 === 0) {
      console.error(`… ${i + 1} of ${files.length} files`);
    }
  }
  const scoringMs = performance.now() - start;
  report(root, results, failures, { vocabularyMs, scoringMs, words: words.size });
}

function report(
  root: string,
  results: readonly FileResult[],
  failures: readonly { file: string; error: string }[],
  { vocabularyMs, scoringMs, words }: { vocabularyMs: number; scoringMs: number; words: number },
): void {
  const comments = results.flatMap(({ file, comments: scored }) =>
    scored.map((comment) => ({ file, comment })),
  );
  const labels = { easy: 0, ok: 0, hard: 0 };
  for (const { comment } of comments) {
    labels[comment.score.label]++;
  }
  const byLanguage = new Map<string, { files: number; comments: number; approx: number }>();
  for (const { languageId, comments: scored } of results) {
    const entry = byLanguage.get(languageId) ?? { files: 0, comments: 0, approx: 0 };
    entry.files++;
    entry.comments += scored.length;
    entry.approx += scored.filter(({ comment }) => comment.approx).length;
    byLanguage.set(languageId, entry);
  }
  const percent = (part: number) =>
    `${comments.length === 0 ? 0 : Math.round((part / comments.length) * 100)}%`;

  console.log(`# Smoke run: ${root}\n`);
  console.log(`Vocabulary: ${words} words in ${ms(vocabularyMs)}`);
  console.log(
    `Scored: ${results.length} files, ${comments.length} comments in ${ms(scoringMs)}` +
      ` (easy ${percent(labels.easy)}, ok ${percent(labels.ok)}, hard ${percent(labels.hard)})`,
  );
  console.log(`Failures: ${failures.length}`);
  for (const { file, error } of failures.slice(0, TOP)) {
    console.log(`  ${file}: ${error}`);
  }

  console.log("\nBy language:");
  for (const [languageId, entry] of [...byLanguage].toSorted((a, b) => b[1].files - a[1].files)) {
    const approx = entry.approx > 0 ? ` (${entry.approx} approx)` : "";
    console.log(`  ${languageId}: ${entry.files} files, ${entry.comments} comments${approx}`);
  }

  console.log(`\nSlowest files (open + score):`);
  for (const { file, ms: time, bytes, comments: scored } of results
    .toSorted((a, b) => b.ms - a.ms)
    .slice(0, TOP)) {
    console.log(
      `  ${ms(time)}  ${file} (${Math.round(bytes / 1024)} KB, ${scored.length} comments)`,
    );
  }

  console.log(`\nHighest scores:`);
  for (const { file, comment } of comments
    .toSorted((a, b) => b.comment.score.score - a.comment.score.score)
    .slice(0, TOP)) {
    const excerpt = comment.text.split("\n")[0]!.slice(0, 90);
    console.log(
      `  ${comment.score.score.toFixed(1)}  ${file}:${comment.comment.range.start.row + 1}  ${excerpt}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
