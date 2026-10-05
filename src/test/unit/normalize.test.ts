import { describe, expect, it } from "vitest";
import type { CommentKind } from "../../extract/comments";
import { type Dialect, dialectFor, normalize } from "../../normalize/clean";
import { isIdentifier, splitIdentifier } from "../../normalize/identifiers";
import { FIXTURES } from "./normalizeFixtures";

describe("normalize", () => {
  describe.each(Object.entries(FIXTURES) as [Dialect, (typeof FIXTURES)[Dialect]][])(
    "%s",
    (dialect, fixtures) => {
      it.each(fixtures)("$text", ({ raw, text, identifiers }) => {
        expect(normalize(raw, dialect)).toEqual({ text, identifiers });
      });
    },
  );
});

describe("separator rules", () => {
  it.each<[string, Dialect, string[], string]>([
    [
      "a rule above a heading, which then stands apart from the table below it",
      "plain",
      [
        "// -----------------------------------------------------------------------------",
        "// Compiler detection",
        "//",
        "//  V8_CC_GNU     - GCC, or clang in gcc mode",
      ],
      "Compiler detection\nv8 cc gnu - GCC, or clang in gcc mode",
    ],
    ["decoration around a heading", "plain", ["// ===== Helpers ====="], "Helpers"],
    ["decoration before a heading", "plain", ["# ---- Setup"], "Setup"],
    ["a divider alone", "plain", ["// =========="], ""],
    [
      "spaced and box-drawing rules in a block",
      "plain",
      ["/*", " * * * *", " * Retries the upload.", " * ═══════════", " */"],
      "Retries the upload.",
    ],
    [
      "a Markdown setext underline",
      "markdown",
      ["/// Overview", "/// ========", "///", "/// Retries the upload."],
      "Overview\nRetries the upload.",
    ],
    [
      "a rule between a description and its tags",
      "jsdoc",
      [
        "/**",
        " * Retries the upload.",
        " * --------------------",
        " * @param url Where to send it.",
        " */",
      ],
      "Retries the upload.\nWhere to send it.",
    ],
    [
      "NumPy section underlines, which still mark sections",
      "python",
      [
        '"""Sum of values.',
        "",
        "Parameters",
        "----------",
        "values : list",
        "    The values to add.",
        '"""',
      ],
      "Sum of values.\nThe values to add.",
    ],
    [
      "dashes and equals signs inside prose",
      "plain",
      ["// a -- b and c == d"],
      "a -- b and c == d",
    ],
  ])("drops %s", (_, dialect, raw, text) => {
    expect(normalize(raw.join("\n"), dialect).text).toBe(text);
  });
});

describe("dialectFor", () => {
  it.each<[string, CommentKind, Dialect]>([
    ["go", "line", "godoc"],
    ["typescript", "line", "plain"],
    ["typescript", "doc", "jsdoc"],
    ["java", "doc", "jsdoc"],
    ["kotlin", "doc", "jsdoc"],
    ["python", "doc", "python"],
    ["csharp", "doc", "xmldoc"],
    ["rust", "doc", "markdown"],
    ["rust", "line", "plain"],
  ])("%s %s comments use %s", (languageId, kind, dialect) => {
    expect(dialectFor(languageId, kind)).toBe(dialect);
  });
});

describe("isIdentifier", () => {
  it.each([
    ["getUser", true],
    ["get_user", true],
    ["MAX_AGE", true],
    ["HTTPServer", true],
    ["user.name", true],
    ["std::io", true],
    ["reset()", true],
    ["$sku", true],
    ["_private", true],
    ["URLs", false],
    ["API", false],
    ["Hello", false],
    ["JavaScript", false],
    ["iOS", false],
    ["e.g", false],
  ])("%s → %s", (token, expected) => {
    expect(isIdentifier(token)).toBe(expected);
  });
});

describe("splitIdentifier", () => {
  it.each([
    ["getUserName", "get user name"],
    ["HTTPServer", "http server"],
    ["MAX_AGE", "max age"],
    ["std::fs::read", "std fs read"],
    ["parse()", "parse"],
    ["utf8Decode", "utf8 decode"],
    ["$sku", "sku"],
  ])("%s → %s", (identifier, expected) => {
    expect(splitIdentifier(identifier)).toBe(expected);
  });
});
