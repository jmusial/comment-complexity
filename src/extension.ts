import * as path from "node:path";
import * as vscode from "vscode";
import { FALLBACK_SYNTAXES } from "./extract/fallback";
import { LANGUAGES } from "./extract/languages";
import { DocumentTrees, GrammarLoader } from "./extract/treeSitter";
import { loadZipf } from "./metrics/zipf";
import { CommentAnalyzer } from "./score/analyzer";
import { ComplexityHoverProvider, ComplexityLensProvider } from "./ui/providers";
import { WorkspaceVocabulary } from "./vocab/workspace";

/** Returned from `activate` so integration tests can inspect extension state. */
export interface ExtensionApi {
  readonly trees: DocumentTrees;
  readonly vocabulary: WorkspaceVocabulary<vscode.Uri>;
  readonly analyzer: CommentAnalyzer;
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
  const vocabulary = new WorkspaceVocabulary(
    {
      findFiles: (include, exclude, maxResults) =>
        vscode.workspace.findFiles(include, exclude, maxResults),
      readFile: (uri) => vscode.workspace.fs.readFile(uri),
      relativePath: (uri) =>
        vscode.workspace.getWorkspaceFolder(uri) === undefined
          ? undefined
          : vscode.workspace.asRelativePath(uri, false),
      onDidSaveTextDocument: (listener) => vscode.workspace.onDidSaveTextDocument(listener),
      onDidDeleteFiles: (listener) => vscode.workspace.onDidDeleteFiles(listener),
      onDidRenameFiles: (listener) => vscode.workspace.onDidRenameFiles(listener),
    },
    loader,
    (uri, error) => log.error(`Failed to read identifiers from ${uri}`, error),
  );

  const analyzer = new CommentAnalyzer({
    tree: (documentKey) => trees.get(documentKey),
    hasGrammar: (languageId) => loader.supports(languageId),
    vocabulary: () => vocabulary.words(),
    zipf: () => loadZipf(vscode.Uri.joinPath(context.extensionUri, "data", "zipf-en.json").fsPath),
  });
  const lenses = new ComplexityLensProvider(analyzer);
  const selector = [...LANGUAGES.keys(), ...FALLBACK_SYNTAXES.keys()].map((language) => ({
    language,
  }));

  const open = (document: vscode.TextDocument) => {
    // Lenses asked for before the tree was ready came back empty.
    void trees.open(key(document), document).then(() => lenses.refresh());
  };

  // A language mode switch arrives as close + open, so the grammar is swapped too.
  context.subscriptions.push(
    { dispose: () => trees.dispose() },
    vocabulary,
    lenses,
    vscode.languages.registerCodeLensProvider(selector, lenses),
    vscode.languages.registerHoverProvider(selector, new ComplexityHoverProvider(analyzer)),
    vscode.workspace.onDidOpenTextDocument(open),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        trees.update(key(event.document), event.document, event.contentChanges);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      trees.close(key(document));
      analyzer.forget(key(document));
    }),
  );
  vscode.workspace.textDocuments.forEach(open);

  log.info("Comment Complexity activated");
  return { trees, vocabulary, analyzer };
}

export function deactivate(): void {}
