import { splitIdentifier } from "../normalize/identifiers";

/**
 * Flags comments that only restate the name of the symbol they document, like `/** Gets the user *\/`
 * above `getUser`. Reported next to the score, not in it: such a comment is easy to read but tells
 * the reader nothing.
 */

export interface Redundancy {
  readonly redundant: boolean;
  /** Share of the comment's content words that the symbol name already says, 0 to 1. */
  readonly overlap: number;
  readonly reason?: string;
}

/** Overlap from which a comment counts as restating its symbol. */
export const REDUNDANCY_THRESHOLD = 0.75;

/** Words that carry no content of their own in a doc comment. */
const FILLER = new Set([
  "a",
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "corresponding",
  "current",
  "each",
  "for",
  "from",
  "function",
  "given",
  "helper",
  "if",
  "in",
  "instance",
  "into",
  "is",
  "it",
  "its",
  "just",
  "method",
  "new",
  "number",
  "object",
  "of",
  "on",
  "or",
  "provided",
  "simply",
  "specified",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "was",
  "with",
]);

/** Words that mean the same in a symbol name: accessor verbs and common abbreviations. */
const CANONICAL = new Map<string, string>([
  ...["return", "fetch", "retrieve", "obtain", "read", "load"].map(
    (word) => [word, "get"] as const,
  ),
  ...["update", "assign", "store"].map((word) => [word, "set"] as const),
  ...["make", "build", "construct"].map((word) => [word, "create"] as const),
  ...["remove", "destroy", "erase"].map((word) => [word, "delete"] as const),
  ["max", "maximum"],
  ["min", "minimum"],
  ["num", "number"],
  ["init", "initialize"],
  ["config", "configuration"],
  ["param", "parameter"],
  ["arg", "argument"],
  ["info", "information"],
  ["len", "length"],
  ["msg", "message"],
  ["err", "error"],
  ["ctx", "context"],
  ["idx", "index"],
  ["db", "database"],
  ["req", "request"],
  ["res", "response"],
  ["cb", "callback"],
]);

/** Light stemming, so "gets", "getting" and "get" meet: plurals, -ing and -ed. */
function stem(word: string): string {
  let stemmed = CANONICAL.get(word) ?? word;
  if (stemmed.length > 4 && stemmed.endsWith("ies")) {
    stemmed = `${stemmed.slice(0, -3)}y`;
  } else if (/(?:[sxz]|[cs]h)es$/.test(stemmed) && stemmed.length > 4) {
    stemmed = stemmed.slice(0, -2);
  } else if (stemmed.length > 3 && stemmed.endsWith("s") && !/(?:ss|us|is)$/.test(stemmed)) {
    stemmed = stemmed.slice(0, -1);
  }
  const suffix = /^(.{3,}?)(?:ing|ed)$/.exec(stemmed);
  if (suffix) {
    // "getting" → "gett" → "get".
    stemmed = suffix[1]!.replace(/([^aeiou])\1$/, "$1");
  }
  // Stripping -ing or -ed also drops a silent e: "retrieving" → "retriev", which is "retrieve".
  return CANONICAL.get(stemmed) ?? CANONICAL.get(`${stemmed}e`) ?? stemmed;
}

/** Same stem, or one a short extension of the other ("pars" from "parsed" and "parse"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
}

/** Stemmed words that say something; single letters (the "s" of "user's") are not words. */
const contentWords = (text: string): string[] =>
  [...text.toLowerCase().matchAll(/[\p{L}\p{N}]{2,}/gu)]
    .map(([word]) => word)
    .filter((word) => !FILLER.has(word))
    .map(stem);

/**
 * Compares a normalized comment with its target symbol's name. Without a symbol, or a comment with
 * no content words, nothing is redundant.
 */
export function redundancy(text: string, symbolName: string | undefined): Redundancy {
  if (symbolName === undefined) {
    return { redundant: false, overlap: 0 };
  }
  const comment = contentWords(text);
  if (comment.length === 0) {
    return { redundant: false, overlap: 0 };
  }
  const symbol = splitIdentifier(symbolName).split(" ").map(stem);
  const restated = comment.filter((word) => symbol.some((part) => sameWord(word, part))).length;
  const ratio = restated / comment.length;
  // Rounded for display only, so 0.745 is not flagged as 0.75.
  const overlap = Math.round(ratio * 100) / 100;
  return ratio >= REDUNDANCY_THRESHOLD
    ? { redundant: true, overlap, reason: `Restates the name "${symbolName}"` }
    : { redundant: false, overlap };
}
