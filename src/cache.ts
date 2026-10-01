/**
 * Per-comment results kept from a document's previous analysis, so an edit rescores only the
 * comments it touched. Each analysis keeps just the comments it still has: memory follows what is
 * open, and unlike a size-capped cache, a file with more comments than the cap still hits.
 *
 * Results also depend on what every comment shares (workspace vocabulary, settings); a pass whose
 * `context` differs from the previous one, compared by identity, starts empty.
 */
export class DocumentCache<V> {
  private readonly documents = new Map<
    string,
    { readonly context: readonly unknown[]; readonly entries: Map<string, V> }
  >();

  /** Number of results kept across documents. */
  get size(): number {
    let size = 0;
    for (const { entries } of this.documents.values()) {
      size += entries.size;
    }
    return size;
  }

  /**
   * Starts an analysis of `document`: `get` finds results from its previous analysis (or this
   * one), `set` stores them for the next. The previous analysis's other results are dropped.
   */
  begin(document: string, context: readonly unknown[]): CachePass<V> {
    const previous = this.documents.get(document);
    const reusable =
      previous !== undefined &&
      previous.context.length === context.length &&
      previous.context.every((value, i) => value === context[i])
        ? previous.entries
        : undefined;
    const entries = new Map<string, V>();
    this.documents.set(document, { context, entries });
    return {
      get: (key) => {
        const value = entries.get(key) ?? reusable?.get(key);
        if (value !== undefined) {
          entries.set(key, value);
        }
        return value;
      },
      set: (key, value) => {
        entries.set(key, value);
      },
    };
  }

  forget(document: string): void {
    this.documents.delete(document);
  }

  clear(): void {
    this.documents.clear();
  }
}

/** Lookups and stores of one analysis; see `DocumentCache.begin`. */
export interface CachePass<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

/** Cache key of a comment: everything about it that its result depends on. */
export function commentKey(dialect: string, rawText: string, symbol: string | undefined): string {
  // NUL never occurs in source text, so the parts cannot run into each other.
  return `${dialect}\0${symbol ?? ""}\0${rawText}`;
}
