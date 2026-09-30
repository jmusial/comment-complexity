import { type Node, Parser, type Point, type Tree } from "@vscode/tree-sitter-wasm";
import type { LanguageSpec } from "./languages";

export type CommentKind = "line" | "block" | "doc";

export interface Comment {
  /** Rows and UTF-16 columns, like `vscode.Range`. */
  readonly range: { readonly start: Point; readonly end: Point };
  readonly kind: CommentKind;
  /** Source text including markers; grouped line comments are joined with "\n", without indentation. */
  readonly rawText: string;
  /** Name of the declaration the comment documents, if any. */
  readonly targetSymbolName: string | undefined;
}

const LICENSE = /\b(?:copyright|licen[cs]ed?|spdx-license-identifier)\b|\(c\)|©/i;

/** Commented-out code nearly always has one of these; prose that happens to parse (`TODO`, `a - b`) does not. */
const CODE_PUNCTUATION = /[;{}()[\]=]/;

/**
 * Collects the comments worth scoring, in document order: consecutive line comments become one,
 * docstrings count as doc comments, and shebangs, license headers, directives and commented-out
 * code are dropped.
 */
export function extractComments(tree: Tree, spec: LanguageSpec): Comment[] {
  const groups: Node[][] = [];
  for (const node of tree.rootNode.descendantsOfType([...spec.commentTypes])) {
    if (!node || isShebang(node) || spec.directive.test(bodyOf(node, spec))) {
      continue;
    }
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last && continuesRun(last, node, spec)) {
      group.push(node);
    } else {
      groups.push([node]);
    }
  }

  // Only needed to test for commented-out code, so created on first use.
  let parser: Parser | undefined;
  try {
    const comments: Comment[] = docstringsOf(tree, spec);
    for (const nodes of groups) {
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const kind = kindOf(first, spec);
      const body = nodes.map((node) => bodyOf(node, spec)).join("\n");
      if (body === "" || (LICENSE.test(body) && atFileStart(first, spec))) {
        continue;
      }
      if (kind !== "doc" && CODE_PUNCTUATION.test(body)) {
        parser ??= new Parser().setLanguage(tree.language);
        if (parsesAsCode(parser, body, spec)) {
          continue;
        }
      }
      const inner = spec.innerDocPrefixes?.some((prefix) => first.text.startsWith(prefix));
      comments.push({
        range: { start: first.startPosition, end: endOf(last, spec) },
        kind,
        rawText: nodes.map(textOf).join("\n"),
        targetSymbolName: inner ? enclosingName(first, spec) : targetOf(last, spec),
      });
    }
    return comments.toSorted(
      (a, b) => a.range.start.row - b.range.start.row || a.range.start.column - b.range.start.column,
    );
  } finally {
    parser?.delete();
  }
}

function isShebang(node: Node): boolean {
  return node.startIndex === 0 && node.text.startsWith("#!");
}

/** Comment text without the newline that some grammars (Rust doc comments) include. */
function textOf(node: Node): string {
  return node.text.replace(/\r?\n$/, "");
}

/** End of `node`, before a comment's own newline, so rows compare the same across grammars. */
function endOf(node: Node, spec: LanguageSpec): Point {
  if (!spec.commentTypes.includes(node.type) || !node.text.endsWith("\n")) {
    return node.endPosition;
  }
  const lines = textOf(node).split("\n");
  const lastLine = lines[lines.length - 1]!;
  return {
    row: node.startPosition.row + lines.length - 1,
    column: (lines.length === 1 ? node.startPosition.column : 0) + lastLine.length,
  };
}

/** The marker a comment opens with; doc prefixes win over the plain ones they extend. */
function openerOf(node: Node, spec: LanguageSpec): string {
  const text = node.text;
  return (
    [...spec.docPrefixes, spec.linePrefix, spec.block?.start].find(
      (prefix) => prefix !== undefined && text.startsWith(prefix),
    ) ?? ""
  );
}

function kindOf(node: Node, spec: LanguageSpec): CommentKind {
  const opener = openerOf(node, spec);
  if (spec.docPrefixes.includes(opener)) {
    return "doc";
  }
  return opener === spec.linePrefix ? "line" : "block";
}

/** Comment text without markers, leading `*` gutters or surrounding whitespace. */
function bodyOf(node: Node, spec: LanguageSpec): string {
  const text = textOf(node);
  const opener = openerOf(node, spec);
  if (text.startsWith(spec.linePrefix)) {
    let body = text.slice(opener.length);
    // `////` or `##` are still plain line comments.
    while (body !== "" && spec.linePrefix.includes(body[0]!)) {
      body = body.slice(1);
    }
    return body.trim();
  }
  // `max` keeps an empty `/**/` from overlapping its own opener.
  const end =
    spec.block && text.endsWith(spec.block.end)
      ? Math.max(opener.length, text.length - spec.block.end.length)
      : text.length;
  return text
    .slice(opener.length, end)
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n")
    .trim();
}

/** A comment on the same row as the code before it, e.g. `x(); // why`. */
function isTrailing(node: Node, spec: LanguageSpec): boolean {
  const previous = node.previousSibling;
  return previous !== null && endOf(previous, spec).row === node.startPosition.row;
}

function continuesRun(last: Node, node: Node, spec: LanguageSpec): boolean {
  return (
    last.text.startsWith(spec.linePrefix) &&
    // Plain and doc line comments (`//` vs `///`) do not mix.
    openerOf(last, spec) === openerOf(node, spec) &&
    !isTrailing(last, spec) &&
    !isTrailing(node, spec) &&
    node.startPosition.row === endOf(last, spec).row + 1 &&
    // A dropped directive in between splits the run.
    last.nextSibling?.equals(node) === true
  );
}

/** Top level, with only comments or a shebang before it. */
function atFileStart(node: Node, spec: LanguageSpec): boolean {
  if (node.parent?.parent !== null) {
    return false;
  }
  for (let previous = node.previousSibling; previous; previous = previous.previousSibling) {
    if (!isShebang(previous) && !spec.commentTypes.includes(previous.type)) {
      return false;
    }
  }
  return true;
}

function parsesAsCode(parser: Parser, text: string, spec: LanguageSpec): boolean {
  const wrappers = spec.codeWrappers ?? [(code: string) => code];
  return wrappers.some((wrap) => {
    const tree = parser.parse(wrap(text));
    const ok = tree !== null && !tree.rootNode.hasError;
    tree?.delete();
    return ok;
  });
}

/** Docstrings of the module and of each owner declaration, targeting that declaration. */
function docstringsOf(tree: Tree, spec: LanguageSpec): Comment[] {
  if (!spec.docstrings) {
    return [];
  }
  const { owners, statementType, stringType } = spec.docstrings;
  const root = tree.rootNode;
  const comments: Comment[] = [];
  // Includes the root itself when it is an owner.
  for (const owner of root.descendantsOfType([...owners])) {
    if (!owner) {
      continue;
    }
    const isModule = owner.equals(root);
    const body = isModule ? root : owner.childForFieldName("body");
    const statement = body?.namedChildren.find(
      (child) => child !== null && !spec.commentTypes.includes(child.type),
    );
    const string =
      statement?.type === statementType && statement.namedChildCount === 1
        ? statement.firstNamedChild
        : null;
    if (string?.type !== stringType) {
      continue;
    }
    comments.push({
      range: { start: string.startPosition, end: string.endPosition },
      kind: "doc",
      rawText: string.text,
      targetSymbolName: isModule ? undefined : nameOf(owner, spec),
    });
  }
  return comments;
}

/**
 * Name of the declaration directly below `node`, skipping further comments and decorators.
 * A blank line in between detaches the comment.
 */
function targetOf(node: Node, spec: LanguageSpec): string | undefined {
  if (isTrailing(node, spec)) {
    return undefined;
  }
  let row = endOf(node, spec).row;
  for (let next = node.nextNamedSibling; next; next = next.nextNamedSibling) {
    if (next.startPosition.row > row + 1) {
      return undefined;
    }
    if (!spec.commentTypes.includes(next.type) && !spec.attachedTypes.includes(next.type)) {
      return nameOf(next, spec);
    }
    row = endOf(next, spec).row;
  }
  return undefined;
}

/** Name of the nearest declaration around `node`, for comments that document their container. */
function enclosingName(node: Node, spec: LanguageSpec): string | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (spec.declarationTypes.includes(parent.type)) {
      return nameOf(parent, spec);
    }
  }
  return undefined;
}

function nameOf(node: Node, spec: LanguageSpec): string | undefined {
  if (spec.wrapperTypes.includes(node.type)) {
    const inner = node.namedChildren.find(
      (child) =>
        child !== null &&
        (spec.declarationTypes.includes(child.type) || spec.wrapperTypes.includes(child.type)),
    );
    return inner ? nameOf(inner, spec) : undefined;
  }
  if (!spec.declarationTypes.includes(node.type)) {
    return undefined;
  }
  // Variable declarations name their first declarator; others, like a Python assignment or a Go
  // package clause, lead with the identifier itself.
  const declarator = node.childForFieldName("declarator") ?? node.firstNamedChild;
  const name =
    node.childForFieldName("name") ??
    node.childForFieldName("property") ??
    declarator?.childForFieldName("name") ??
    declarator;
  // Destructuring patterns and string keys have no single name.
  return name && name.type.endsWith("identifier") ? name.text : undefined;
}
