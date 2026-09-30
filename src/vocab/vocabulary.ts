import type { Tree } from "@vscode/tree-sitter-wasm";
import { splitIdentifier } from "../normalize/identifiers";

/**
 * Words used in the codebase's identifiers. They are the project's own jargon, so a comment that
 * uses them is not using rare words or undefined acronyms.
 */

/** Most words kept; beyond this, the words used in the fewest files are dropped. */
export const MAX_WORDS = 20_000;

/** Words from all files, keyed by file, with the vocabulary computed on demand and cached. */
export class Vocabulary {
  private readonly byFile = new Map<string, ReadonlySet<string>>();
  /** Number of files each word appears in. */
  private readonly fileCounts = new Map<string, number>();
  private cached: ReadonlySet<string> | undefined;

  constructor(private readonly maxWords = MAX_WORDS) {}

  get files(): number {
    return this.byFile.size;
  }

  /** Replaces the words a file contributes. */
  set(file: string, words: Iterable<string>): void {
    this.remove(file);
    const unique = new Set(words);
    this.byFile.set(file, unique);
    for (const word of unique) {
      this.fileCounts.set(word, (this.fileCounts.get(word) ?? 0) + 1);
    }
    this.cached = undefined;
  }

  remove(file: string): void {
    const words = this.byFile.get(file);
    if (words === undefined) {
      return;
    }
    for (const word of words) {
      const count = this.fileCounts.get(word)! - 1;
      if (count === 0) {
        this.fileCounts.delete(word);
      } else {
        this.fileCounts.set(word, count);
      }
    }
    this.byFile.delete(file);
    this.cached = undefined;
  }

  /**
   * The vocabulary, capped at the most widespread words (ties alphabetical). Recomputed only after
   * a file changed; otherwise the same set is returned.
   */
  words(): ReadonlySet<string> {
    this.cached ??= new Set(
      [...this.fileCounts]
        .toSorted(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))
        .slice(0, this.maxWords)
        .map(([word]) => word),
    );
    return this.cached;
  }
}

/** Node types that name something, across grammars (Ruby `constant`, PHP `name`, Bash `variable_name`). */
const IDENTIFIER_NODE = /identifier$|^(?:constant|name|variable_name)$/;

/**
 * Lower-cased words of every identifier in the tree: `maxRetryCount` gives max, retry and count.
 * Only identifier nodes are read, so words in comments and strings stay out.
 */
export function identifierWords(tree: Tree): Set<string> {
  const words = new Set<string>();
  const cursor = tree.walk();
  try {
    for (;;) {
      if (cursor.nodeIsNamed && IDENTIFIER_NODE.test(cursor.nodeType)) {
        for (const word of splitIdentifier(cursor.nodeText).split(" ")) {
          if (/^[a-z]{2,}$/.test(word)) {
            words.add(word);
          }
        }
      }
      if (cursor.gotoFirstChild() || cursor.gotoNextSibling()) {
        continue;
      }
      // Climb until a node has a next sibling; back at the root, the walk is done.
      let next = false;
      while (!next && cursor.gotoParent()) {
        next = cursor.gotoNextSibling();
      }
      if (!next) {
        return words;
      }
    }
  } finally {
    cursor.delete();
  }
}

/** File extension to VS Code language id, for the languages with a grammar. */
export const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "typescriptreact"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "javascriptreact"],
  ["py", "python"],
  ["go", "go"],
  ["rs", "rust"],
  ["java", "java"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["hpp", "cpp"],
  ["cs", "csharp"],
  ["rb", "ruby"],
  ["php", "php"],
  ["sh", "shellscript"],
  ["bash", "shellscript"],
  ["css", "css"],
]);

export function languageForPath(filePath: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(filePath)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : LANGUAGE_BY_EXTENSION.get(extension);
}
