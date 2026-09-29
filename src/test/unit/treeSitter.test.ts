import * as path from "node:path";
import { Language } from "@vscode/tree-sitter-wasm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrammarLoader } from "../../extract/treeSitter";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
const newLoader = () => new GrammarLoader(wasmDir, wasmDir);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GrammarLoader", () => {
  it("parses a TypeScript file", async () => {
    const parser = await newLoader().createParser("typescript");
    expect(parser).toBeDefined();

    const tree = parser!.parse(
      "/** Adds. */\nconst add = (a: number, b: number): number => a + b;\n",
    );
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe("program");
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.firstChild?.type).toBe("comment");

    tree!.delete();
    parser!.delete();
  });

  it("loads a grammar only on first use", async () => {
    const load = vi.spyOn(Language, "load");
    const loader = newLoader();
    expect(load).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([loader.load("typescript"), loader.load("typescript")]);
    await loader.load("typescript");
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);

    await loader.load("python");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("maps JSX variants and ignores unsupported languages", async () => {
    const load = vi.spyOn(Language, "load");
    const loader = newLoader();

    expect(loader.supports("typescriptreact")).toBe(true);
    expect(loader.supports("kotlin")).toBe(false);
    expect(loader.supports("toString")).toBe(false);
    expect(loader.load("kotlin")).toBeUndefined();

    await loader.load("javascript");
    await loader.load("javascriptreact");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a grammar after a failed load", async () => {
    const load = vi.spyOn(Language, "load").mockRejectedValueOnce(new Error("boom"));
    const loader = newLoader();

    await expect(loader.load("go")).rejects.toThrow("boom");
    await expect(loader.load("go")).resolves.toBeInstanceOf(Language);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
