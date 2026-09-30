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

  it("C: Doxygen comments, declarators and preprocessor-heavy files", async () => {
    const comments = await extract(
      [
        "/* SPDX-License-Identifier: MIT */",
        "#pragma once",
        "#include <stdio.h>",
        "",
        "/** Adds two numbers. */",
        "static int add(int a, int b) {",
        "    // x = a * b;",
        "    return a + b; /* sum */",
        "}",
        "",
        "// NOLINTNEXTLINE(readability-magic-numbers)",
        "int limit = 10;",
        "",
        "/// A point in 2D.",
        "typedef struct {",
        "    int x; ///< Horizontal.",
        "} point_t;",
      ],
      "c",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/** Adds two numbers. */", target: "add" },
      { kind: "block", rawText: "/* sum */", target: undefined },
      { kind: "doc", rawText: "/// A point in 2D.", target: "point_t" },
      { kind: "doc", rawText: "///< Horizontal.", target: undefined },
    ]);
  });

  it("C++: templates, class members and directives", async () => {
    const comments = await extract(
      [
        "namespace geo {",
        "",
        "/// Distance between points.",
        "template <typename T>",
        "T distance(T a, T b);",
        "",
        "class Shape {",
        "public:",
        "    /** Area in square units. */",
        "    virtual double area() const = 0;",
        "",
        "    // clang-format off",
        "    int  sides;",
        "    // clang-format on",
        "};",
        "",
        "}  // namespace geo",
      ],
      "cpp",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/// Distance between points.", target: "distance" },
      { kind: "doc", rawText: "/** Area in square units. */", target: "area" },
      { kind: "line", rawText: "// namespace geo", target: undefined },
    ]);
  });

  it("C#: XML doc runs, attributes, fields and directives", async () => {
    const comments = await extract(
      [
        "// <auto-generated/>",
        "using System;",
        "",
        "namespace Shop;",
        "",
        "/// <summary>",
        "/// An order line.",
        "/// </summary>",
        "[Serializable]",
        "public class Line",
        "{",
        "    // Unit price.",
        "    // ReSharper disable once InconsistentNaming",
        "    private Money _price;",
        "",
        "    /// <summary>Quantity ordered.</summary>",
        "    public int Quantity { get; set; }",
        "",
        "    // var total = _price * Quantity;",
        "    /* Recomputes the total. */",
        "    public void Recompute() { }",
        "}",
      ],
      "csharp",
    );

    expect(comments.map(summary)).toEqual([
      {
        kind: "doc",
        rawText: "/// <summary>\n/// An order line.\n/// </summary>",
        target: "Line",
      },
      { kind: "line", rawText: "// Unit price.", target: "_price" },
      { kind: "doc", rawText: "/// <summary>Quantity ordered.</summary>", target: "Quantity" },
      { kind: "block", rawText: "/* Recomputes the total. */", target: "Recompute" },
    ]);
  });

  it("Ruby: magic comments, =begin blocks and class bodies", async () => {
    const comments = await extract(
      [
        "#!/usr/bin/env ruby",
        "# frozen_string_literal: true",
        "# Copyright 2026 Someone.",
        "",
        "# Stores records in memory.",
        "class Store",
        "  # Default capacity (per shard)",
        "  CAPACITY = 10",
        "",
        "  # rubocop:disable Metrics/AbcSize",
        "  # Saves a record.",
        "  def save(record); end",
        "",
        "  # Builds a store (lazily)",
        "  def self.build; end",
        "end",
        "",
        "=begin",
        "Legacy notes",
        "about the store.",
        "=end",
        "module Legacy; end",
      ],
      "ruby",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "# Stores records in memory.", target: "Store" },
      // Kept although it parses as Ruby: the commented-out code check is off.
      { kind: "line", rawText: "# Default capacity (per shard)", target: "CAPACITY" },
      { kind: "line", rawText: "# Saves a record.", target: "save" },
      { kind: "line", rawText: "# Builds a store (lazily)", target: "build" },
      {
        kind: "block",
        rawText: "=begin\nLegacy notes\nabout the store.\n=end",
        target: "Legacy",
      },
    ]);
  });

  it("PHP: both line prefixes, a header after <?php and $variables", async () => {
    const comments = await extract(
      [
        "<?php",
        "/*",
        " * Copyright 2026 Someone.",
        " */",
        "",
        "/** Formats a price. */",
        "#[Pure]",
        "function format_price(int $cents): string { return ''; }",
        "",
        "# Holds cart state.",
        "class Cart",
        "{",
        "    /** Line items. */",
        "    private array $items = [];",
        "",
        "    // $this->items = [];",
        "    // phpcs:ignore Generic.Files.LineLength",
        "    public const LIMIT = 10;",
        "",
        "    /* Empties the cart. */",
        "    public function clear(): void {}",
        "}",
        "",
        "// Shared instance.",
        "$cart = new Cart();",
      ],
      "php",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/** Formats a price. */", target: "format_price" },
      { kind: "line", rawText: "# Holds cart state.", target: "Cart" },
      { kind: "doc", rawText: "/** Line items. */", target: "$items" },
      { kind: "block", rawText: "/* Empties the cart. */", target: "clear" },
      { kind: "line", rawText: "// Shared instance.", target: "$cart" },
    ]);
  });

  it("Bash: shellcheck directives, functions and variables", async () => {
    const comments = await extract(
      [
        "#!/usr/bin/env bash",
        "# shellcheck disable=SC2034",
        "set -euo pipefail",
        "",
        "# Where builds go (created on demand).",
        "OUT_DIR=dist",
        "",
        "# Builds the project.",
        "# Usage: build [target]",
        "build() {",
        '  make "$1" # run make',
        "}",
        "",
        "# Exported for child scripts.",
        "export VERSION=1",
      ],
      "shellscript",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "# Where builds go (created on demand).", target: "OUT_DIR" },
      {
        kind: "line",
        rawText: "# Builds the project.\n# Usage: build [target]",
        target: "build",
      },
      { kind: "line", rawText: "# run make", target: undefined },
      { kind: "line", rawText: "# Exported for child scripts.", target: "VERSION" },
    ]);
  });

  it("CSS: block comments only, commented-out rules and stylelint", async () => {
    const comments = await extract(
      [
        "/*! Copyright 2026 Someone. MIT License */",
        "",
        "/* Primary button (hover state). */",
        ".button:hover {",
        "  color: red; /* brand red */",
        "  /* stylelint-disable-next-line declaration-no-important */",
        "  margin: 0 !important;",
        "}",
        "",
        "/* .old { display: none; } */",
      ],
      "css",
    );

    expect(comments.map(summary)).toEqual([
      { kind: "block", rawText: "/* Primary button (hover state). */", target: undefined },
      { kind: "block", rawText: "/* brand red */", target: undefined },
    ]);
  });
});
