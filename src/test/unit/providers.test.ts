import { describe, expect, it, vi } from "vitest";
import type { CommentAnalyzer, ScoredComment } from "../../score/analyzer";
import { DEFAULT_SETTINGS, type Settings } from "../../settings";
import {
  ComplexityDiagnostics,
  ComplexityHoverProvider,
  ComplexityLensProvider,
} from "../../ui/providers";
import * as vscode from "./vscode.stub";

describe("ComplexityDiagnostics", () => {
  it("drops a result that the settings changed under", async () => {
    let finish: ((comments: ScoredComment[]) => void) | undefined;
    const analyzer = {
      analyze: () => new Promise<ScoredComment[]>((resolve) => (finish = resolve)),
    } as unknown as CommentAnalyzer;
    let settings: Settings = { ...DEFAULT_SETTINGS, diagnostics: true };
    const set = vi.fn<(uri: unknown, items: unknown) => void>();
    const collection = { set, delete: vi.fn<(uri: unknown) => void>() };
    const diagnostics = new ComplexityDiagnostics(analyzer, () => settings, collection as never);
    const document = {
      uri: { toString: () => "file:///ws/a.kt" },
      languageId: "kotlin",
      version: 1,
      isClosed: false,
    };

    const pending = diagnostics.update(document as never);
    // Turned off while the first analysis is still running.
    settings = { ...settings, diagnostics: false };
    await diagnostics.update(document as never);
    expect(collection.delete).toHaveBeenCalledTimes(1);

    finish!([]);
    await pending;
    expect(set).not.toHaveBeenCalled();
    expect(vscode.diagnostics.size).toBe(0);
  });
});

describe("cancellation", () => {
  const scored = {
    comment: { range: { start: { row: 0, column: 0 }, end: { row: 0, column: 30 } } },
    text: "Retries the upload.",
    words: 3,
    score: { score: 1, label: "easy", reasons: [], contributions: [], readability: 0 },
    redundancy: { redundant: false, overlap: 0 },
  } as unknown as ScoredComment;
  const analyzer = { analyze: async () => [scored] } as unknown as CommentAnalyzer;
  const document = { uri: { toString: () => "file:///ws/a.ts" }, languageId: "typescript" };
  const cancelled = { isCancellationRequested: true };
  const live = { isCancellationRequested: false };

  it("returns no lenses for a cancelled request", async () => {
    const lenses = new ComplexityLensProvider(analyzer, () => DEFAULT_SETTINGS);
    expect(await lenses.provideCodeLenses(document as never, cancelled as never)).toEqual([]);
    expect(await lenses.provideCodeLenses(document as never, live as never)).toHaveLength(1);
  });

  it("returns no hover for a cancelled request", async () => {
    const hover = new ComplexityHoverProvider(analyzer, () => DEFAULT_SETTINGS);
    const position = new vscode.Position(0, 3) as never;
    expect(await hover.provideHover(document as never, position, cancelled as never)).toBe(
      undefined,
    );
    expect(await hover.provideHover(document as never, position, live as never)).toBeDefined();
  });
});
