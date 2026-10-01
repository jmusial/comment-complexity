import * as assert from "node:assert";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../extension";

async function activate(): Promise<ExtensionApi> {
  const ext = vscode.extensions.getExtension<ExtensionApi>("jmusial.comment-complexity");
  assert.ok(ext);
  return ext.activate();
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Changes `commentComplexity.*` user settings; `undefined` resets one. */
async function configure(values: Record<string, unknown>): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("commentComplexity");
  for (const [setting, value] of Object.entries(values)) {
    await configuration.update(setting, value, vscode.ConfigurationTarget.Global);
  }
}

suite("Extension", () => {
  test("activates", async () => {
    await activate();
    const ext = vscode.extensions.getExtension("jmusial.comment-complexity");
    assert.strictEqual(ext?.isActive, true);
  });

  test("parses an opened TypeScript document from bundled WASM and follows edits", async () => {
    const { trees } = await activate();
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "const x = 1;\n",
    });
    const key = document.uri.toString();

    const opened = await waitFor(() => trees.get(key));
    assert.strictEqual(opened.rootNode.hasError, false);

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "/** The answer. */\n");
    assert.ok(await vscode.workspace.applyEdit(edit));

    const comment = await waitFor(
      () => trees.get(key)?.rootNode.descendantsOfType("comment")[0] ?? undefined,
    );
    assert.strictEqual(comment.text, "/** The answer. */");
  });

  test("builds the vocabulary from workspace identifiers, skipping vendored code", async () => {
    const { vocabulary } = await activate();
    const words = await vocabulary.words();

    for (const word of ["ledger", "entry", "settle", "invoice", "ttl", "seconds"]) {
      assert.ok(words.has(word), `missing "${word}"`);
    }
    // Docstrings, comments and vendor/ are not the project's identifiers.
    for (const word of ["docstrings", "comments", "zanzibar"]) {
      assert.ok(!words.has(word), `unexpected "${word}"`);
    }
    // Built once, then cached.
    assert.strictEqual(await vocabulary.words(), words);
  });

  test("shows a lens above each comment and the breakdown on hover", async () => {
    await activate();
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "// Retries the upload when the network drops.\nconst retries = 3;\n",
    });
    const lenses = await waitFor(async () => {
      const found = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        document.uri,
      );
      return found.some((lens) => lens.command?.title.startsWith("complexity")) ? found : undefined;
    });
    const lens = lenses.find((found) => found.command?.title.startsWith("complexity"));
    assert.strictEqual(lens?.range.start.line, 0);
    assert.ok(!lens.command?.title.includes("approx"), lens.command?.title);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(0, 8),
    );
    const markdown = hovers
      .flatMap((hover) => hover.contents)
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n");
    assert.match(markdown, /\*\*Comment complexity \d+\.\d \/ 10\*\*/);
    assert.match(markdown, /\| Clauses \|/);
  });

  test("applies settings live: diagnostics and lenses above the threshold", async () => {
    await activate();
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "// Retries the upload when the network drops.\nconst retries = 3;\n",
    });
    const lenses = () =>
      vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        document.uri,
      );
    try {
      await waitFor(async () => ((await lenses()).length > 0 ? true : undefined));
      assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);

      await configure({ diagnostics: true, threshold: 0 });
      const [diagnostic] = await waitFor(() => {
        const found = vscode.languages.getDiagnostics(document.uri);
        return found.length > 0 ? found : undefined;
      });
      assert.strictEqual(diagnostic?.severity, vscode.DiagnosticSeverity.Information);
      assert.strictEqual(diagnostic.source, "Comment Complexity");

      await configure({ threshold: 10, showOnlyAbove: true });
      await waitFor(async () =>
        (await lenses()).length === 0 && vscode.languages.getDiagnostics(document.uri).length === 0
          ? true
          : undefined,
      );
    } finally {
      await configure({ diagnostics: undefined, threshold: undefined, showOnlyAbove: undefined });
    }
  });

  test("toggles lenses and jumps to the most complex comment from the file report", async () => {
    await activate();
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: [
        "// Plain words here.",
        "const x = 1;",
        "// Idempotent SQS reconciliation never retries unless the lease wasn't renewed.",
        "const y = 2;",
        "",
      ].join("\n"),
    });
    const editor = await vscode.window.showTextDocument(document);
    const lenses = () =>
      vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        document.uri,
      );
    await waitFor(async () => ((await lenses()).length === 2 ? true : undefined));

    await vscode.commands.executeCommand("commentComplexity.toggleLenses");
    assert.deepStrictEqual(await lenses(), []);
    await vscode.commands.executeCommand("commentComplexity.toggleLenses");
    assert.strictEqual((await lenses()).length, 2);

    // The report opens a quick pick; accept its first entry as a user would.
    // It may not be open yet, so keep accepting until the command finishes.
    let done = false;
    const reported = vscode.commands
      .executeCommand("commentComplexity.fileReport")
      .then(() => (done = true));
    await waitFor(async () => {
      await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
      await new Promise((resolve) => setTimeout(resolve, 50));
      return done ? true : undefined;
    });
    await reported;
    const active = await waitFor(() =>
      vscode.window.activeTextEditor?.selection.active.line === 2
        ? vscode.window.activeTextEditor
        : undefined,
    );
    assert.strictEqual(active.document, editor.document);
  });

  test("reports a file opened a moment ago, once it is parsed", async () => {
    await activate();
    const document = await vscode.workspace.openTextDocument({
      language: "rust",
      content:
        "// Idempotent SQS reconciliation never retries unless the lease wasn't renewed.\nfn main() {}\n",
    });
    await vscode.window.showTextDocument(document);
    // No waiting for lenses: the report itself must wait for the tree.
    let done = false;
    const reported = vscode.commands
      .executeCommand("commentComplexity.fileReport")
      .then(() => (done = true));
    await waitFor(async () => {
      await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
      await new Promise((resolve) => setTimeout(resolve, 50));
      return done ? true : undefined;
    });
    await reported;
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.character, 0);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 0);
  });

  /** Lens a fixture comment should get: its line (0-based) and score range. */
  interface ExpectedLens {
    readonly line: number;
    readonly min: number;
    readonly max: number;
    readonly restatesName?: boolean;
  }

  // Each fixture has a plain doc comment, one that restates its function's name and a dense one.
  // License headers, short labels and commented-out code get no lens.
  const plain = { min: 0, max: 2 };
  const dense = { min: 4, max: 10 };
  const LANGUAGES: readonly [file: string, language: string, lenses: ExpectedLens[]][] = [
    [
      "shipping.ts",
      "typescript",
      [
        { line: 2, ...plain },
        { line: 7, ...plain, restatesName: true },
        { line: 12, ...dense },
      ],
    ],
    [
      "shipping.py",
      "python",
      [
        { line: 4, ...plain },
        { line: 9, ...plain, restatesName: true },
        { line: 13, ...dense },
      ],
    ],
    [
      "shipping.go",
      "go",
      [
        { line: 4, ...plain },
        { line: 9, ...plain, restatesName: true },
        { line: 14, ...dense },
      ],
    ],
    [
      "shipping.rs",
      "rust",
      [
        { line: 2, ...plain },
        { line: 7, ...plain, restatesName: true },
        { line: 12, ...dense },
      ],
    ],
  ];

  for (const [file, language, expected] of LANGUAGES) {
    test(`scores ${language} comments: lens count, position and score range`, async () => {
      await activate();
      const [folder] = vscode.workspace.workspaceFolders ?? [];
      assert.ok(folder, "the test workspace is open");
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(folder.uri, "languages", file),
      );
      assert.strictEqual(document.languageId, language);
      await vscode.window.showTextDocument(document);

      const lenses = await waitFor(async () => {
        const found = await vscode.commands.executeCommand<vscode.CodeLens[]>(
          "vscode.executeCodeLensProvider",
          document.uri,
        );
        // All of a file's lenses come in one response, once its tree is parsed.
        return found.length > 0 ? found : undefined;
      });
      const actual = lenses
        .map((lens) => ({ line: lens.range.start.line, title: lens.command?.title ?? "" }))
        .toSorted((a, b) => a.line - b.line);
      assert.deepStrictEqual(
        actual.map(({ line }) => line),
        expected.map(({ line }) => line),
        `lenses: ${JSON.stringify(actual)}`,
      );
      for (const [i, { title }] of actual.entries()) {
        const { line, min, max, restatesName = false } = expected[i]!;
        const score = Number(/^complexity (\d+\.\d)/.exec(title)?.[1]);
        assert.ok(score >= min && score <= max, `line ${line}: ${title} not in ${min}-${max}`);
        assert.strictEqual(title.includes("restates name"), restatesName, title);
        assert.ok(!title.includes("approx"), title);
      }
    });
  }
});
