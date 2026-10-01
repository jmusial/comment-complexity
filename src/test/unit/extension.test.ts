import { afterEach, describe, expect, it, vi } from "vitest";
import { activate, deactivate } from "../../extension";
import { EXCLUDE, INCLUDE } from "../../vocab/workspace";
// The same module `extension.ts` gets as `vscode` (see vitest.config.mts).
import * as vscode from "./vscode.stub";
import type { ComplexityHoverProvider, ComplexityLensProvider } from "../../ui/providers";

// The stub's extension has no data folder; every word is everyday.
vi.mock("../../metrics/zipf", () => ({ loadZipf: () => () => 5 }));

const uri = (filePath: string) => ({ path: filePath, toString: () => `file://${filePath}` });

const subscriptions: { dispose(): unknown }[] = [];

/** Activates against the stub. Its grammars are missing, so every parse fails and is logged. */
function start() {
  const context = { subscriptions, extensionUri: { fsPath: "/no/such/extension" } };
  return activate(context as never);
}

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) {
    subscription.dispose();
  }
  vi.resetAllMocks();
  for (const setting of Object.keys(vscode.configuration)) {
    delete vscode.configuration[setting];
  }
  vscode.workspace.textDocuments.length = 0;
  vscode.window.activeTextEditor = undefined;
});

/** A Kotlin document: scanned by the fallback, so it is scored without a grammar. */
const kotlin = (path = "/ws/a.kt") => ({
  uri: uri(path),
  languageId: "kotlin",
  version: 1,
  isClosed: false,
  getText: () => "// Retries the upload when the network drops.\nval x = 1",
});

/** Runs the file report command. */
const report = () => vscode.registeredCommands.get("commentComplexity.fileReport")!();

/** Changes settings the way the user would, then tells the extension. */
function configure(values: Record<string, unknown>, section = "commentComplexity") {
  Object.assign(vscode.configuration, values);
  vscode.events.configuration.fire({ affectsConfiguration: (name) => name === section });
}

describe("activate", () => {
  it("wires document events to the syntax trees and logs failed parses", async () => {
    const { trees } = start();
    expect(vscode.log.info).toHaveBeenCalledWith("Comment Complexity activated");

    const document = {
      uri: uri("/ws/a.ts"),
      languageId: "typescript",
      version: 1,
      getText: () => "const a = 1;",
    };
    vscode.events.open.fire(document);
    await vi.waitFor(() =>
      expect(vscode.log.error).toHaveBeenCalledWith(
        "Failed to parse file:///ws/a.ts",
        expect.anything(),
      ),
    );

    const update = vi.spyOn(trees, "update");
    vscode.events.change.fire({ document, contentChanges: [] });
    expect(update).not.toHaveBeenCalled();
    const change = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      rangeOffset: 0,
      rangeLength: 0,
      text: "x",
    };
    vscode.events.change.fire({ document, contentChanges: [change] });
    expect(update).toHaveBeenCalledWith("file:///ws/a.ts", document, [change]);

    const close = vi.spyOn(trees, "close");
    vscode.events.close.fire(document);
    expect(close).toHaveBeenCalledWith("file:///ws/a.ts");
  });

  it("reads the workspace vocabulary through vscode.workspace, skipping files outside it", async () => {
    const { vocabulary } = start();
    vscode.workspace.findFiles.mockResolvedValueOnce([uri("/ws/a.ts"), uri("/elsewhere/b.ts")]);
    vscode.workspace.getWorkspaceFolder.mockImplementation((file) =>
      file.path.startsWith("/ws/") ? {} : undefined,
    );
    vscode.workspace.fs.readFile.mockResolvedValue(new TextEncoder().encode("const a = 1;"));

    expect([...(await vocabulary.words())]).toEqual([]);
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(INCLUDE, EXCLUDE, 5_000);
    // Only the file inside the workspace is read; its grammar is missing, which is logged.
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1);
    expect(vscode.log.error).toHaveBeenCalledWith(
      "Failed to read identifiers from file:///ws/a.ts",
      expect.anything(),
    );
  });

  it("shows a lens and a hover over each comment, approximate without a grammar", async () => {
    start();
    const [selector, lensProvider] = vscode.languages.registerCodeLensProvider.mock.calls[0]!;
    const [, hoverProvider] = vscode.languages.registerHoverProvider.mock.calls[0]!;
    expect(selector).toContainEqual({ language: "typescript" });
    expect(selector).toContainEqual({ language: "kotlin" });

    const document = {
      uri: uri("/ws/a.kt"),
      languageId: "kotlin",
      version: 1,
      getText: () => "// Retries the upload when the network drops.\nval x = 1",
    };
    const lenses = await (lensProvider as ComplexityLensProvider).provideCodeLenses(
      document as never,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0]!.command!.title).toMatch(/^complexity \d+\.\d.* · approx$/);
    expect(lenses[0]!.range).toMatchObject({ start: { line: 0, character: 0 } });

    const hover = (hoverProvider as ComplexityHoverProvider).provideHover.bind(hoverProvider);
    const shown = await hover(document as never, new vscode.Position(0, 5) as never);
    expect((shown!.contents as unknown as vscode.MarkdownString).value).toContain(
      "**Comment complexity",
    );
    expect(await hover(document as never, new vscode.Position(1, 2) as never)).toBeUndefined();
  });

  it("asks for fresh lenses once a document is parsed, and forgets it on close", async () => {
    const { analyzer } = start();
    const lensProvider = vscode.languages.registerCodeLensProvider.mock
      .calls[0]![1] as ComplexityLensProvider;
    const refreshed = vi.fn<() => void>();
    lensProvider.onDidChangeCodeLenses(refreshed);
    const forget = vi.spyOn(analyzer, "forget");

    const document = {
      uri: uri("/ws/b.ts"),
      languageId: "typescript",
      version: 1,
      getText: () => "",
    };
    vscode.events.open.fire(document);
    await vi.waitFor(() => expect(refreshed).toHaveBeenCalled());
    // Its grammar is missing, so there is no tree and nothing to show.
    expect(await lensProvider.provideCodeLenses(document as never)).toEqual([]);
    vscode.events.close.fire(document);
    expect(forget).toHaveBeenCalledWith("file:///ws/b.ts");
  });

  it("applies settings live", async () => {
    const { settings } = start();
    const lensProvider = vscode.languages.registerCodeLensProvider.mock
      .calls[0]![1] as ComplexityLensProvider;
    const hoverProvider = vscode.languages.registerHoverProvider.mock
      .calls[0]![1] as ComplexityHoverProvider;
    const refreshed = vi.fn<() => void>();
    lensProvider.onDidChangeCodeLenses(refreshed);
    const document = kotlin() as never;
    expect(await lensProvider.provideCodeLenses(document)).toHaveLength(1);

    // Other extensions' settings change nothing.
    configure({ "commentComplexity.threshold": 10 }, "editor");
    expect(refreshed).not.toHaveBeenCalled();
    expect(settings().threshold).toBe(5);

    configure({ "commentComplexity.showOnlyAbove": true });
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(settings()).toMatchObject({ threshold: 10, showOnlyAbove: true });
    expect(await lensProvider.provideCodeLenses(document)).toEqual([]);

    configure({ "commentComplexity.threshold": 0 });
    expect(await lensProvider.provideCodeLenses(document)).toHaveLength(1);

    configure({ "commentComplexity.languages": ["typescript"] });
    expect(await lensProvider.provideCodeLenses(document)).toEqual([]);
    configure({ "commentComplexity.languages": [], "commentComplexity.enabled": false });
    expect(await lensProvider.provideCodeLenses(document)).toEqual([]);
    expect(await hoverProvider.provideHover(document, new vscode.Position(0, 5) as never)).toBe(
      undefined,
    );
  });

  it("reports complex comments as Information diagnostics once turned on", async () => {
    const { analyzer } = start();
    const document = kotlin();
    const key = "file:///ws/a.kt";
    vscode.workspace.textDocuments.push(document);

    // Off by default: changes clear rather than report.
    vscode.events.change.fire({ document, contentChanges: [{}] });
    await vi.waitFor(() => expect(vscode.diagnostics.has(key)).toBe(false));

    configure({ "commentComplexity.diagnostics": true, "commentComplexity.threshold": 0 });
    await vi.waitFor(() => expect(vscode.diagnostics.get(key)).toHaveLength(1));
    const [diagnostic] = vscode.diagnostics.get(key)!;
    expect(diagnostic).toMatchObject({
      severity: vscode.DiagnosticSeverity.Information,
      source: "Comment Complexity",
    });
    expect(diagnostic!.message).toMatch(/^Comment complexity \d+\.\d \(\w+\)/);

    // Above the threshold only.
    configure({ "commentComplexity.threshold": 10 });
    await vi.waitFor(() => expect(vscode.diagnostics.get(key)).toEqual([]));

    // A document closed while it was being scored keeps nothing.
    configure({ "commentComplexity.threshold": 0 });
    document.isClosed = true;
    vscode.events.close.fire(document);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vscode.diagnostics.has(key)).toBe(false);

    // Failures are logged.
    vi.spyOn(analyzer, "analyze").mockRejectedValue(new Error("no vocabulary"));
    vscode.events.change.fire({ document: kotlin("/ws/b.kt"), contentChanges: [{}] });
    await vi.waitFor(() =>
      expect(vscode.log.error).toHaveBeenCalledWith(
        "Failed to score file:///ws/b.kt",
        expect.anything(),
      ),
    );
  });

  it("toggles the lenses, leaving hovers", async () => {
    start();
    const lensProvider = vscode.languages.registerCodeLensProvider.mock
      .calls[0]![1] as ComplexityLensProvider;
    const hoverProvider = vscode.languages.registerHoverProvider.mock
      .calls[0]![1] as ComplexityHoverProvider;
    const refreshed = vi.fn<() => void>();
    lensProvider.onDidChangeCodeLenses(refreshed);
    const toggle = vscode.registeredCommands.get("commentComplexity.toggleLenses")!;

    toggle();
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(await lensProvider.provideCodeLenses(kotlin() as never)).toEqual([]);
    expect(
      await hoverProvider.provideHover(kotlin() as never, new vscode.Position(0, 5) as never),
    ).toBeDefined();
    toggle();
    expect(await lensProvider.provideCodeLenses(kotlin() as never)).toHaveLength(1);
  });

  describe("file report", () => {
    const twoComments = {
      ...kotlin(),
      getText: () =>
        [
          "// Plain words here.",
          "val x = 1",
          "// Idempotent SQS reconciliation never retries unless the lease wasn't renewed.",
          "val y = 2",
        ].join("\n"),
    };

    it("lists the file's comments by score and jumps to the picked one", async () => {
      start();
      vscode.window.activeTextEditor = { document: twoComments, viewColumn: 2 };
      vscode.window.showQuickPick.mockImplementationOnce(async (items) => items[0]);
      await report();

      const [items, options] = vscode.window.showQuickPick.mock.calls[0]!;
      const labels = (items as { label: string }[]).map(({ label }) => label.replace(/^\S+ +/, ""));
      expect(labels).toEqual([
        "Idempotent SQS reconciliation never retries unless the lease wasn't renewed.",
        "Plain words here.",
      ]);
      expect(options).toMatchObject({ title: "Comment complexity: a.kt" });
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(twoComments, {
        selection: new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 0)),
        viewColumn: 2,
      });
    });

    it("does nothing when the pick is dismissed", async () => {
      start();
      vscode.window.activeTextEditor = { document: twoComments };
      await report();
      expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it("jumps without a view column too", async () => {
      start();
      vscode.window.activeTextEditor = { document: twoComments };
      vscode.window.showQuickPick.mockImplementationOnce(async (items) => items[1]);
      await report();
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(twoComments, {
        selection: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      });
    });

    it.each([
      ["no editor is open", undefined, "Open a file to see its comment complexity."],
      [
        "the language is off",
        { document: { ...kotlin(), languageId: "plaintext" } },
        "Comment complexity is off for plaintext (see the commentComplexity settings).",
      ],
      [
        "there is nothing to score",
        { document: { ...kotlin(), getText: () => "val x = 1" } },
        "No comments to score in this file.",
      ],
    ])("says so when %s", async (_, editor, message) => {
      start();
      if (editor?.document.languageId === "plaintext") {
        configure({ "commentComplexity.languages": ["kotlin"] });
      }
      vscode.window.activeTextEditor = editor;
      await report();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(message);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });
  });

  it("stops listening when its subscriptions are disposed", () => {
    start();
    expect(vscode.events.open.listeners).toBe(1);
    expect(vscode.events.rename.listeners).toBe(1);

    for (const subscription of subscriptions.splice(0)) {
      subscription.dispose();
    }
    expect(vscode.events.open.listeners).toBe(0);
    expect(vscode.events.save.listeners).toBe(0);
    expect(vscode.events.rename.listeners).toBe(0);
    deactivate();
  });
});
