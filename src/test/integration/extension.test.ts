import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Extension", () => {
  test("activates", async () => {
    const ext = vscode.extensions.getExtension("jmusial.comment-complexity");
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });
});
