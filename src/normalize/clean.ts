import type { CommentKind } from "../extract/comments";
import { godocLines, jsdocLines, pythonLines, xmldocLines } from "./dialects";
import { IDENTIFIER_TOKEN, isIdentifier, splitIdentifier } from "./identifiers";

/**
 * Doc comment conventions. `jsdoc` covers every `@tag` style (TSDoc, Javadoc, KDoc, PHPDoc,
 * Doxygen); `markdown` is rustdoc; `plain` is any non-doc comment.
 */
export type Dialect = "jsdoc" | "markdown" | "python" | "xmldoc" | "godoc" | "plain";

export interface NormalizedComment {
  /** Prose with markup removed; one line per paragraph, tag section or list item. */
  readonly text: string;
  /** Identifiers the comment mentions, as written, without duplicates. */
  readonly identifiers: readonly string[];
}

export function dialectFor(languageId: string, kind: CommentKind): Dialect {
  // Go doc comments are ordinary line comments.
  if (languageId === "go") {
    return "godoc";
  }
  if (kind !== "doc") {
    return "plain";
  }
  switch (languageId) {
    case "python":
      return "python";
    case "csharp":
      return "xmldoc";
    case "rust":
      return "markdown";
    default:
      return "jsdoc";
  }
}

/** Turns a comment's raw text into prose that metrics can measure. */
export function normalize(rawText: string, dialect: Dialect): NormalizedComment {
  const identifiers = new Set<string>();
  let lines = withoutCode(withoutMarkers(rawText));
  switch (dialect) {
    case "jsdoc":
      lines = jsdocLines(lines, identifiers);
      break;
    case "python":
      lines = pythonLines(lines, identifiers);
      break;
    case "xmldoc":
      lines = xmldocLines(lines, identifiers);
      break;
    case "godoc":
      lines = godocLines(lines);
      break;
    case "markdown":
    case "plain":
      break;
  }
  // After the dialects: NumPy docstrings mark their section titles with `-----` underlines.
  const text = units(withoutRules(lines))
    .map((unit) => inline(unit, dialect, identifiers))
    .filter((unit) => unit !== "")
    .join("\n");
  return { text, identifiers: [...identifiers] };
}

/** Block delimiters, longer openers first. */
const BLOCKS: readonly (readonly [string, string])[] = [
  ["/**", "*/"],
  ["/*!", "*/"],
  ["/*", "*/"],
  ["<!--", "-->"],
  ["{-|", "-}"],
  ["{-", "-}"],
  ["=begin", "=end"],
  ["(*", "*)"],
  ["--[[", "]]"],
  ["#=", "=#"],
  ["<#", "#>"],
];

const DOCSTRING = /^[rRuUbBfF]{0,2}("""|'''|"|')([\s\S]*)\1$/;

/** One line-comment marker, then one space. Tabs stay: Go marks code blocks with them. */
const LINE_MARKER = /^[ \t]*(?:\/\/[/!]?|#'|#+|-{2,}(?: ?[|^])?|;+|%+) ?/;

/** A block comment's `*` gutter. */
const GUTTER = /^[ \t]*\*(?!\/) ?/;

function withoutMarkers(rawText: string): string[] {
  const text = rawText.trim();
  const docstring = DOCSTRING.exec(text);
  if (docstring) {
    return docstring[2]!.split("\n");
  }
  const block = BLOCKS.find(([open]) => text.startsWith(open));
  if (block) {
    const [open, close] = block;
    const end =
      text.endsWith(close) && text.length - close.length >= open.length
        ? text.length - close.length
        : text.length;
    return (
      text
        .slice(open.length, end)
        .split("\n")
        // A rule is checked before the gutter goes: ` * * *` would otherwise lose a star to it.
        .map((line) => (RULE.test(line.trim()) ? "" : line.replace(GUTTER, "")))
    );
  }
  return text.split("\n").map((line) => line.replace(LINE_MARKER, ""));
}

/** Characters separator rules are drawn with, box-drawing ones included. */
const RULE_CHARACTER = "[-=*#~_+\\u2500-\\u257F]";

/** A separator rule: three or more rule characters, maybe spaced (`-----`, `* * *`, `═══`). */
const RULE = new RegExp(`^(?:${RULE_CHARACTER}\\s*){3,}$`, "u");

/** Rule runs decorating a heading, like `===== Helpers =====` or `---- Setup`. */
const DECORATION = new RegExp(`^${RULE_CHARACTER}{4,}\\s+|\\s+${RULE_CHARACTER}{4,}$`, "gu");

/**
 * Turns separator rules into blank lines, so they neither reach the metrics nor glue a heading to
 * the text below it, and trims rule runs off decorated headings.
 */
function withoutRules(lines: string[]): string[] {
  return lines.map((line) => {
    const trimmed = line.trim();
    return RULE.test(trimmed) ? "" : trimmed.replace(DECORATION, "");
  });
}

/** Drops fenced code blocks and doctests (`>>>` lines and their output). */
function withoutCode(lines: string[]): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  let doctest = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (fence !== undefined) {
      // CommonMark: same character, at least as long, nothing after it. "```ts" stays inside.
      const closing = /^(`{3,}|~{3,})\s*$/.exec(trimmed)?.[1];
      if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    const opening = /^(`{3,}|~{3,})/.exec(trimmed);
    if (opening) {
      fence = opening[1]!;
      out.push("");
      continue;
    }
    if (/^>>>(?:\s|$)/.test(trimmed)) {
      doctest = true;
    } else if (trimmed === "") {
      doctest = false;
    }
    out.push(doctest ? "" : line);
  }
  return out;
}

/**
 * A link reference definition, `[label]: destination "title"`. CommonMark lets the destination and
 * the title follow on later lines, and the title span several lines.
 */
const DEFINITION = /^\[[^\]]+\]:(?:\s+(\S+))?/;

const TITLE_CLOSE: Readonly<Record<string, string>> = { '"': '"', "'": "'", "(": ")" };

/**
 * Joins lines into units: paragraphs, tag sections and list items. Drops markdown headings and
 * link reference definitions.
 */
function units(lines: string[]): string[] {
  const result: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      result.push(current.join(" "));
      current = [];
    }
  };
  // What a link reference definition may still continue with on the next lines.
  let definition: "destination" | "title" | undefined;
  // Closing character of a title that spans lines.
  let titleClose: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (titleClose !== undefined && line !== "") {
      if (line.endsWith(titleClose)) {
        titleClose = undefined;
      }
      continue;
    }
    // A blank line ends a title.
    titleClose = undefined;
    if (definition !== undefined && line !== "") {
      if (definition === "destination" && /^\S+$/.test(line)) {
        definition = "title";
        continue;
      }
      const close = TITLE_CLOSE[line[0]!];
      if (definition === "title" && close !== undefined) {
        definition = undefined;
        if (line.length === 1 || !line.endsWith(close)) {
          titleClose = close;
        }
        continue;
      }
    }
    definition = undefined;
    const reference = DEFINITION.exec(line);
    if (reference) {
      flush();
      const rest = line.slice(reference[0].length).trim();
      const close = TITLE_CLOSE[rest[0] ?? ""];
      if (reference[1] === undefined) {
        definition = "destination";
      } else if (close === undefined) {
        // No title yet; one may follow on the next line.
        definition = "title";
      } else if (rest.length === 1 || !rest.endsWith(close)) {
        // The title opens here and continues on later lines.
        titleClose = close;
      }
      continue;
    }
    if (line === "" || /^#{1,6}\s/.test(line)) {
      flush();
      continue;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      current.push(item[1]!);
      continue;
    }
    current.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return result;
}

const URL = /https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"\]]|\bwww\.[^\s<>]*[^\s<>.,;:!?)'"\]]/g;

/** A reference written as code: one identifier or path, maybe called. */
const CODE_REFERENCE = /^[\w$]+(?:(?:::|\.|->|#)[\w$]+)*(?:\(\))?$/;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Resolves inline markup in one unit to prose and splits identifiers into words. */
function inline(unit: string, dialect: Dialect, identifiers: Set<string>): string {
  /** Inline code: a single reference reads as its words, anything longer is dropped. */
  const code = (source: string): string => {
    // Rust's `&str` or `&mut T` read as the type.
    const trimmed = source.trim().replace(/^(?:&(?:mut\s+)?|\*+)/, "");
    if (/^\d[\d_.]*$/.test(trimmed)) {
      return trimmed;
    }
    if (!CODE_REFERENCE.test(trimmed)) {
      return "";
    }
    const name = trimmed.replace(/\(\)$/, "");
    identifiers.add(name);
    return splitIdentifier(name.replaceAll("->", ".").replaceAll("#", "."));
  };
  let text = unit;
  if (dialect === "jsdoc") {
    text = text
      .replace(
        /\{@link(?:code|plain)?\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g,
        (_, target: string, label: string) =>
          label.trim() !== ""
            ? label.trim()
            : // Javadoc `#member` and `Type#method(int)` targets.
              code(target.replace(/^#/, "").replace(/\([^)]*\)$/, "()")),
      )
      .replace(/\{@(?:code|literal)\s+([^}]*)\}/g, (_, source: string) => code(source))
      .replace(/\{@\w+[^}]*\}/g, "")
      // Doxygen's inline `@p name`, `\c name`, `@ref name`.
      // Whole name segments only, so a sentence's full stop stays out of the name.
      .replace(
        /(?<![\w@])[@\\](?:p|a|c|e|b|em|ref)\s+([\w$]+(?:(?:::|\.)[\w$]+)*)/g,
        (_, name: string) => code(name),
      );
  }
  if (dialect === "python") {
    // reST roles like :class:`Foo`, :func:`text <target>` or :meth:`~pkg.Foo.bar` (shown as `bar`).
    text = text.replace(
      /:\w+(?::\w+)?:`([^`<]*?)\s*(?:<([^>]+)>)?`/g,
      (_, label: string, target: string | undefined) =>
        target !== undefined && label !== ""
          ? label
          : code((target ?? label).replace(/^~(?:[\w.]*\.)?/, "")),
    );
  }
  text = text
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(URL, "");
  if (dialect !== "plain" && dialect !== "python") {
    // Intra-doc links (rustdoc, Go, TSDoc): [Foo], [`Foo`], [pkg.Func].
    text = text.replace(
      /\[`?([\w$]+(?:(?:::|\.)[\w$]+)*(?:\(\))?)`?\](?![([])/g,
      (_, name: string) => code(name),
    );
  }
  text = text.replace(/(`+)([^`]+?)\1/g, (_, _ticks: string, source: string) => code(source));
  if (dialect === "jsdoc" || dialect === "xmldoc" || dialect === "markdown") {
    text = text.replace(/<code>([\s\S]*?)<\/code>/gi, (_, source: string) => code(source));
    // Until stable, so removing one tag cannot join the text around it into another (`<<b>i>`).
    for (let previous = ""; previous !== text;) {
      previous = text;
      text = text.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, "");
    }
    // Entities go last, so an escaped `&lt;T&gt;` stays as text.
    text = text.replace(
      /&(?:lt|gt|amp|quot|#39|apos|nbsp);/g,
      (entity) => ENTITIES[entity] ?? entity,
    );
  }
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1")
    .replace(IDENTIFIER_TOKEN, (token) => {
      if (!isIdentifier(token)) {
        return token;
      }
      const name = token.replace(/\(\)$/, "");
      identifiers.add(name);
      return splitIdentifier(name);
    })
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
}
