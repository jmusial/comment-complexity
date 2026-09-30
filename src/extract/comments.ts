import { type Node, Parser, type Point, type Tree } from "@vscode/tree-sitter-wasm";
import type { LanguageSpec } from "./languages";

export type CommentKind = "line" | "block" | "doc";

export interface Comment {
  /** Rows and UTF-16 columns, like `vscode.Range`. */
  readonly range: { readonly start: Point; readonly end: Point };
  readonly kind: CommentKind;
  /** Source text including markers; grouped line comments are joined with "\n", without indentation. */
  readonly rawText: string;
  /** Name of the declaration right below the comment, if any. */
  readonly targetSymbolName: string | undefined;
}

const LICENSE = /\b(?:copyright|licen[cs]ed?|spdx-license-identifier)\b|\(c\)|©/i;

/** Commented-out code nearly always has one of these; prose that happens to parse (`TODO`, `a - b`) does not. */
const CODE_PUNCTUATION = /[;{}()[\]=]/;

/**
 * Collects the comments worth scoring, in document order: consecutive line comments become one,
 * while license headers, directives and commented-out code are dropped.
 */
export function extractComments(tree: Tree, spec: LanguageSpec): Comment[] {
  const groups: Node[][] = [];
  for (const node of tree.rootNode.descendantsOfType([...spec.commentTypes])) {
    if (!node || spec.directive.test(bodyOf(node, spec))) {
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
    const comments: Comment[] = [];
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
        if (parses(parser, body)) {
          continue;
        }
      }
      comments.push({
        range: { start: first.startPosition, end: last.endPosition },
        kind,
        rawText: nodes.map((node) => node.text).join("\n"),
        targetSymbolName: targetOf(last, spec),
      });
    }
    return comments;
  } finally {
    parser?.delete();
  }
}

function kindOf(node: Node, spec: LanguageSpec): CommentKind {
  if (node.text.startsWith(spec.linePrefix)) {
    return "line";
  }
  return node.text.startsWith(spec.docPrefix) ? "doc" : "block";
}

/** Comment text without markers, leading `*` gutters or surrounding whitespace. */
function bodyOf(node: Node, spec: LanguageSpec): string {
  const text = node.text;
  if (kindOf(node, spec) === "line") {
    let body = text.slice(spec.linePrefix.length);
    // `///` and `////` are still line comments.
    while (body !== "" && spec.linePrefix.includes(body[0]!)) {
      body = body.slice(1);
    }
    return body.trim();
  }
  const end = text.endsWith(spec.blockEnd) ? text.length - spec.blockEnd.length : text.length;
  return text
    .slice(spec.blockStart.length, end)
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n")
    .trim();
}

/** A comment on the same row as the code before it, e.g. `x(); // why`. */
function isTrailing(node: Node): boolean {
  const previous = node.previousSibling;
  return previous !== null && previous.endPosition.row === node.startPosition.row;
}

function continuesRun(last: Node, node: Node, spec: LanguageSpec): boolean {
  return (
    kindOf(last, spec) === "line" &&
    kindOf(node, spec) === "line" &&
    !isTrailing(last) &&
    !isTrailing(node) &&
    node.startPosition.row === last.endPosition.row + 1 &&
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
    const shebang = previous.startIndex === 0 && previous.text.startsWith("#!");
    if (!shebang && !spec.commentTypes.includes(previous.type)) {
      return false;
    }
  }
  return true;
}

function parses(parser: Parser, text: string): boolean {
  const tree = parser.parse(text);
  const ok = tree !== null && !tree.rootNode.hasError;
  tree?.delete();
  return ok;
}

/**
 * Name of the declaration directly below `node`, skipping further comments and decorators.
 * A blank line in between detaches the comment.
 */
function targetOf(node: Node, spec: LanguageSpec): string | undefined {
  if (isTrailing(node)) {
    return undefined;
  }
  let row = node.endPosition.row;
  for (let next = node.nextNamedSibling; next; next = next.nextNamedSibling) {
    if (next.startPosition.row > row + 1) {
      return undefined;
    }
    if (!spec.commentTypes.includes(next.type) && !spec.attachedTypes.includes(next.type)) {
      return nameOf(next, spec);
    }
    row = next.endPosition.row;
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
  // Variable declarations name their first declarator.
  const name =
    node.childForFieldName("name") ??
    node.childForFieldName("property") ??
    node.firstNamedChild?.childForFieldName("name");
  // Destructuring patterns and string keys have no single name.
  return name && name.type.endsWith("identifier") ? name.text : undefined;
}
