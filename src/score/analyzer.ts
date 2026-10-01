import type { Tree } from "@vscode/tree-sitter-wasm";
import { type Comment, extractComments } from "../extract/comments";
import { FALLBACK_SYNTAXES, scanComments } from "../extract/fallback";
import { LANGUAGES } from "../extract/languages";
import type { SourceDocument } from "../extract/treeSitter";
import { type Redundancy, redundancy } from "../metrics/redundancy";
import type { ZipfLookup } from "../metrics/zipf";
import { dialectFor, normalize } from "../normalize/clean";
import { type Score, composite, measure } from "./composite";

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
}

/**
 * Scores a document's comments, cached per document version. Languages with a grammar wait for
 * their tree; fallback languages are scanned and marked `approx`; others have nothing to score.
 */
export class CommentAnalyzer {
  private readonly cache = new Map<
    string,
    { readonly version: number; readonly comments: Promise<ScoredComment[]> }
  >();
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
    const comments = this.score(document.languageId, found);
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

  private async score(languageId: string, comments: Comment[]): Promise<ScoredComment[]> {
    if (comments.length === 0) {
      return [];
    }
    const vocabulary = await this.sources.vocabulary();
    this.zipf ??= this.sources.zipf();
    const scored: ScoredComment[] = [];
    for (const comment of comments) {
      const { text, identifiers } = normalize(
        comment.rawText,
        dialectFor(languageId, comment.kind),
      );
      const symbol = comment.targetSymbolName;
      const context = {
        identifiers: new Set(symbol === undefined ? identifiers : [...identifiers, symbol]),
        vocabulary,
        zipf: this.zipf,
      };
      const results = measure(text, context);
      if (results.words < MIN_WORDS) {
        continue;
      }
      scored.push({
        comment,
        text,
        words: results.words,
        score: composite(results),
        redundancy: redundancy(text, symbol),
      });
    }
    return scored;
  }
}
