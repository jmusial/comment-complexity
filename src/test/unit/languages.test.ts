import { describe, expect, it } from "vitest";
import { extract, summary } from "./extract";

describe("extractComments per language", () => {
  it("Python: docstrings, # runs, directives and commented-out code", async () => {
    const comments = await extract(
      [
        "#!/usr/bin/env python3",
        "# Copyright 2026 Someone. MIT License.",
        '"""Module docstring."""',
        "import os  # noqa: F401",
        "# -*- coding: utf-8 -*-",
        "",
        "# Upper limit for retries.",
        "MAX = 3  # type: int",
        "",
        "",
        "@cached",
        "def load(path):",
        '    """Load the file at path."""',
        "    # x = read(path)",
        "    return path",
        "",
        "",
        "class Store:",
        "    '''Persists records.'''",
        "",
        "    # Keep in sync with the schema.",
        "    # Second line.",
        "    version = 2",
        "",
        "    def save(self):",
        '        return "not a docstring"',
      ],
      "python",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: '"""Module docstring."""', target: undefined },
      { kind: "line", rawText: "# Upper limit for retries.", target: "MAX" },
      { kind: "doc", rawText: '"""Load the file at path."""', target: "load" },
      { kind: "doc", rawText: "'''Persists records.'''", target: "Store" },
      {
        kind: "line",
        rawText: "# Keep in sync with the schema.\n# Second line.",
        target: "version",
      },
    ]);
  });

  it("Go: doc comments, directives and commented-out statements", async () => {
    const comments = await extract(
      [
        "// Package store keeps records.",
        "package store",
        "",
        "//go:generate stringer -type=Kind",
        "",
        "// Kind of a record.",
        "type Kind int",
        "",
        "// Save writes r.",
        "//",
        "// It returns an error on failure.",
        "func Save(r Record) error { //nolint:errcheck",
        "\t// err := write(r)",
        "\treturn nil",
        "}",
        "",
        "// Record is one entry.",
        "type Record struct {",
        "\t// ID is unique.",
        "\tID int",
        "}",
        "",
        "// Get returns the record.",
        "func (s *Store) Get() Record { return Record{} }",
        "",
        "const (",
        "\t// Max is the limit.",
        "\tMax = 10",
        ")",
      ],
      "go",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "// Package store keeps records.", target: "store" },
      { kind: "line", rawText: "// Kind of a record.", target: "Kind" },
      {
        kind: "line",
        rawText: "// Save writes r.\n//\n// It returns an error on failure.",
        target: "Save",
      },
      { kind: "line", rawText: "// Record is one entry.", target: "Record" },
      { kind: "line", rawText: "// ID is unique.", target: "ID" },
      { kind: "line", rawText: "// Get returns the record.", target: "Get" },
      { kind: "line", rawText: "// Max is the limit.", target: "Max" },
    ]);
  });

  it("Rust: outer and inner doc comments, attributes and newline-owning comments", async () => {
    const comments = await extract(
      [
        "//! Crate docs.",
        "",
        "/// Adds two numbers.",
        "/// Returns the sum.",
        "#[inline]",
        "pub fn add(a: i32, b: i32) -> i32 {",
        "    // let c = a * b;",
        "    a + b // plain sum",
        "}",
        "",
        "/** Block doc. */",
        "struct Point {",
        "    /// Horizontal.",
        "    x: i32,",
        "}",
        "",
        "// rustfmt::skip",
        "mod geometry {",
        "    //! Geometry helpers.",
        "}",
        "",
        "/* Plain block. */",
        "impl Point {}",
      ],
      "rust",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "//! Crate docs.", target: undefined },
      { kind: "doc", rawText: "/// Adds two numbers.\n/// Returns the sum.", target: "add" },
      { kind: "line", rawText: "// plain sum", target: undefined },
      { kind: "doc", rawText: "/** Block doc. */", target: "Point" },
      { kind: "doc", rawText: "/// Horizontal.", target: "x" },
      { kind: "doc", rawText: "//! Geometry helpers.", target: "geometry" },
      { kind: "block", rawText: "/* Plain block. */", target: "Point" },
    ]);
    // The grammar includes the newline in `///` comments; the range ends before it.
    expect(comments[1]?.range).toEqual({
      start: { row: 2, column: 0 },
      end: { row: 3, column: 20 },
    });
  });

  it("Java: Javadoc, annotations, license header and directives", async () => {
    const comments = await extract(
      [
        "/*",
        " * Copyright 2026 Someone.",
        " */",
        "package demo;",
        "",
        "/** A greeter. */",
        "@Deprecated",
        "public class Greeter {",
        "    // The greeting prefix.",
        '    private final String prefix = "Hi"; // NOSONAR',
        "",
        "    /** Greets someone. */",
        "    @Override",
        "    public String greet(String name) {",
        "        // String s = name.trim();",
        "        //noinspection ConstantConditions",
        "        return prefix + name;",
        "    }",
        "",
        "    /* Default constructor. */",
        "    Greeter() {}",
        "}",
      ],
      "java",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/** A greeter. */", target: "Greeter" },
      { kind: "line", rawText: "// The greeting prefix.", target: "prefix" },
      { kind: "doc", rawText: "/** Greets someone. */", target: "greet" },
      { kind: "block", rawText: "/* Default constructor. */", target: "Greeter" },
    ]);
  });
});
