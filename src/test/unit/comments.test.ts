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
