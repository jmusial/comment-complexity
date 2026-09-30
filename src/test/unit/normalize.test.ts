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
