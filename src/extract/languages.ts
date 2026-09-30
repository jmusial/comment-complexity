/** Per-language rules for finding and classifying comments in a tree-sitter syntax tree. */
export interface LanguageSpec {
  /** Grammar file stem (`tree-sitter-<grammar>.wasm`). */
  readonly grammar: string;
  /** Node types that are comments. */
  readonly commentTypes: readonly string[];
  /** Prefix of a single-line comment; consecutive ones are grouped into one comment. */
  readonly linePrefix: string;
  /** Block comment delimiters. */
  readonly blockStart: string;
  readonly blockEnd: string;
  /** Prefix of a doc comment, a block comment that documents the next declaration. */
  readonly docPrefix: string;
  /** Matches the comment body (markers stripped) of lint, type-checker and bundler directives. */
  readonly directive: RegExp;
  /** Node types whose `name` (or `property`) field names the documented symbol. */
  readonly declarationTypes: readonly string[];
  /** Node types that wrap a declaration, e.g. `export` or `declare`. */
  readonly wrapperTypes: readonly string[];
  /** Node types between a comment and its declaration that belong to the declaration. */
  readonly attachedTypes: readonly string[];
}

const jsFamily = {
  commentTypes: ["comment"],
  linePrefix: "//",
  blockStart: "/*",
  blockEnd: "*/",
  docPrefix: "/**",
  directive:
    /^\s*(?:eslint(?:-disable|-enable|-env)?\b|globals?\s|jshint\b|jslint\b|prettier-ignore\b|@ts-(?:ignore|expect-error|nocheck|check)\b|(?:istanbul|c8|v8) ignore\b|oxlint-(?:disable|enable)\b|biome-ignore\b|@jsx(?:ImportSource|Runtime|Frag)?\b|@flow\b|#(?:end)?region\b|<(?:reference|amd-module|amd-dependency)\b|webpack[A-Z]|@vite-ignore\b|[@#]__(?:PURE|NO_SIDE_EFFECTS)__)/,
  declarationTypes: [
    "function_declaration",
    "generator_function_declaration",
    "function_signature",
    "class_declaration",
    "abstract_class_declaration",
    "method_definition",
    "method_signature",
    "abstract_method_signature",
    "field_definition",
    "public_field_definition",
    "property_signature",
    "lexical_declaration",
    "variable_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
  ],
  wrapperTypes: ["export_statement", "ambient_declaration"],
  attachedTypes: ["decorator"],
} as const;

/** Languages with extraction rules, keyed by VS Code language id. */
export const LANGUAGES: ReadonlyMap<string, LanguageSpec> = new Map([
  ["javascript", { ...jsFamily, grammar: "javascript" }],
  ["javascriptreact", { ...jsFamily, grammar: "javascript" }],
  ["typescript", { ...jsFamily, grammar: "typescript" }],
  ["typescriptreact", { ...jsFamily, grammar: "tsx" }],
]);
