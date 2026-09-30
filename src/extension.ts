import * as path from "node:path";
import * as vscode from "vscode";
import { DocumentTrees, GrammarLoader } from "./extract/treeSitter";
import { WorkspaceVocabulary } from "./vocab/workspace";

/** Returned from `activate` so integration tests can inspect extension state. */
export interface ExtensionApi {
  readonly trees: DocumentTrees;
  readonly vocabulary: WorkspaceVocabulary;
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
  const loader = new GrammarLoader(dist, path.join(dist, "grammars"));
  const trees = new DocumentTrees(loader, (uri, error) =>
    log.error(`Failed to parse ${uri}`, error),
  );
  // Built lazily, on the first comment that needs it.
  const vocabulary = new WorkspaceVocabulary(loader, (uri, error) =>
    log.error(`Failed to read identifiers from ${uri}`, error),
  );

  const open = (document: vscode.TextDocument) => {
    void trees.open(key(document), document);
  };

  // A language mode switch arrives as close + open, so the grammar is swapped too.
  context.subscriptions.push(
    { dispose: () => trees.dispose() },
    vocabulary,
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
  return { trees, vocabulary };
}

export function deactivate(): void {}
