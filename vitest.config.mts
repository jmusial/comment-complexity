import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // There is no `vscode` package outside the extension host; unit tests get a stub.
    alias: { vscode: fileURLToPath(new URL("./src/test/unit/vscode.stub.ts", import.meta.url)) },
  },
  test: {
    include: ["src/test/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/test/**"],
      reporter: ["text", "lcov"],
    },
  },
});
