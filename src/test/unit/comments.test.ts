import { describe, expect, it } from "vitest";
import { extract, summary } from "./extract";

describe("extractComments", () => {
  it("extracts doc, block and line comments", async () => {
    const comments = await extract([
      "/** Adds two numbers. */",
      "export function add(a: number, b: number): number {",
      "  return a + b; // plain sum",
      "}",
      "",
      "/* Block comment about the constant. */",
      "const limit = 10;",
    ]);

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/** Adds two numbers. */", target: "add" },
      { kind: "line", rawText: "// plain sum", target: undefined },
      { kind: "block", rawText: "/* Block comment about the constant. */", target: "limit" },
    ]);
    expect(comments[0]?.range).toEqual({
      start: { row: 0, column: 0 },
      end: { row: 0, column: 24 },
    });
  });

  it("groups runs of line comments", async () => {
    const comments = await extract([
      "// First line of a run",
      "// second line of the run.",
      "function run() {}",
      "",
      "// Detached by the blank line below.",
      "",
      "// New run",
      "// continues.",
      "let x = 1; // trailing one",
      "// after trailing",
    ]);

    expect(comments.map(summary)).toEqual([
      {
        kind: "line",
        rawText: "// First line of a run\n// second line of the run.",
        target: "run",
      },
      { kind: "line", rawText: "// Detached by the blank line below.", target: undefined },
      { kind: "line", rawText: "// New run\n// continues.", target: "x" },
      { kind: "line", rawText: "// trailing one", target: undefined },
      { kind: "line", rawText: "// after trailing", target: undefined },
    ]);
    expect(comments[0]?.range).toEqual({
      start: { row: 0, column: 0 },
      end: { row: 1, column: 26 },
    });
  });

  it("skips directives, which also split runs", async () => {
    const comments = await extract([
      '/// <reference types="node" />',
      "// eslint-disable-next-line no-console",
      'console.log("x");',
      "// Explains the cast.",
      "// @ts-expect-error legacy",
      "// Second part.",
      'const y: number = "s";',
      'const lazy = import(/* webpackChunkName: "lazy" */ "./lazy");',
      "const pure = /*#__PURE__*/ make();",
      "/* eslint-disable */",
    ]);

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "// Explains the cast.", target: "y" },
      { kind: "line", rawText: "// Second part.", target: "y" },
    ]);
  });

  it("skips a license header after a shebang, but not license talk later on", async () => {
    const comments = await extract(
      [
        "#!/usr/bin/env node",
        "/*!",
        " * Copyright (c) 2026 Someone. MIT License.",
        " */",
        "// Entry point.",
        "main();",
        "// This file is licensed oddly, but this comment is not a header.",
      ],
      "javascript",
    );

    expect(comments.map((c) => c.rawText)).toEqual([
      "// Entry point.",
      "// This file is licensed oddly, but this comment is not a header.",
    ]);
  });

  it("skips license headers after an include guard or imports", async () => {
    const cpp = await extract(
      [
        "#ifndef ARROW_VENDORED_DATE_H",
        "#define ARROW_VENDORED_DATE_H",
        "",
        "// The MIT License (MIT)",
        "//",
        "// Copyright (c) 2015, 2016, 2017 Howard Hinnant",
        "",
        "// Converts between calendar dates and day counts.",
        "int days(int year);",
        "",
        "#endif",
      ],
      "cpp",
    );
    expect(cpp.map((c) => c.rawText)).toEqual([
      "// Converts between calendar dates and day counts.",
    ]);

    const ts = await extract([
      '"use strict";',
      'import { add } from "./add";',
      "/*",
      ' * Licensed under the Apache License, Version 2.0 (the "License");',
      " * you may not use this file except in compliance with the License.",
      " */",
      "// Copyright notices are added by the release script.",
      "export const sum = add;",
    ]);
    expect(ts.map((c) => c.rawText)).toEqual([
      "// Copyright notices are added by the release script.",
    ]);
  });

  it("keeps prose in the same run of line comments as a license notice", async () => {
    const comments = await extract([
      "export const rate = 0.2;",
      "// SPDX-License-Identifier: MIT",
      "// Explains the calculation: the rate is applied after discounts.",
      "export const total = 1;",
    ]);
    expect(comments.map(({ rawText, range }) => [rawText, range.start.row])).toEqual([
      ["// Explains the calculation: the rate is applied after discounts.", 2],
    ]);
  });

  it("cuts a whole MIT header after an include guard, keeping the prose after it", async () => {
    // The start of arrow's cpp/src/arrow/vendored/datetime/date.h (apache-arrow-25.0.1).
    const comments = await extract(
      [
        "#ifndef ARROW_VENDORED_DATE_H",
        "#define ARROW_VENDORED_DATE_H",
        "",
        "// The MIT License (MIT)",
        "//",
        "// Copyright (c) 2015, 2016, 2017 Howard Hinnant",
        "// Copyright (c) 2016 Adrian Colomitchi",
        "// Copyright (c) 2017 Florian Dang",
        "// Copyright (c) 2017 Paul Thompson",
        "// Copyright (c) 2018, 2019 Tomasz Kamiński",
        "// Copyright (c) 2019 Jiangang Zhuang",
        "//",
        "// Permission is hereby granted, free of charge, to any person obtaining a copy",
        '// of this software and associated documentation files (the "Software"), to deal',
        "// in the Software without restriction, including without limitation the rights",
        "// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
        "// copies of the Software, and to permit persons to whom the Software is",
        "// furnished to do so, subject to the following conditions:",
        "//",
        "// The above copyright notice and this permission notice shall be included in all",
        "// copies or substantial portions of the Software.",
        "//",
        '// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
        "// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
        "// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
        "// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
        "// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
        "// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
        "// SOFTWARE.",
        "//",
        "// Our apologies.  When the previous paragraph was written, lowercase had not yet",
        "// been invented (that would involve another several millennia of evolution).",
        "// We did not mean to shout.",
        "",
        "int days(int year);",
        "",
        "#endif",
      ],
      "cpp",
    );
    expect(comments.map(({ rawText, range }) => [rawText, range.start.row])).toEqual([
      [
        [
          "// Our apologies.  When the previous paragraph was written, lowercase had not yet",
          "// been invented (that would involve another several millennia of evolution).",
          "// We did not mean to shout.",
        ].join("\n"),
        30,
      ],
    ]);
  });

  it("keeps prose that shares words with a license next to a notice", async () => {
    const comments = await extract([
      "export const rate = 0.2;",
      "// SPDX-License-Identifier: MIT",
      "// This software parses dates.",
      "export const total = 1;",
    ]);
    expect(comments.map(({ rawText }) => rawText)).toEqual(["// This software parses dates."]);
  });

  it("skips commented-out code but keeps prose and doc examples", async () => {
    const comments = await extract([
      "// const old = compute();",
      "// render(old);",
      "",
      "/* if (ready) { start(); } */",
      "",
      "// Returns the sum (never negative).",
      "",
      "// TODO: tidy up",
      "",
      "/**",
      " * Example:",
      " * add(1, 2);",
      " */",
      "function add() {}",
    ]);

    expect(comments.map(summary)).toEqual([
      { kind: "line", rawText: "// Returns the sum (never negative).", target: undefined },
      { kind: "line", rawText: "// TODO: tidy up", target: undefined },
      { kind: "doc", rawText: "/**\n * Example:\n * add(1, 2);\n */", target: "add" },
    ]);
  });

  it("skips structured data for tools, like __GDPR__ annotations", async () => {
    const comments = await extract([
      "function send(): void {",
      "  /* __GDPR__",
      '    "fetcherTelemetry" : {',
      '      "owner": "chrmarti",',
      '      "comment": "Telemetry event to test connectivity."',
      "    }",
      "  */",
      "  // Sends the event once the network is back.",
      "  report();",
      "}",
    ]);
    expect(comments.map(({ rawText }) => rawText)).toEqual([
      "// Sends the event once the network is back.",
    ]);
  });

  it("keeps prose in the same run of line comments as an annotation", async () => {
    const comments = await extract([
      '// __GDPR__COMMON__ "common.tid" : { "purpose": "BusinessInsight" }',
      "// Sends the event once the network is back.",
      "report();",
    ]);
    expect(comments.map(({ rawText, range }) => [rawText, range.start.row])).toEqual([
      ["// Sends the event once the network is back.", 1],
    ]);
  });

  it("finds the target symbol of each declaration kind", async () => {
    const comments = await extract([
      "/** A. */",
      "export const arrow = () => 1;",
      "/** B. */",
      "export default class Widget {",
      "  /** C. */",
      "  @track",
      "  count = 0;",
      "  /** D. */",
      "  @bound",
      "  render(): void {}",
      "}",
      "/** E. */",
      "interface Shape {",
      "  /** F. */",
      "  sides: number;",
      "}",
      "/** G. */",
      "type Id = string;",
      "/** H. */",
      "export declare function external(): void;",
      "/** I. */",
      "const { a, b } = pair;",
      "/** J. */",
      "enum Color { Red }",
    ]);

    expect(comments.map((c) => c.targetSymbolName)).toEqual([
      "arrow",
      "Widget",
      "count",
      "render",
      "Shape",
      "sides",
      "Id",
      "external",
      undefined,
      "Color",
    ]);
  });

  it("finds a JavaScript class field", async () => {
    const comments = await extract(
      ["class Counter {", "  /** Current value. */", "  count = 0;", "}"],
      "javascript",
    );

    expect(comments.map((c) => c.targetSymbolName)).toEqual(["count"]);
  });

  it.each(["javascriptreact", "typescriptreact"])("extracts JSX comments in %s", async (id) => {
    const comments = await extract(
      [
        "/** Renders the greeting. */",
        "const Hello = () => (",
        "  <div>",
        "    {/* Plain JSX note. */}",
        "    Hi",
        "  </div>",
        ");",
      ],
      id,
    );

    expect(comments.map(summary)).toEqual([
      { kind: "doc", rawText: "/** Renders the greeting. */", target: "Hello" },
      { kind: "block", rawText: "/* Plain JSX note. */", target: undefined },
    ]);
  });
});
