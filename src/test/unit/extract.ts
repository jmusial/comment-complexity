import * as path from "node:path";
import { type Comment, extractComments } from "../../extract/comments";
import { LANGUAGES } from "../../extract/languages";
import { GrammarLoader } from "../../extract/treeSitter";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");
const loader = new GrammarLoader(wasmDir, wasmDir);

/** Parses `lines` as `languageId` and extracts its comments. */
export async function extract(lines: string[], languageId = "typescript"): Promise<Comment[]> {
  const parser = (await loader.createParser(languageId))!;
  const tree = parser.parse(lines.join("\n"))!;
  try {
    return extractComments(tree, LANGUAGES.get(languageId)!);
  } finally {
    tree.delete();
    parser.delete();
  }
}

export const summary = ({ kind, rawText, targetSymbolName }: Comment) => ({
  kind,
  rawText,
  target: targetSymbolName,
});
