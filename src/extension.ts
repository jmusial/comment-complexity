import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Comment Complexity", {
    log: true,
  });
  context.subscriptions.push(log);
  log.info("Comment Complexity activated");
}

export function deactivate(): void {}
