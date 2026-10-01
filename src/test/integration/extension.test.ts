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
});
