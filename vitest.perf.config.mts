import { defineConfig } from "vitest/config";

/** Timing tests: run on their own, without coverage instrumentation slowing them down. */
export default defineConfig({
  test: {
    include: ["src/test/perf/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
