import { describe, expect, it, vi } from "vitest";
import type { CommentAnalyzer, ScoredComment } from "../../score/analyzer";
import { DEFAULT_SETTINGS, type Settings } from "../../settings";
import { ComplexityDiagnostics } from "../../ui/providers";
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
