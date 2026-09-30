const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const fs = require("node:fs");
const path = require("node:path");

// WASM files copied next to the bundle: tree-sitter runtime + grammars (loaded lazily at runtime).
const wasmDir = "node_modules/@vscode/tree-sitter-wasm/wasm";
const grammars = [
  "bash",
  "c-sharp",
  "cpp",
  "css",
  "go",
  "java",
  "javascript",
  "php",
  "python",
  "ruby",
  "rust",
  "tsx",
  "typescript",
];
const wasmAssets = [
  { from: `${wasmDir}/tree-sitter.wasm`, to: "dist/tree-sitter.wasm" },
  ...grammars.map((g) => ({
    from: `${wasmDir}/tree-sitter-${g}.wasm`,
    to: `dist/grammars/tree-sitter-${g}.wasm`,
  })),
];

/** @type {import('esbuild').Plugin} */
const copyWasmPlugin = {
  name: "copy-wasm",
  setup(build) {
    build.onEnd(() => {
      for (const { from, to } of wasmAssets) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    });
  },
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [copyWasmPlugin, esbuildProblemMatcherPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
