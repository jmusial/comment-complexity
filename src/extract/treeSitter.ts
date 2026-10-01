import * as path from "node:path";
import { type Edit, Language, Parser, type Point, type Tree } from "@vscode/tree-sitter-wasm";
import { LANGUAGES } from "./languages";

/** VS Code language id to grammar file stem (`tree-sitter-<stem>.wasm`). */
const GRAMMARS = new Map<string, string>(
  [...LANGUAGES].map(([id, spec]) => [id, spec.grammar] as const),
);

// The WASM runtime is process-global: re-running `Parser.init` would invalidate already loaded languages.
let runtime: Promise<void> | undefined;

function initRuntime(runtimeDir: string): Promise<void> {
  runtime ??= Parser.init({
    locateFile: (file: string) => path.join(runtimeDir, file),
  }).catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}

export class GrammarLoader {
  private readonly languages = new Map<string, Promise<Language>>();

  constructor(
    private readonly runtimeDir: string,
    private readonly grammarDir: string,
  ) {}

  supports(languageId: string): boolean {
    return GRAMMARS.has(languageId);
  }

  /** Loads the grammar on first request; concurrent and later calls share one promise. */
  load(languageId: string): Promise<Language> | undefined {
    const stem = GRAMMARS.get(languageId);
    if (stem === undefined) {
      return undefined;
    }
    let language = this.languages.get(stem);
    if (!language) {
      language = initRuntime(this.runtimeDir)
        .then(() => Language.load(path.join(this.grammarDir, `tree-sitter-${stem}.wasm`)))
        .catch((error: unknown) => {
          this.languages.delete(stem);
          throw error;
        });
      this.languages.set(stem, language);
    }
    return language;
  }

  async createParser(languageId: string): Promise<Parser | undefined> {
    const language = await this.load(languageId);
    return language && new Parser().setLanguage(language);
  }
}

/** Structural subset of `vscode.TextDocument`, so this module stays testable without VS Code. */
export interface SourceDocument {
  readonly languageId: string;
  readonly version: number;
  getText(): string;
}

/** Structural subset of `vscode.TextDocumentContentChangeEvent`. */
export interface TextChange {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

/**
 * Converts a VS Code change to a tree-sitter edit. Both sides count UTF-16 code units,
 * so offsets and columns map 1:1.
 */
export function toEdit(change: TextChange): Edit {
  const { start, end } = change.range;
  const startPosition: Point = { row: start.line, column: start.character };
  const lines = change.text.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const newEndPosition: Point =
    lines.length === 1
      ? { row: start.line, column: start.character + lastLine.length }
      : { row: start.line + lines.length - 1, column: lastLine.length };
  return {
    startIndex: change.rangeOffset,
    oldEndIndex: change.rangeOffset + change.rangeLength,
    newEndIndex: change.rangeOffset + change.text.length,
    startPosition,
    oldEndPosition: { row: end.line, column: end.character },
    newEndPosition,
  };
}

interface Entry {
  readonly parser: Parser;
  tree: Tree;
  version: number;
}

/** One parser and syntax tree per open document, kept current by incremental reparse. */
export class DocumentTrees {
  private readonly entries = new Map<string, Entry>();
  /** Token per document whose grammar is still loading; replaced or dropped to cancel that open. */
  private readonly opening = new Map<string, object>();
  /** The open in progress per document, for `whenParsed`. */
  private readonly pending = new Map<string, Promise<Tree | undefined>>();

  constructor(
    private readonly loader: GrammarLoader,
    private readonly onError?: (key: string, error: unknown) => void,
  ) {}

  get(key: string): Tree | undefined {
    return this.entries.get(key)?.tree;
  }

  /**
   * Parses the document fully. Never rejects: failures go to `onError`. Resolves `undefined`
   * for unsupported languages, failures, or if closed meanwhile.
   */
  open(key: string, document: SourceDocument): Promise<Tree | undefined> {
    this.close(key);
    const token = {};
    this.opening.set(key, token);
    const parsed = this.parseFresh(key, document, token).catch((error: unknown) => {
      this.onError?.(key, error);
      return undefined;
    });
    this.pending.set(key, parsed);
    void parsed.then(() => {
      if (this.pending.get(key) === parsed) {
        this.pending.delete(key);
      }
    });
    return parsed;
  }

  /**
   * The document's tree once any open in progress has finished; `undefined` if it is not parsed,
   * as for unsupported languages. Never rejects.
   */
  whenParsed(key: string): Promise<Tree | undefined> {
    return this.pending.get(key) ?? Promise.resolve(this.get(key));
  }

  /**
   * Applies `changes` (in event order) to the cached tree, then reparses reusing unchanged subtrees.
   * `document` must already reflect the changes, as it does inside `onDidChangeTextDocument`.
   */
  update(key: string, document: SourceDocument, changes: readonly TextChange[]): Tree | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      // A pending open reads the latest text once the grammar is ready. Without one, an earlier
      // open failed, so try again rather than leave the document unparsed until it is reopened.
      if (!this.opening.has(key) && this.loader.supports(document.languageId)) {
        void this.open(key, document);
      }
      return undefined;
    }
    if (entry.version === document.version) {
      return entry.tree;
    }
    for (const change of changes) {
      entry.tree.edit(toEdit(change));
    }
    const tree = entry.parser.parse(document.getText(), entry.tree);
    if (!tree) {
      this.close(key);
      return undefined;
    }
    entry.tree.delete();
    entry.tree = tree;
    entry.version = document.version;
    return tree;
  }

  close(key: string): void {
    this.opening.delete(key);
    this.pending.delete(key);
    const entry = this.entries.get(key);
    if (entry) {
      entry.tree.delete();
      entry.parser.delete();
      this.entries.delete(key);
    }
  }

  dispose(): void {
    for (const key of [...this.entries.keys(), ...this.opening.keys()]) {
      this.close(key);
    }
  }

  private async parseFresh(
    key: string,
    document: SourceDocument,
    token: object,
  ): Promise<Tree | undefined> {
    let parser: Parser | undefined;
    try {
      parser = await this.loader.createParser(document.languageId);
    } finally {
      // Superseded by close() or a newer open() while the grammar was loading.
      if (this.opening.get(key) === token) {
        this.opening.delete(key);
      } else {
        parser?.delete();
        parser = undefined;
      }
    }
    if (!parser) {
      return undefined;
    }
    const tree = parser.parse(document.getText());
    if (!tree) {
      parser.delete();
      return undefined;
    }
    this.entries.set(key, { parser, tree, version: document.version });
    return tree;
  }
}
