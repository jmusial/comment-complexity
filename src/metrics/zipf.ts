import { readFileSync } from "node:fs";

/** Zipf frequency of a lower-cased word (log10 per billion words), or `undefined` if unlisted. */
export type ZipfLookup = (word: string) => number | undefined;

/**
 * Reads `data/zipf-en.json`. The file ships next to the bundle rather than inside it, so its
 * CC BY-SA attribution stays with it.
 */
export function loadZipf(file: string): ZipfLookup {
  const { words } = JSON.parse(readFileSync(file, "utf8")) as { words: Record<string, number> };
  const table = new Map(Object.entries(words));
  return (word) => table.get(word);
}
