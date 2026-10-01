import * as vscode from "vscode";
import type { CommentAnalyzer, ScoredComment } from "../score/analyzer";
import { hoverMarkdown, lensTitle } from "./present";

const key = (document: vscode.TextDocument): string => document.uri.toString();

const rangeOf = ({ comment }: ScoredComment): vscode.Range => {
  const { start, end } = comment.range;
  return new vscode.Range(start.row, start.column, end.row, end.column);
};

/** A lens above each scored comment. */
export class ComplexityLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly analyzer: CommentAnalyzer) {}

  /** Asks VS Code for fresh lenses, as when a document's tree has been parsed. */
  refresh(): void {
    this.changed.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const comments = await this.analyzer.analyze(key(document), document);
    return comments.map(
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
  constructor(private readonly analyzer: CommentAnalyzer) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const comments = await this.analyzer.analyze(key(document), document);
    const scored = comments.find((comment) => rangeOf(comment).contains(position));
    return (
      scored && new vscode.Hover(new vscode.MarkdownString(hoverMarkdown(scored)), rangeOf(scored))
    );
  }
}
