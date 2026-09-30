import type { Parser } from "@vscode/tree-sitter-wasm";
import * as vscode from "vscode";
import type { GrammarLoader } from "../extract/treeSitter";
import { LANGUAGE_BY_EXTENSION, Vocabulary, identifierWords, languageForPath } from "./vocabulary";

/** Most files read for the vocabulary. */
export const MAX_FILES = 5_000;

/** Larger files are skipped: usually generated or minified, and slow to parse. */
export const MAX_FILE_BYTES = 1_000_000;

const INCLUDE = `**/*.{${[...LANGUAGE_BY_EXTENSION.keys()].join(",")}}`;

/** Dependencies and build output are not the project's own words. */
const EXCLUDE =
  "**/{node_modules,bower_components,vendor,dist,out,build,target,coverage,.git,.venv,venv,__pycache__}/**";

/**
 * The workspace's identifier vocabulary. Built on first use from the workspace's source files,
 * then kept in memory and updated as files are saved or deleted.
 */
export class WorkspaceVocabulary implements vscode.Disposable {
  private readonly vocabulary = new Vocabulary();
  private readonly parsers = new Map<string, Promise<Parser | undefined>>();
  private readonly listeners: vscode.Disposable[];
  private building: Promise<void> | undefined;

  constructor(
    private readonly loader: GrammarLoader,
    private readonly onError?: (uri: string, error: unknown) => void,
  ) {
    this.listeners = [
      vscode.workspace.onDidSaveTextDocument((document) => {
        // Before the first build there is nothing to update; the build reads the saved file.
        if (this.building !== undefined) {
          this.read(document.uri, document.languageId, document.getText()).catch((error: unknown) =>
            this.onError?.(document.uri.toString(), error),
          );
        }
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        for (const uri of event.files) {
          this.vocabulary.remove(uri.toString());
        }
      }),
    ];
  }

  /** Lower-cased identifier words. The first call builds the vocabulary; later ones share it. */
  async words(): Promise<ReadonlySet<string>> {
    this.building ??= this.build();
    await this.building;
    return this.vocabulary.words();
  }

  dispose(): void {
    for (const listener of this.listeners) {
      listener.dispose();
    }
    for (const parser of this.parsers.values()) {
      void parser.then((p) => p?.delete());
    }
    this.parsers.clear();
  }

  private async build(): Promise<void> {
    for (const uri of await vscode.workspace.findFiles(INCLUDE, EXCLUDE, MAX_FILES)) {
      const languageId = languageForPath(uri.path);
      if (languageId === undefined) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength <= MAX_FILE_BYTES) {
          await this.read(uri, languageId, new TextDecoder().decode(bytes));
        }
      } catch (error) {
        this.onError?.(uri.toString(), error);
      }
    }
  }

  private async read(uri: vscode.Uri, languageId: string, text: string): Promise<void> {
    const parser = await this.parserFor(languageId);
    const tree = parser?.parse(text);
    if (!tree) {
      return;
    }
    try {
      this.vocabulary.set(uri.toString(), identifierWords(tree));
    } finally {
      tree.delete();
    }
  }

  /** One parser per language, reused across files. */
  private parserFor(languageId: string): Promise<Parser | undefined> {
    let parser = this.parsers.get(languageId);
    if (parser === undefined) {
      parser = this.loader.createParser(languageId).catch((error: unknown) => {
        this.parsers.delete(languageId);
        throw error;
      });
      this.parsers.set(languageId, parser);
    }
    return parser;
  }
}
