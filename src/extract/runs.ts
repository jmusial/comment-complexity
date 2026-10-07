/** Leading block-comment gutter and indentation. */
const GUTTER = /^[\s*]*/;

/** A comment body's non-empty lines, without gutter or indentation. */
export const linesOf = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => line.replace(GUTTER, "").trim())
    .filter((line) => line !== "");

/**
 * Cuts the parts a filter drops out of a run of line comments, keeping the prose around them as
 * separate groups. Consecutive comments whose lines all pass `inPart` form a candidate part, which
 * is cut if `drop` accepts its text; empty comments join the part they sit in. `body` gives a
 * comment's text without its marker.
 */
export function cutParts<T>(
  comments: readonly T[],
  body: (comment: T) => string,
  inPart: (line: string) => boolean,
  drop: (text: string) => boolean,
): T[][] {
  const runs: T[][] = [];
  let candidate: boolean | undefined;
  for (const comment of comments) {
    const lines = linesOf(body(comment));
    const isCandidate = lines.length === 0 ? (candidate ?? false) : lines.every(inPart);
    if (isCandidate === candidate) {
      runs.at(-1)!.push(comment);
    } else {
      runs.push([comment]);
      candidate = isCandidate;
    }
  }
  const segments: T[][] = [];
  let current: T[] = [];
  for (const run of runs) {
    if (drop(run.map(body).join("\n"))) {
      if (current.length > 0) {
        segments.push(current);
      }
      current = [];
    } else {
      current.push(...run);
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}
