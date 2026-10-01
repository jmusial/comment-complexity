import * as vscode from "vscode";
import type { CommentAnalyzer } from "../score/analyzer";
import { type Settings, scores } from "../settings";
import { reportItems } from "./present";
import type { ComplexityLensProvider } from "./providers";

export const TOGGLE_LENSES = "commentComplexity.toggleLenses";
export const FILE_REPORT = "commentComplexity.fileReport";

/** Lists the active file's comments by score; choosing one moves the cursor to it. */
export async function fileReport(analyzer: CommentAnalyzer, settings: Settings): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage("Open a file to see its comment complexity.");
    return;
  }
  const { document } = editor;
  if (!scores(settings, document.languageId)) {
    void vscode.window.showInformationMessage(
      `Comment complexity is off for ${document.languageId} (see the commentComplexity settings).`,
    );
    return;
  }
  const items = reportItems(await analyzer.analyze(document.uri.toString(), document));
  if (items.length === 0) {
    void vscode.window.showInformationMessage("No comments to score in this file.");
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Comment complexity: ${vscode.workspace.asRelativePath(document.uri)}`,
    placeHolder: "Most complex first; pick one to jump to it",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked !== undefined) {
    const { row, column } = picked.scored.comment.range.start;
    const start = new vscode.Position(row, column);
    const selection = new vscode.Range(start, start);
    // Back in the editor the report was opened from.
    const { viewColumn } = editor;
    await vscode.window.showTextDocument(
      document,
      viewColumn === undefined ? { selection } : { selection, viewColumn },
    );
  }
}

export function registerCommands(
  analyzer: CommentAnalyzer,
  lenses: ComplexityLensProvider,
  settings: () => Settings,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(TOGGLE_LENSES, () => lenses.toggle()),
    vscode.commands.registerCommand(FILE_REPORT, () => fileReport(analyzer, settings())),
  ];
}
