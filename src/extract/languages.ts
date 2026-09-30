/** Per-language rules for finding and classifying comments in a tree-sitter syntax tree. */
export interface LanguageSpec {
  /** Grammar file stem (`tree-sitter-<grammar>.wasm`). */
  readonly grammar: string;
  /** Node types that are comments. */
  readonly commentTypes: readonly string[];
  /** Prefixes of single-line comments; consecutive ones with the same prefix are grouped into one. */
  readonly linePrefixes: readonly string[];
  /** Block comment delimiters, if the language has block comments. */
  readonly block?: { readonly start: string; readonly end: string };
  /** Prefixes of doc comments, line or block. Longer prefixes come first. */
  readonly docPrefixes: readonly string[];
  /** Doc prefixes that document the enclosing declaration instead of the next one, like Rust's `//!`. */
  readonly innerDocPrefixes?: readonly string[];
  /** Matches the comment body (markers stripped) of lint, type-checker and build directives. */
  readonly directive: RegExp;
  /**
   * Node types that declare a symbol. The name is found through the `name`, `property`,
   * `declarator` or `left` field, else through an unlabelled declarator or identifier child.
   */
  readonly declarationTypes: readonly string[];
  /** Node types that wrap a declaration, e.g. `export`; the first non-attached child is the declaration. */
  readonly wrapperTypes: readonly string[];
  /** Node types between a comment and its declaration that belong to the declaration. */
  readonly attachedTypes: readonly string[];
  /** Node types that may precede a license header, like PHP's `<?php`. A shebang always may. */
  readonly preambleTypes?: readonly string[];
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
   * reject bare statements. Without it, snippets are parsed as-is; an empty list turns the check off.
   */
  readonly codeWrappers?: readonly ((code: string) => string)[];
}

const cStyle = {
  linePrefixes: ["//"],
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
  linePrefixes: ["#"],
  docPrefixes: [],
  directive:
    /^\s*(?:noqa\b|type:|pylint:|pyright:|mypy:|pragma:|fmt:\s*(?:off|on|skip)\b|isort:|ruff:|-\*-|(?:vim?|ex):)/,
  declarationTypes: ["function_definition", "class_definition", "assignment"],
  // `expression_statement` only yields a name when it holds an assignment.
  wrapperTypes: ["decorated_definition", "expression_statement"],
  attachedTypes: ["decorator"],
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

/** C and C++ share the C++ grammar, which parses plain C well enough to find comments. */
const cpp: LanguageSpec = {
  ...cStyle,
  grammar: "cpp",
  commentTypes: ["comment"],
  // Doxygen styles; `//!` and `/*!` document the next declaration like `///` and `/**`.
  docPrefixes: ["///", "//!", "/**", "/*!"],
  directive:
    /^\s*(?:NOLINT\w*|clang-format\s+(?:off|on)\b|cppcheck-suppress\b|LCOV_EXCL_\w+|IWYU pragma:|fall ?through\b|FALLTHROUGH\b|coverity\[)/i,
  declarationTypes: [
    "function_definition",
    "declaration",
    "field_declaration",
    "struct_specifier",
    "class_specifier",
    "union_specifier",
    "enum_specifier",
    "enumerator",
    "namespace_definition",
    "type_definition",
    "alias_declaration",
    "preproc_def",
    "preproc_function_def",
  ],
  wrapperTypes: ["template_declaration"],
  attachedTypes: ["template_parameter_list"],
  // Statements only live inside functions.
  codeWrappers: [(code) => code, (code) => `void _() {\n${code}\n}`],
};

const csharp: LanguageSpec = {
  ...cStyle,
  grammar: "c-sharp",
  commentTypes: ["comment"],
  docPrefixes: ["///", "/**"],
  directive:
    /^\s*(?:ReSharper\s+(?:disable|restore)\b|<auto-generated\b|csharpier-ignore\b|dotcover\s+(?:disable|enable)\b)/,
  declarationTypes: [
    "class_declaration",
    "interface_declaration",
    "struct_declaration",
    "record_declaration",
    "enum_declaration",
    "enum_member_declaration",
    "namespace_declaration",
    "file_scoped_namespace_declaration",
    "delegate_declaration",
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "property_declaration",
    "field_declaration",
    "event_field_declaration",
    "event_declaration",
  ],
  wrapperTypes: [],
  // Attributes sit inside the declaration, so nothing to skip.
  attachedTypes: [],
  codeWrappers: [(code) => code, (code) => `class _ {\n${code}\n}`],
};

const ruby: LanguageSpec = {
  grammar: "ruby",
  commentTypes: ["comment"],
  linePrefixes: ["#"],
  block: { start: "=begin", end: "=end" },
  docPrefixes: [],
  directive:
    /^\s*(?:frozen_string_literal:|(?:en)?coding:|warn_indent:|shareable_constant_value:|rubocop:(?:disable|enable|todo)\b|standard:(?:disable|enable)\b|typed:|:nodoc:|steep:ignore\b|-\*-)/,
  declarationTypes: ["class", "module", "method", "singleton_method", "assignment"],
  // A comment on the first line of a class body precedes the whole `body_statement`.
  wrapperTypes: ["body_statement"],
  attachedTypes: [],
  // Command calls without parentheses make prose like `Loads the store (lazily)` valid Ruby.
  codeWrappers: [],
};

const php: LanguageSpec = {
  ...cStyle,
  grammar: "php",
  commentTypes: ["comment"],
  linePrefixes: ["//", "#"],
  docPrefixes: ["/**"],
  directive:
    /^\s*(?:phpcs:\w+|@phpstan-ignore\S*|@psalm-suppress\b|@codeCoverageIgnore\S*|@noinspection\b|@var\b)/,
  declarationTypes: [
    "function_definition",
    "class_declaration",
    "interface_declaration",
    "trait_declaration",
    "enum_declaration",
    "enum_case",
    "method_declaration",
    "property_declaration",
    "const_declaration",
    "assignment_expression",
  ],
  // `expression_statement` only yields a name when it holds an assignment.
  wrapperTypes: ["expression_statement"],
  // Attributes sit inside the declaration, so nothing to skip.
  attachedTypes: [],
  preambleTypes: ["php_tag"],
  codeWrappers: [(code) => `<?php ${code}`, (code) => `<?php class _ {\n${code}\n}`],
};

const bash: LanguageSpec = {
  grammar: "bash",
  commentTypes: ["comment"],
  linePrefixes: ["#"],
  docPrefixes: [],
  directive: /^\s*(?:shellcheck\s|-\*-|(?:vim?|ex):)/,
  declarationTypes: ["function_definition", "variable_assignment"],
  wrapperTypes: ["declaration_command"],
  attachedTypes: [],
  // Bash parses almost any prose as a command, so commented-out code cannot be told apart.
  codeWrappers: [],
};

const css: LanguageSpec = {
  grammar: "css",
  commentTypes: ["comment"],
  linePrefixes: [],
  block: { start: "/*", end: "*/" },
  docPrefixes: [],
  directive:
    /^\s*(?:stylelint-(?:disable|enable)\S*|prettier-ignore\b|autoprefixer:\s*(?:off|on|ignore next)\b|purgecss\s|#(?:end)?region\b|rtl:)/,
  // Rule sets have selectors, not names.
  declarationTypes: [],
  wrapperTypes: [],
  attachedTypes: [],
  // Declarations only live inside a rule.
  codeWrappers: [(code) => code, (code) => `a{${code}}`],
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
  ["c", cpp],
  ["cpp", cpp],
  ["csharp", csharp],
  ["ruby", ruby],
  ["php", php],
  ["shellscript", bash],
  ["css", css],
]);
