/** Per-language rules for finding and classifying comments in a tree-sitter syntax tree. */
export interface LanguageSpec {
  /** Grammar file stem (`tree-sitter-<grammar>.wasm`). */
  readonly grammar: string;
  /** Node types that are comments. */
  readonly commentTypes: readonly string[];
  /** Prefix of a single-line comment; consecutive ones are grouped into one comment. */
  readonly linePrefix: string;
  /** Block comment delimiters, if the language has block comments. */
  readonly block?: { readonly start: string; readonly end: string };
  /** Prefixes of doc comments, line or block. Longer prefixes come first. */
  readonly docPrefixes: readonly string[];
  /** Doc prefixes that document the enclosing declaration instead of the next one, like Rust's `//!`. */
  readonly innerDocPrefixes?: readonly string[];
  /** Matches the comment body (markers stripped) of lint, type-checker and build directives. */
  readonly directive: RegExp;
  /**
   * Node types that declare a symbol. The name comes from the `name`, `property` or `declarator`
   * field, else from the first named child.
   */
  readonly declarationTypes: readonly string[];
  /** Node types that wrap a declaration, e.g. `export` or a decorated definition. */
  readonly wrapperTypes: readonly string[];
  /** Node types between a comment and its declaration that belong to the declaration. */
  readonly attachedTypes: readonly string[];
  /**
   * Docstrings: a `stringType` node alone in a `statementType` node that opens an `owners` node's
   * body. The root node's type as an owner means a module docstring.
   */
  readonly docstrings?: {
    readonly owners: readonly string[];
    readonly statementType: string;
    readonly stringType: string;
  };
  /**
   * Wraps a snippet so it parses where commented-out code would have lived, for grammars that
   * reject bare statements. Without it, snippets are parsed as-is.
   */
  readonly codeWrappers?: readonly ((code: string) => string)[];
}

const cStyle = {
  linePrefix: "//",
  block: { start: "/*", end: "*/" },
} as const;

const jsFamily = {
  ...cStyle,
  commentTypes: ["comment"],
  docPrefixes: ["/**"],
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

const python: LanguageSpec = {
  grammar: "python",
  commentTypes: ["comment"],
  linePrefix: "#",
  docPrefixes: [],
  directive:
    /^\s*(?:noqa\b|type:|pylint:|pyright:|mypy:|pragma:|fmt:\s*(?:off|on|skip)\b|isort:|ruff:|-\*-|(?:vim?|ex):)/,
  declarationTypes: ["function_definition", "class_definition", "assignment"],
  // `expression_statement` only yields a name when it holds an assignment.
  wrapperTypes: ["decorated_definition", "expression_statement"],
  attachedTypes: [],
  docstrings: {
    owners: ["module", "function_definition", "class_definition"],
    statementType: "expression_statement",
    stringType: "string",
  },
};

const go: LanguageSpec = {
  ...cStyle,
  grammar: "go",
  commentTypes: ["comment"],
  docPrefixes: [],
  directive:
    /^\s*(?:go:\w|\+build\b|nolint\b|lint:(?:ignore|file-ignore)\b|export\s|line\s|extern\s|#cgo\b|Code generated .* DO NOT EDIT\.)/,
  declarationTypes: [
    "package_clause",
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "type_spec",
    "type_alias",
    "var_declaration",
    "var_spec",
    "const_declaration",
    "const_spec",
    "field_declaration",
    "method_elem",
  ],
  wrapperTypes: [],
  attachedTypes: [],
  // Go only allows declarations at top level, so statements need a function around them.
  codeWrappers: [(code) => `package p\n${code}`, (code) => `package p\nfunc _() {\n${code}\n}`],
};

const rust: LanguageSpec = {
  ...cStyle,
  grammar: "rust",
  commentTypes: ["line_comment", "block_comment"],
  docPrefixes: ["///", "//!", "/**", "/*!"],
  innerDocPrefixes: ["//!", "/*!"],
  directive: /^\s*(?:@generated\b|rustfmt::skip\b)/,
  declarationTypes: [
    "function_item",
    "function_signature_item",
    "struct_item",
    "union_item",
    "enum_item",
    "enum_variant",
    "trait_item",
    "impl_item",
    "const_item",
    "static_item",
    "mod_item",
    "type_item",
    "macro_definition",
    "field_declaration",
  ],
  wrapperTypes: [],
  attachedTypes: ["attribute_item"],
};

const java: LanguageSpec = {
  ...cStyle,
  grammar: "java",
  commentTypes: ["line_comment", "block_comment"],
  docPrefixes: ["/**"],
  directive:
    /^\s*(?:noinspection\b|CHECKSTYLE[:.]|@formatter:(?:off|on)\b|NOSONAR\b|NOPMD\b|spotless:(?:off|on)\b|language=)/,
  declarationTypes: [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "enum_constant",
    "record_declaration",
    "annotation_type_declaration",
    "annotation_type_element_declaration",
    "method_declaration",
    "constructor_declaration",
    "field_declaration",
    "constant_declaration",
  ],
  wrapperTypes: [],
  // Annotations sit inside the declaration's `modifiers`, so nothing to skip.
  attachedTypes: [],
};

/** Languages with extraction rules, keyed by VS Code language id. */
export const LANGUAGES: ReadonlyMap<string, LanguageSpec> = new Map([
  ["javascript", { ...jsFamily, grammar: "javascript" }],
  ["javascriptreact", { ...jsFamily, grammar: "javascript" }],
  ["typescript", { ...jsFamily, grammar: "typescript" }],
  ["typescriptreact", { ...jsFamily, grammar: "tsx" }],
  ["python", python],
  ["go", go],
  ["rust", rust],
  ["java", java],
]);
