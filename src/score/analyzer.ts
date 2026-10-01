import type { Tree } from "@vscode/tree-sitter-wasm";
import { DocumentCache, commentKey } from "../cache";
import { type Comment, extractComments } from "../extract/comments";
import { FALLBACK_SYNTAXES, scanComments } from "../extract/fallback";
import { LANGUAGES } from "../extract/languages";
import type { SourceDocument } from "../extract/treeSitter";
import { type Redundancy, redundancy } from "../metrics/redundancy";
import type { ZipfLookup } from "../metrics/zipf";
import { type Dialect, dialectFor, normalize } from "../normalize/clean";
import type { Settings } from "../settings";
import { DEFAULT_BANDS, type Score, composite, measure } from "./composite";

/** A comment with its score, ready to show. */
export interface ScoredComment {
  readonly comment: Comment;
  /** Normalized prose the metrics read. */
  readonly text: string;
  readonly words: number;
  readonly score: Score;
  readonly redundancy: Redundancy;
}

/** Below this many words a comment is a label, not prose, and gets no score. */
export const MIN_WORDS = 3;

export interface AnalyzerSources {
  /** The document's current syntax tree, if its grammar has parsed it. */
  readonly tree: (key: string) => Tree | undefined;
  /** Whether the language has a grammar, so its comments wait for the tree. */
  readonly hasGrammar: (languageId: string) => boolean;
  readonly vocabulary: () => Promise<ReadonlySet<string>>;
  /** Called once, on the first comment scored. */
  readonly zipf: () => ZipfLookup;
  /** Read per analysis; a change must replace the object, not mutate it. */
  readonly settings: () => ScoringSettings;
}

export type ScoringSettings = Pick<Settings, "weights" | "ramp" | "acronyms">;

/**
 * Scores a document's comments, cached per document version. Languages with a grammar wait for
 * their tree; fallback languages are scanned and marked `approx`; others have nothing to score.
 */
export class CommentAnalyzer {
  private readonly cache = new Map<
    string,
    { readonly version: number; readonly comments: Promise<ScoredComment[]> }
  >();
  /** Per comment, from each document's previous analysis; `null` for ones too short to score. */
  private readonly results = new DocumentCache<Omit<ScoredComment, "comment"> | null>();
  private zipf: ZipfLookup | undefined;

  constructor(private readonly sources: AnalyzerSources) {}

  analyze(key: string, document: SourceDocument): Promise<ScoredComment[]> {
    const cached = this.cache.get(key);
    if (cached?.version === document.version) {
      return cached.comments;
    }
    const found = this.comments(key, document);
    if (found === undefined) {
      // The tree is not parsed yet: ask again once it is, rather than caching nothing.
      return Promise.resolve([]);
    }
    const comments = this.score(key, document.languageId, found);
    this.cache.set(key, { version: document.version, comments });
    // A failure, like an unreadable vocabulary, is not kept: the next request tries again.
    comments.catch(() => {
      if (this.cache.get(key)?.comments === comments) {
        this.cache.delete(key);
      }
    });
    return comments;
  }

  forget(key: string): void {
    this.cache.delete(key);
    this.results.forget(key);
  }

  /** Drops every cached result, as when the settings change. */
  clear(): void {
    this.cache.clear();
    this.results.clear();
  }

  private comments(key: string, document: SourceDocument): Comment[] | undefined {
    const spec = LANGUAGES.get(document.languageId);
    if (spec !== undefined && this.sources.hasGrammar(document.languageId)) {
      const tree = this.sources.tree(key);
      return tree && extractComments(tree, spec);
    }
    const syntax = FALLBACK_SYNTAXES.get(document.languageId);
    return syntax === undefined ? [] : scanComments(document.getText(), syntax);
  }

  private async score(
    documentKey: string,
    languageId: string,
    comments: Comment[],
  ): Promise<ScoredComment[]> {
    if (comments.length === 0) {
      return [];
    }
    const settings = this.sources.settings();
    const workspace = await this.sources.vocabulary();
    // Both are replaced, never mutated, when they change; either way every result is stale.
    const results = this.results.begin(documentKey, [workspace, settings]);
    const scored: ScoredComment[] = [];
    for (const comment of comments) {
      const dialect = dialectFor(languageId, comment.kind);
      const key = commentKey(dialect, comment.rawText, comment.targetSymbolName);
      let result = results.get(key);
      if (result === undefined) {
        result = this.measure(comment, dialect, workspace, settings);
        results.set(key, result);
      }
      if (result !== null) {
        scored.push({ comment, ...result });
      }
    }
    return scored;
  }

  /** Scores one comment from scratch; `null` if it is too short to score. */
  private measure(
    comment: Comment,
    dialect: Dialect,
    workspace: ReadonlySet<string>,
    { weights, ramp, acronyms }: ScoringSettings,
  ): Omit<ScoredComment, "comment"> | null {
    this.zipf ??= this.sources.zipf();
    const { text, identifiers } = normalize(comment.rawText, dialect);
    const symbol = comment.targetSymbolName;
    const context = {
      identifiers: new Set(symbol === undefined ? identifiers : [...identifiers, symbol]),
      // Whitelisted acronyms are known terms: neither undefined nor rare.
      vocabulary: acronyms.size === 0 ? workspace : new Set([...workspace, ...acronyms]),
      zipf: this.zipf,
    };
    const results = measure(text, context);
    if (results.words < MIN_WORDS) {
      return null;
    }
    return {
      text,
      words: results.words,
      score: composite(results, weights, DEFAULT_BANDS, ramp),
      redundancy: redundancy(text, symbol),
    };
  }
}
