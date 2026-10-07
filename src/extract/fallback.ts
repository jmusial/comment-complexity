import type { Point } from "@vscode/tree-sitter-wasm";
import type { Comment, CommentKind } from "./comments";
import { LICENSE, isLicenseText, withoutLicense } from "./license";
import { withoutStructured } from "./structured";

export interface BlockSyntax {
  readonly start: string;
  readonly end: string;
  /** Inner `start`/`end` pairs nest, as in Kotlin, Swift or Haskell. */
  readonly nested?: boolean;
}

export interface StringSyntax {
  readonly open: string;
  readonly close: string;
  /** Skips the character after it, e.g. `\"`. */
  readonly escape?: string;
  /** A doubled `close` is an escaped quote, as in SQL's `'it''s'`. */
  readonly doubled?: boolean;
  /** Otherwise a newline ends the string, which limits the damage of a misread quote. */
  readonly multiline?: boolean;
}

/** Comment and string syntax for a language without a tree-sitter grammar. */
export interface CommentSyntax {
  readonly line: readonly string[];
  /** Line comments only start at a line start or after whitespace, like YAML's `#` (`a#b` is text). */
  readonly lineAfterSpace?: boolean;
  /** Checked before `line`, so Lua's `--[[` wins over `--`. */
  readonly block: readonly BlockSyntax[];
  readonly strings: readonly StringSyntax[];
  /** Prefixes of doc comments, line or block. */
  readonly docPrefixes: readonly string[];
  /** Matches the comment body (markers stripped) of directives. */
  readonly directive?: RegExp;
}

/**
 * Finds comments by scanning text, for languages without a bundled grammar. Groups consecutive line
 * comments and drops shebangs, license headers and directives like `extractComments`, but has no
 * target symbols or commented-out code check. Results are marked `approx`.
 */
export function scanComments(text: string, syntax: CommentSyntax): Comment[] {
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    lineStarts.push(i + 1);
  }
  const rowAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid]! <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  };
  const pointAt = (offset: number): Point => {
    const row = rowAt(offset);
    return { row, column: offset - lineStarts[row]! };
  };
  const isTrailing = (span: Span): boolean =>
    text.slice(lineStarts[rowAt(span.start)], span.start).trim() !== "";

  const groups: Span[][] = [];
  for (const span of scan(text, syntax)) {
    const raw = text.slice(span.start, span.end);
    const shebang = span.start === 0 && raw.startsWith("#!");
    if (shebang || syntax.directive?.test(bodyOf(raw, span, syntax))) {
      continue;
    }
    const group = groups.at(-1);
    const last = group?.at(-1);
    const continuesRun =
      last !== undefined &&
      !last.block &&
      !span.block &&
      // Plain and doc line comments (`--` vs `---`) do not mix.
      openerOf(text.slice(last.start, last.end), last, syntax) === openerOf(raw, span, syntax) &&
      !isTrailing(last) &&
      !isTrailing(span) &&
      rowAt(span.start) === rowAt(last.end) + 1;
    if (group && continuesRun) {
      group.push(span);
    } else {
      groups.push([span]);
    }
  }

  const comments: Comment[] = [];
  // Structured data and license text are cut out first, so prose in the same run survives.
  const spanBody = (span: Span): string => bodyOf(text.slice(span.start, span.end), span, syntax);
  for (const spans of groups.flatMap((group) =>
    withoutStructured(group, spanBody).flatMap((part) => withoutLicense(part, spanBody)),
  )) {
    const first = spans[0]!;
    const last = spans[spans.length - 1]!;
    const raws = spans.map((span) => text.slice(span.start, span.end));
    const body = spans.map((span, i) => bodyOf(raws[i]!, span, syntax)).join("\n");
    if (body === "" || (LICENSE.test(body) && !first.afterCode) || isLicenseText(body)) {
      continue;
    }
    comments.push({
      range: { start: pointAt(first.start), end: pointAt(last.end) },
      kind: kindOf(raws[0]!, first, syntax),
      rawText: raws.join("\n"),
      targetSymbolName: undefined,
      approx: true,
    });
  }
  return comments;
}

interface Span {
  readonly start: number;
  /** Exclusive; a line comment ends before its newline. */
  readonly end: number;
  readonly block?: BlockSyntax;
  /** Code appeared before it, so it is not part of a file header. */
  readonly afterCode: boolean;
}

/** Comment spans in document order, skipping over string literals. */
function scan(text: string, syntax: CommentSyntax): Span[] {
  // Longest opener first, so `"""` wins over `"`.
  const strings = syntax.strings.toSorted((a, b) => b.open.length - a.open.length);
  const spans: Span[] = [];
  let afterCode = false;
  let i = 0;
  while (i < text.length) {
    const block = syntax.block.find((candidate) => text.startsWith(candidate.start, i));
    if (block) {
      const end = blockEnd(text, i, block);
      spans.push({ start: i, end, block, afterCode });
      i = end;
      continue;
    }
    const lineStart =
      syntax.line.some((prefix) => text.startsWith(prefix, i)) &&
      (!syntax.lineAfterSpace || i === 0 || /\s/.test(text[i - 1]!));
    if (lineStart) {
      let end = text.indexOf("\n", i);
      end = end === -1 ? text.length : end;
      if (end > i && text[end - 1] === "\r") {
        end--;
      }
      spans.push({ start: i, end, afterCode });
      i = end;
      continue;
    }
    const string = strings.find((candidate) => text.startsWith(candidate.open, i));
    if (string) {
      i = stringEnd(text, i + string.open.length, string);
      afterCode = true;
      continue;
    }
    if (!/\s/.test(text[i]!)) {
      afterCode = true;
    }
    i++;
  }
  return spans;
}

/** Offset just past the block's end marker, or the text end if it is unterminated. */
function blockEnd(text: string, from: number, block: BlockSyntax): number {
  let depth = 1;
  let i = from + block.start.length;
  while (i < text.length) {
    if (text.startsWith(block.end, i)) {
      i += block.end.length;
      depth--;
      if (depth === 0) {
        return i;
      }
    } else if (block.nested && text.startsWith(block.start, i)) {
      i += block.start.length;
      depth++;
    } else {
      i++;
    }
  }
  return text.length;
}

/** Offset just past the string's closing quote, at an unexpected newline, or at the text end. */
function stringEnd(text: string, from: number, string: StringSyntax): number {
  let i = from;
  while (i < text.length) {
    if (string.escape !== undefined && text[i] === string.escape) {
      i += 2;
    } else if (text.startsWith(string.close, i)) {
      if (!string.doubled || !text.startsWith(string.close, i + string.close.length)) {
        return i + string.close.length;
      }
      i += 2 * string.close.length;
    } else if (text[i] === "\n" && !string.multiline) {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
}

function openerOf(raw: string, span: Span, syntax: CommentSyntax): string {
  return (
    syntax.docPrefixes.find((prefix) => raw.startsWith(prefix)) ??
    span.block?.start ??
    syntax.line.find((prefix) => raw.startsWith(prefix)) ??
    ""
  );
}

function kindOf(raw: string, span: Span, syntax: CommentSyntax): CommentKind {
  if (syntax.docPrefixes.some((prefix) => raw.startsWith(prefix))) {
    return "doc";
  }
  return span.block ? "block" : "line";
}

/** Comment text without markers, leading `*` gutters or surrounding whitespace. */
function bodyOf(raw: string, span: Span, syntax: CommentSyntax): string {
  const opener = openerOf(raw, span, syntax);
  if (!span.block) {
    const linePrefix = syntax.line.find((prefix) => raw.startsWith(prefix)) ?? "";
    let body = raw.slice(opener.length);
    // `////`, `##` or Lua's `---` beyond a doc prefix are still markers.
    while (body !== "" && linePrefix.includes(body[0]!)) {
      body = body.slice(1);
    }
    return body.trim();
  }
  const { end } = span.block;
  // `max` keeps an empty `/**/` from overlapping its own opener.
  const stop = raw.endsWith(end) ? Math.max(opener.length, raw.length - end.length) : raw.length;
  return raw
    .slice(opener.length, stop)
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n")
    .trim();
}

const cBlock: BlockSyntax = { start: "/*", end: "*/" };
const cNested: BlockSyntax = { ...cBlock, nested: true };
const doubleQuoted: StringSyntax = { open: '"', close: '"', escape: "\\" };
const singleQuoted: StringSyntax = { open: "'", close: "'", escape: "\\" };
const tripleDouble: StringSyntax = { open: '"""', close: '"""', escape: "\\", multiline: true };
const tripleSingle: StringSyntax = { open: "'''", close: "'''", escape: "\\", multiline: true };
const hash: Pick<CommentSyntax, "line" | "block" | "docPrefixes"> = {
  line: ["#"],
  block: [],
  docPrefixes: [],
};

const kotlin: CommentSyntax = {
  line: ["//"],
  block: [cNested],
  // Raw strings have no escapes.
  strings: [{ open: '"""', close: '"""', multiline: true }, doubleQuoted, singleQuoted],
  docPrefixes: ["/**"],
  directive: /^\s*(?:noinspection\b|@formatter:(?:off|on)\b|ktlint-(?:disable|enable)\b)/,
};

const swift: CommentSyntax = {
  line: ["//"],
  block: [cNested],
  strings: [tripleDouble, doubleQuoted],
  docPrefixes: ["///", "/**"],
  directive: /^\s*swiftlint:/,
};

const objectiveC: CommentSyntax = {
  line: ["//"],
  block: [cBlock],
  strings: [doubleQuoted, singleQuoted],
  docPrefixes: ["///", "/**"],
  directive: /^\s*(?:NOLINT\w*|clang-format\s+(?:off|on)\b)/,
};

const cssLike: CommentSyntax = {
  line: ["//"],
  block: [cBlock],
  strings: [doubleQuoted, singleQuoted],
  // SassDoc.
  docPrefixes: ["///"],
  directive: /^\s*(?:stylelint-(?:disable|enable)\S*|prettier-ignore\b)/,
};

const markup: CommentSyntax = {
  line: [],
  block: [{ start: "<!--", end: "-->" }],
  // Apostrophes in prose would open strings, and comments cannot appear inside attribute values.
  strings: [],
  docPrefixes: [],
  directive: /^\s*(?:prettier-ignore\b|htmlhint\b|#(?:end)?region\b)/,
};

/** Languages scanned without a grammar, keyed by VS Code language id. */
export const FALLBACK_SYNTAXES: ReadonlyMap<string, CommentSyntax> = new Map<string, CommentSyntax>(
  [
    ["kotlin", kotlin],
    ["swift", swift],
    ["objective-c", objectiveC],
    ["objective-cpp", objectiveC],
    [
      "dart",
      {
        line: ["//"],
        block: [cNested],
        strings: [tripleDouble, tripleSingle, doubleQuoted, singleQuoted],
        docPrefixes: ["///", "/**"],
        directive: /^\s*ignore(?:_for_file)?:/,
      },
    ],
    [
      "scala",
      {
        line: ["//"],
        block: [cNested],
        strings: [tripleDouble, doubleQuoted, singleQuoted],
        docPrefixes: ["/**"],
      },
    ],
    [
      "groovy",
      {
        line: ["//"],
        block: [cBlock],
        strings: [tripleDouble, tripleSingle, doubleQuoted, singleQuoted],
        docPrefixes: ["/**"],
      },
    ],
    [
      "fsharp",
      {
        line: ["//"],
        block: [{ start: "(*", end: "*)", nested: true }],
        strings: [tripleDouble, doubleQuoted],
        docPrefixes: ["///"],
      },
    ],
    [
      "lua",
      {
        line: ["--"],
        block: [{ start: "--[[", end: "]]" }],
        strings: [{ open: "[[", close: "]]", multiline: true }, doubleQuoted, singleQuoted],
        docPrefixes: ["---"],
        directive: /^\s*(?:luacheck:|@diagnostic\b)/,
      },
    ],
    [
      "sql",
      {
        line: ["--"],
        block: [cBlock],
        strings: [
          { open: "'", close: "'", doubled: true, multiline: true },
          { open: '"', close: '"', doubled: true },
        ],
        docPrefixes: [],
      },
    ],
    [
      "yaml",
      {
        ...hash,
        lineAfterSpace: true,
        strings: [doubleQuoted, { open: "'", close: "'", doubled: true }],
        directive: /^\s*(?:yaml-language-server:|yamllint\s+(?:disable|enable)|prettier-ignore\b)/,
      },
    ],
    ["scss", cssLike],
    ["less", { ...cssLike, docPrefixes: [] }],
    ["html", markup],
    ["xml", markup],
    [
      "elixir",
      {
        ...hash,
        strings: [tripleDouble, tripleSingle, { ...doubleQuoted, multiline: true }, singleQuoted],
        directive: /^\s*credo:/,
      },
    ],
    [
      "haskell",
      {
        line: ["--"],
        block: [{ start: "{-", end: "-}", nested: true }],
        // `'` also ends identifiers like `foldl'`, so only double quotes open strings.
        strings: [doubleQuoted],
        docPrefixes: ["-- |", "-- ^", "{-|"],
        // `{-# LANGUAGE … #-}` pragmas.
        directive: /^#/,
      },
    ],
    ["erlang", { line: ["%"], block: [], strings: [doubleQuoted], docPrefixes: [] }],
    ["clojure", { line: [";"], block: [], strings: [doubleQuoted], docPrefixes: [] }],
    // Roxygen.
    ["r", { ...hash, strings: [doubleQuoted, singleQuoted], docPrefixes: ["#'"] }],
    [
      "julia",
      {
        ...hash,
        block: [{ start: "#=", end: "=#", nested: true }],
        // `'` is also the transpose operator.
        strings: [tripleDouble, doubleQuoted],
      },
    ],
    ["perl", { ...hash, strings: [doubleQuoted, singleQuoted] }],
    [
      "powershell",
      {
        ...hash,
        block: [{ start: "<#", end: "#>" }],
        strings: [
          { open: '"', close: '"', escape: "`" },
          { open: "'", close: "'", doubled: true },
        ],
        directive: /^\s*requires\b/i,
      },
    ],
    [
      "dockerfile",
      {
        ...hash,
        lineAfterSpace: true,
        strings: [doubleQuoted, singleQuoted],
        // Parser directives.
        directive: /^\s*(?:syntax|escape|check)=/,
      },
    ],
    // Recipes are shell, whose quotes would clash with apostrophes in prose.
    ["makefile", { ...hash, strings: [] }],
    [
      "toml",
      {
        ...hash,
        // Literal (single-quoted) strings have no escapes.
        strings: [
          tripleDouble,
          { open: "'''", close: "'''", multiline: true },
          doubleQuoted,
          { open: "'", close: "'" },
        ],
        directive: /^\s*:schema\b/,
      },
    ],
    ["ini", { line: [";", "#"], lineAfterSpace: true, block: [], strings: [], docPrefixes: [] }],
  ],
);
