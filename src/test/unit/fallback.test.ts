import { describe, expect, it } from "vitest";
import type { Comment } from "../../extract/comments";
import { FALLBACK_SYNTAXES, scanComments } from "../../extract/fallback";
import { LANGUAGES } from "../../extract/languages";

function scan(lines: string[], languageId: string): Comment[] {
  return scanComments(lines.join("\n"), FALLBACK_SYNTAXES.get(languageId)!);
}

const summary = ({ kind, rawText }: Comment) => ({ kind, rawText });

describe("scanComments", () => {
  it("Elixir: groups # runs, skips the header and ignores # in strings and heredocs", () => {
    const comments = scan(
      [
        "#!/usr/bin/env elixir",
        "# Copyright 2026 Someone.",
        "",
        "defmodule Greeter do",
        "  # Greets someone by name.",
        '  # Falls back to "world".',
        '  def hello(name) when name != "# not a comment" do',
        '    """',
        "    # still inside a heredoc",
        '    """ <> name # trailing note',
        "  end",
        "end",
      ],
      "elixir",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: '# Greets someone by name.\n# Falls back to "world".' },
      { kind: "line", rawText: "# trailing note" },
    ]);
    expect(comments[0]).toMatchObject({
      range: { start: { row: 4, column: 2 }, end: { row: 5, column: 26 } },
      targetSymbolName: undefined,
      approx: true,
    });
  });

  it("Haskell: doc comments, nested blocks, pragmas and primed names", () => {
    const comments = scan(
      [
        "{-# LANGUAGE OverloadedStrings #-}",
        "module Main where",
        "",
        "-- | Adds one.",
        "inc :: Int -> Int",
        "inc x' = x' + 1 -- uses a primed name",
        "",
        "{- Outer {- inner -} still outer -}",
        'arrow = "--> not a comment"',
      ],
      "haskell",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "-- | Adds one." },
      { kind: "line", rawText: "-- uses a primed name" },
      { kind: "block", rawText: "{- Outer {- inner -} still outer -}" },
    ]);
  });

  it("Kotlin: KDoc, raw strings, char literals and nested blocks", () => {
    const comments = scan(
      [
        "/**",
        " * Formats a price.",
        " */",
        "fun format(cents: Int): String {",
        '    val raw = """',
        "        // not a comment /* either",
        '    """',
        "    val quote = '\"' // char literal",
        "    /* outer /* nested */ still */",
        "    return raw",
        "}",
      ],
      "kotlin",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/**\n * Formats a price.\n */" },
      { kind: "line", rawText: "// char literal" },
      { kind: "block", rawText: "/* outer /* nested */ still */" },
    ]);
    expect(comments[0]?.range).toEqual({
      start: { row: 0, column: 0 },
      end: { row: 2, column: 3 },
    });
  });

  it("Lua: long comments, --- docs, long strings and luacheck", () => {
    const comments = scan(
      [
        "--[[",
        "  Inventory helpers.",
        "]]",
        "local M = {}",
        "",
        "--- Adds an item.",
        "--- @param name string",
        "function M.add(name)",
        "  local s = [[ -- not a comment ]]",
        "  -- luacheck: ignore 211",
        '  return s .. "--" -- concat',
        "end",
      ],
      "lua",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "block", rawText: "--[[\n  Inventory helpers.\n]]" },
      { kind: "doc", rawText: "--- Adds an item.\n--- @param name string" },
      { kind: "line", rawText: "-- concat" },
    ]);
  });

  it("SQL: doubled quotes do not end strings", () => {
    const comments = scan(
      [
        "-- Active users only.",
        "SELECT name -- display name",
        "FROM users",
        "WHERE note <> 'it''s -- not a comment'",
        "/* Excludes",
        "   test accounts. */",
        "AND id > 0;",
      ],
      "sql",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "-- Active users only." },
      { kind: "line", rawText: "-- display name" },
      { kind: "block", rawText: "/* Excludes\n   test accounts. */" },
    ]);
  });

  it("YAML: # only opens a comment after whitespace", () => {
    const comments = scan(
      [
        "# Deployment settings.",
        "url: http://example.com/#anchor",
        "name: 'don''t # keep'  # quoted hash",
        "tags: [a, b] # list",
      ],
      "yaml",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "# Deployment settings." },
      { kind: "line", rawText: "# quoted hash" },
      { kind: "line", rawText: "# list" },
    ]);
  });

  it("HTML: <!-- --> blocks, with apostrophes in text left alone", () => {
    const comments = scan(
      [
        "<!-- Copyright 2026 Someone. -->",
        "<p>Don't <!-- inline note --> panic</p>",
        "<!--",
        "  Navigation",
        "-->",
        "<!-- prettier-ignore -->",
      ],
      "html",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "block", rawText: "<!-- inline note -->" },
      { kind: "block", rawText: "<!--\n  Navigation\n-->" },
    ]);
  });

  it("skips structured data for tools", () => {
    const kotlin = FALLBACK_SYNTAXES.get("kotlin")!;
    const text = [
      "/* __GDPR__",
      '  "event" : { "owner": "someone" }',
      "*/",
      "// Sends the event once the network is back.",
      "fun send() {}",
    ].join("\n");
    expect(scanComments(text, kotlin).map(({ rawText }) => rawText)).toEqual([
      "// Sends the event once the network is back.",
    ]);
  });

  it("ends line comments before a CRLF", () => {
    const comments = scanComments(
      "// a\r\n// b\r\nval x = 1\r\n",
      FALLBACK_SYNTAXES.get("kotlin")!,
    );

    expect(comments.map(summary)).toEqual([{ kind: "line", rawText: "// a\n// b" }]);
    expect(comments[0]?.range.end).toEqual({ row: 1, column: 4 });
  });
});

describe("FALLBACK_SYNTAXES", () => {
  it("covers the languages without a bundled grammar and leaves the rest to tree-sitter", () => {
    const ids = [...FALLBACK_SYNTAXES.keys()];
    expect(ids).toEqual(
      expect.arrayContaining([
        "kotlin",
        "swift",
        "lua",
        "sql",
        "yaml",
        "scss",
        "html",
        "elixir",
        "haskell",
      ]),
    );
    expect(ids.filter((id) => LANGUAGES.has(id))).toEqual([]);
  });
});
