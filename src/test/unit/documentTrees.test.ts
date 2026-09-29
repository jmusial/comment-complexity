import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocumentTrees,
  GrammarLoader,
  type SourceDocument,
  type TextChange,
} from "../../extract/treeSitter";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
const loader = new GrammarLoader(wasmDir, wasmDir);

/** Minimal mutable stand-in for `vscode.TextDocument`. */
class FakeDocument implements SourceDocument {
  version = 1;
  constructor(
    public text: string,
    readonly languageId = "typescript",
  ) {}

  getText(): string {
    return this.text;
  }

  /** Replaces `length` code units at `offset`, bumps the version, returns the change VS Code would emit. */
  replace(offset: number, length: number, text: string): TextChange {
    const change = {
      range: {
        start: this.positionAt(offset),
        end: this.positionAt(offset + length),
      },
      rangeOffset: offset,
      rangeLength: length,
      text,
    };
    this.text = this.text.slice(0, offset) + text + this.text.slice(offset + length);
    this.version++;
    return change;
  }

  private positionAt(offset: number) {
    const before = this.text.slice(0, offset).split("\n");
    return {
      line: before.length - 1,
      character: before[before.length - 1]!.length,
    };
  }
}

async function fullParse(doc: FakeDocument): Promise<string> {
  const parser = (await loader.createParser(doc.languageId))!;
  const tree = parser.parse(doc.getText())!;
  const sexp = tree.rootNode.toString();
  tree.delete();
  parser.delete();
  return sexp;
}

const source = [
  "/** Adds two numbers. */",
  "export function add(a: number, b: number): number {",
  "  return a + b; // sum",
  "}",
  "",
].join("\n");

describe("DocumentTrees", () => {
  it("reparses incrementally to the same tree as a full parse", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument(source);
    await trees.open("a", doc);

    const edits: [(text: string) => number, number, string][] = [
      [() => 0, 0, "// header 😀\n"], // insert line with astral char at start
      [(t) => t.indexOf("return a + b;") + 13, 0, "\n  /* ąę\n     multi */"], // multi-line insert
      [() => 0, 3, ""], // deletion across the comment start
      [() => 5, 4, "é"], // replacement shorter than range
    ];
    for (const [offsetIn, length, text] of edits) {
      const change = doc.replace(offsetIn(doc.text), length, text);
      const tree = trees.update("a", doc, [change]);
      expect(tree?.rootNode.toString()).toBe(await fullParse(doc));
    }

    trees.dispose();
  });

  it("locates a comment inserted by an edit in UTF-16 coordinates", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument("const s = 'ą😀';\n");
    await trees.open("a", doc);

    // 'ą' is one UTF-16 unit, '😀' two, so ";" sits at 15 and the comment starts at 17.
    const tree = trees.update("a", doc, [doc.replace(16, 0, " // tail")]);
    const comment = tree?.rootNode.descendantsOfType("comment")[0];
    expect(comment?.text).toBe("// tail");
    expect(comment?.startIndex).toBe(17);
    expect(comment?.startPosition).toEqual({ row: 0, column: 17 });

    trees.dispose();
  });

  it("applies several changes from one event in order", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument("let a = 1;\nlet b = 2;\n");
    await trees.open("a", doc);

    // Multi-cursor edits arrive bottom-up, so each range is valid against the text before it.
    const changes = [doc.replace(11, 0, "// b\n"), doc.replace(0, 0, "// a\n")];
    const tree = trees.update("a", doc, changes);
    expect(tree?.rootNode.toString()).toBe(await fullParse(doc));
    expect(tree?.rootNode.descendantsOfType("comment").map((c) => c?.text)).toEqual([
      "// a",
      "// b",
    ]);

    trees.dispose();
  });

  it("returns the cached tree when the version did not change", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument(source);
    const opened = await trees.open("a", doc);

    expect(trees.update("a", doc, [])).toBe(opened);
    expect(trees.get("a")).toBe(opened);

    trees.dispose();
  });

  it("parses the latest text when edited while the grammar loads", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument("let x = 1;\n", "rust");
    const opening = trees.open("a", doc);

    const change = doc.replace(0, 0, "// late\n");
    expect(trees.update("a", doc, [change])).toBeUndefined();

    const tree = await opening;
    expect(tree?.rootNode.text).toBe(doc.text);
    expect(trees.update("a", doc, [])).toBe(tree);

    trees.dispose();
  });

  it("drops a document closed while its grammar loads", async () => {
    const trees = new DocumentTrees(loader);
    const opening = trees.open("a", new FakeDocument("fn main() {}\n", "rust"));
    trees.close("a");

    await expect(opening).resolves.toBeUndefined();
    expect(trees.get("a")).toBeUndefined();
  });

  it("ignores unsupported languages", async () => {
    const trees = new DocumentTrees(loader);
    const doc = new FakeDocument("# title\n", "markdown");

    await expect(trees.open("a", doc)).resolves.toBeUndefined();
    expect(trees.update("a", doc, [doc.replace(0, 0, "x")])).toBeUndefined();
  });
});
