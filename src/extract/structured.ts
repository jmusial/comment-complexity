/**
 * Comments that hold data for tools rather than prose for people, like VS Code's `__GDPR__`
 * telemetry annotations: scoring them as prose gives them the highest scores in a workspace.
 */

/**
 * A tool's marker, like `__GDPR__` or `__GDPR__FRAGMENT__`, opening the comment alone or followed by
 * data (`__GDPR__COMMON__ "common.tid" : {…}`). Prose about a constant ("__DEV__ is true in
 * development builds") stays prose.
 */
const ANNOTATION_MARKER = /^__[A-Z][A-Z0-9_]*__(?:$|\s+["{[])/;

/**
 * A line of JSON-like data: a quoted key (`"owner": "chrmarti",`), brackets and separators only
 * (`},`), or a lone value: quoted (`"rule",`), a number, `true`, `false` or `null` (`3,`).
 */
const DATA_LINE =
  /^(?:"[^"]*"\s*:|[[\]{}(),;\s]+$|(?:"[^"]*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\s*,?\s*$)/i;

/** Leading block-comment gutter and indentation. */
const GUTTER = /^[\s*]*/;

/** Fewest lines for the data share to mean anything; a one-line example stays prose. */
const MIN_LINES = 3;

/** Share of lines that must be data. */
const DATA_SHARE = 0.6;

const linesOf = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => line.replace(GUTTER, "").trim())
    .filter((line) => line !== "");

const isDataLine = (line: string): boolean => ANNOTATION_MARKER.test(line) || DATA_LINE.test(line);

/** Whether a comment body (markers removed) is structured data rather than prose. */
export function isStructured(body: string): boolean {
  const lines = linesOf(body);
  if (lines.length > 0 && ANNOTATION_MARKER.test(lines[0]!)) {
    return true;
  }
  const data = lines.filter((line) => DATA_LINE.test(line)).length;
  return lines.length >= MIN_LINES && data / lines.length >= DATA_SHARE;
}

/**
 * Splits a run of line comments around the structured data in it, so prose next to an annotation
 * survives: runs of data lines that are structured on their own are dropped, and the rest is
 * regrouped and dropped only if structured as a whole. `body` gives a comment's text without its
 * marker. A single comment, like a block comment, is kept or dropped whole.
 */
export function withoutStructured<T>(comments: readonly T[], body: (comment: T) => string): T[][] {
  if (comments.length === 0) {
    return [];
  }
  if (comments.length === 1) {
    return isStructured(body(comments[0]!)) ? [] : [[...comments]];
  }
  // Consecutive comments that are all data, or all prose.
  const runs: T[][] = [];
  let data: boolean | undefined;
  for (const comment of comments) {
    const lines = linesOf(body(comment));
    // An empty line comment belongs to the run it sits in.
    const isData = lines.length === 0 ? (data ?? false) : lines.every(isDataLine);
    if (isData === data) {
      runs.at(-1)!.push(comment);
    } else {
      runs.push([comment]);
      data = isData;
    }
  }
  const text = (run: readonly T[]): string => run.map(body).join("\n");
  const segments: T[][] = [];
  let current: T[] = [];
  for (const run of runs) {
    if (isStructured(text(run))) {
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
  return segments.filter((segment) => !isStructured(text(segment)));
}
