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
 * (`},`), or a quoted value alone (`"rule",`).
 */
const DATA_LINE = /^(?:"[^"]*"\s*:|[[\]{}(),;\s]+$|"[^"]*"\s*,?\s*$)/;

/** Leading block-comment gutter and indentation. */
const GUTTER = /^[\s*]*/;

/** Fewest lines for the data share to mean anything; a one-line example stays prose. */
const MIN_DATA_LINES = 3;

/** Share of lines that must be data. */
const DATA_SHARE = 0.6;

/** Whether a comment body (markers removed) is structured data rather than prose. */
export function isStructured(body: string): boolean {
  const lines = body
    .split("\n")
    .map((line) => line.replace(GUTTER, "").trim())
    .filter((line) => line !== "");
  if (lines.length > 0 && ANNOTATION_MARKER.test(lines[0]!)) {
    return true;
  }
  const data = lines.filter((line) => DATA_LINE.test(line)).length;
  return data >= MIN_DATA_LINES && data / lines.length >= DATA_SHARE;
}
