import * as path from "node:path";
import * as vscode from "vscode";
import { DocumentTrees, GrammarLoader } from "./extract/treeSitter";

/** Returned from `activate` so integration tests can inspect parser state. */
export interface ExtensionApi {
  readonly trees: DocumentTrees;
}

function key(document: vscode.TextDocument): string {
  return document.uri.toString();
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const log = vscode.window.createOutputChannel("Comment Complexity", {
    log: true,
  });
  context.subscriptions.push(log);

  // esbuild copies the runtime next to the bundle and grammars into dist/grammars.
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
  const trees = new DocumentTrees(new GrammarLoader(dist, path.join(dist, "grammars")));

  const open = (document: vscode.TextDocument) => {
    trees.open(key(document), document).catch((error: unknown) => {
      log.error(`Failed to parse ${document.uri.fsPath} (${document.languageId})`, error);
    });
  };

  // A language mode switch arrives as close + open, so the grammar is swapped too.
  context.subscriptions.push(
    { dispose: () => trees.dispose() },
    vscode.workspace.onDidOpenTextDocument(open),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        trees.update(key(event.document), event.document, event.contentChanges);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => trees.close(key(document))),
  );
  vscode.workspace.textDocuments.forEach(open);

  log.info("Comment Complexity activated");
  return { trees };
}

export function deactivate(): void {}
