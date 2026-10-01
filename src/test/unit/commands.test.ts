import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentAnalyzer, ScoredComment } from "../../score/analyzer";
import { DEFAULT_SETTINGS } from "../../settings";
import { fileReport } from "../../ui/commands";
import * as vscode from "./vscode.stub";

afterEach(() => {
  vi.resetAllMocks();
  vscode.window.activeTextEditor = undefined;
});

describe("fileReport", () => {
  it("waits for the document to be parsed before reporting", async () => {
    let parsed = false;
    let finishParsing: (() => void) | undefined;
    const scored = {
      comment: { range: { start: { row: 3, column: 0 } }, approx: false },
      text: "Retries the upload.",
      score: { score: 1, label: "easy", reasons: [] },
    } as unknown as ScoredComment;
    const analyzer = {
      // Before the tree is ready the analyzer has nothing, as with a real one.
      analyze: vi.fn<() => Promise<ScoredComment[]>>(async () => (parsed ? [scored] : [])),
    } as unknown as CommentAnalyzer;
    const uri = { path: "/ws/a.ts", toString: () => "file:///ws/a.ts" };
    const document = { uri, languageId: "typescript" };
    vscode.window.activeTextEditor = { document };

    const reporting = fileReport(
      {
        analyzer,
        parsed: () =>
          new Promise<void>((resolve) => {
            finishParsing = () => {
              parsed = true;
              resolve();
            };
          }),
      },
      DEFAULT_SETTINGS,
    );
    await Promise.resolve();
    expect(analyzer.analyze).not.toHaveBeenCalled();
    finishParsing!();
    await reporting;

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
  });
});
