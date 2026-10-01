import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  // A small project for the workspace vocabulary to read.
  workspaceFolder: "test-fixtures/workspace",
  // Mocha's 2 s default is shorter than a cold WASM grammar load on CI runners; tests keep their
  // own shorter `waitFor` limits.
  mocha: { timeout: 20_000 },
});
