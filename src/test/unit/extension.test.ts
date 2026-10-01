import { afterEach, describe, expect, it, vi } from "vitest";
import { activate, deactivate } from "../../extension";
import { EXCLUDE, INCLUDE } from "../../vocab/workspace";
// The same module `extension.ts` gets as `vscode` (see vitest.config.mts).
import * as vscode from "./vscode.stub";

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
});

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
