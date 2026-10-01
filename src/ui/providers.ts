import * as vscode from "vscode";
import type { CommentAnalyzer, ScoredComment } from "../score/analyzer";
import { type Settings, scores } from "../settings";
import { diagnosticMessage, hoverMarkdown, lensTitle } from "./present";

const key = (document: vscode.TextDocument): string => document.uri.toString();

const rangeOf = ({ comment }: ScoredComment): vscode.Range => {
  const { start, end } = comment.range;
  return new vscode.Range(start.row, start.column, end.row, end.column);
};

/** The document's scored comments, or none if the settings leave its language out. */
async function analyze(
  analyzer: CommentAnalyzer,
  settings: Settings,
  document: vscode.TextDocument,
): Promise<ScoredComment[]> {
  return scores(settings, document.languageId) ? analyzer.analyze(key(document), document) : [];
}

const complex = (settings: Settings) => (scored: ScoredComment) =>
  scored.score.score >= settings.threshold;

/** A lens above each scored comment, or only above complex ones with `showOnlyAbove`. */
export class ComplexityLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(
    private readonly analyzer: CommentAnalyzer,
    private readonly settings: () => Settings,
  ) {}

  /** Hidden by the toggle command, for this session; hovers and diagnostics stay. */
  private visible = true;

  /** Asks VS Code for fresh lenses, as when a document's tree has been parsed. */
  refresh(): void {
    this.changed.fire();
  }

  /** Hides the lenses if shown, shows them if hidden. */
  toggle(): void {
    this.visible = !this.visible;
    this.refresh();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.visible) {
      return [];
    }
    const settings = this.settings();
    const comments = await analyze(this.analyzer, settings, document);
    return comments.filter(settings.showOnlyAbove ? complex(settings) : () => true).map(
      (scored) =>
        new vscode.CodeLens(rangeOf(scored), {
          title: lensTitle(scored),
          tooltip: "Hover the comment for the breakdown",
          command: "",
        }),
    );
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/** The score's breakdown when hovering a scored comment. */
export class ComplexityHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly analyzer: CommentAnalyzer,
    private readonly settings: () => Settings,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const comments = await analyze(this.analyzer, this.settings(), document);
    const scored = comments.find((comment) => rangeOf(comment).contains(position));
    return (
      scored && new vscode.Hover(new vscode.MarkdownString(hoverMarkdown(scored)), rangeOf(scored))
    );
  }
}

/** Information diagnostics on comments at or above the threshold, when turned on. */
export class ComplexityDiagnostics {
  constructor(
    private readonly analyzer: CommentAnalyzer,
    private readonly settings: () => Settings,
    private readonly collection: vscode.DiagnosticCollection,
  ) {}

  /** Recomputes the document's diagnostics; a result for an outdated version is dropped. */
  async update(document: vscode.TextDocument): Promise<void> {
    const settings = this.settings();
    if (!settings.diagnostics) {
      this.collection.delete(document.uri);
      return;
    }
    const { version } = document;
    const comments = await analyze(this.analyzer, settings, document);
    // Outdated: the document changed, closed, or the settings changed (each change is a new
    // object), and a newer update owns the result.
    if (document.version !== version || document.isClosed || this.settings() !== settings) {
      return;
    }
    this.collection.set(
      document.uri,
      comments.filter(complex(settings)).map((scored) => {
        const diagnostic = new vscode.Diagnostic(
          rangeOf(scored),
          diagnosticMessage(scored),
          vscode.DiagnosticSeverity.Information,
        );
        diagnostic.source = "Comment Complexity";
        return diagnostic;
      }),
    );
  }

  delete(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }
}
