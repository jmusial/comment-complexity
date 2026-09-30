import { splitIdentifier } from "./identifiers";

/**
 * Dialect steps take marker-free lines and return lines where tags are resolved to prose.
 * An empty line ends a unit (paragraph, tag section or entry); names they drop go to `identifiers`.
 */

/** Block tags whose text is prose; any other tag (`@example`, `@type`, `@since`, …) is dropped. */
const DESCRIBED = new Set([
  "param",
  "arg",
  "argument",
  "prop",
  "property",
  "typeparam",
  "tparam",
  "returns",
  "return",
  "retval",
  "throws",
  "throw",
  "exception",
  "yields",
  "yield",
  "deprecated",
  "remarks",
  "summary",
  "description",
  "desc",
  "brief",
  "details",
  "note",
  "warning",
  "todo",
  "fileoverview",
  "classdesc",
  "constructor",
  "receiver",
  "pre",
  "post",
]);

/** Tags followed by the name they describe. */
const NAMED = new Set(["param", "arg", "argument", "prop", "property", "typeparam", "tparam"]);

/** Tags followed by an exception type, braced in JSDoc and bare in Javadoc. */
const THROWN = new Set(["throws", "throw", "exception"]);

const RETURNS = new Set(["returns", "return"]);

/** PHPDoc's bare return type: alone, or before a capitalized description. */
const BARE_TYPE = /^[\w\\|<>[\],?]+(?:$|\s+(?=[A-Z]))/;

/** JSDoc, TSDoc, Javadoc, KDoc, PHPDoc and Doxygen (`@tag` or `\tag`). */
export function jsdocLines(lines: string[], identifiers: Set<string>): string[] {
  const text = lines
    .join("\n")
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, "\n\n")
    .replace(/<\/?(?:p|li|ul|ol|br|dl|dt|dd|h\d|table|tr|blockquote)\b[^>]*>/gi, "\n\n");
  const out: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    const tag = /^\s*[@\\](\w+)\b[ \t]*(.*)$/.exec(line);
    if (!tag) {
      if (!dropping) {
        out.push(line);
      }
      continue;
    }
    out.push("");
    const name = tag[1]!.toLowerCase();
    dropping = !DESCRIBED.has(name);
    if (dropping) {
      continue;
    }
    const afterTag = tag[2]!;
    let rest = withoutBracedType(afterTag);
    if (NAMED.has(name)) {
      rest = withoutName(rest, identifiers);
    } else if (THROWN.has(name) && rest === afterTag) {
      // `IOException`, `java.io.IOException` or PHP's `\App\NotFound`.
      const type = /^(\\?[A-Z][\w.\\]*|\w+(?:\.\w+)+)\s*/.exec(rest);
      if (type) {
        identifiers.add(type[1]!);
        rest = rest.slice(type[0].length);
      }
    } else if (RETURNS.has(name) && rest === afterTag) {
      rest = rest.replace(BARE_TYPE, "");
    }
    out.push(rest.replace(/^[-–:]\s*/, ""));
  }
  return out;
}

/** Drops a leading `{Type}`, braces balanced. */
function withoutBracedType(text: string): string {
  if (!text.startsWith("{")) {
    return text;
  }
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}" && --depth === 0) {
      return text.slice(i + 1).trimStart();
    }
  }
  return text;
}

/**
 * Drops the parameter name: `name`, `[name=default]`, `<T>`, Doxygen's `[in] name` or PHPDoc's
 * `Type $name`.
 */
function withoutName(text: string, identifiers: Set<string>): string {
  const match =
    /^(?:\[(?:in|out|in,\s*out)\]\s*)?(?:[^\s$]+\s+(?=\$))?(?:\[([^\]=\s]+)[^\]]*\]|<(\w+)>|([\w$.]+))\s*/.exec(
      text,
    );
  if (!match) {
    return text;
  }
  identifiers.add((match[1] ?? match[2] ?? match[3])!);
  return text.slice(match[0].length);
}

type Section = "entries" | "returns" | "prose" | "drop";

/** Google and NumPy docstring section titles, lower-cased. */
const SECTIONS = new Map<string, Section>([
  ...[
    "args",
    "arguments",
    "parameters",
    "params",
    "attributes",
    "keyword args",
    "keyword arguments",
    "other parameters",
    "raises",
    "exceptions",
    "warns",
    "receives",
  ].map((title) => [title, "entries"] as const),
  ...["returns", "return", "yields", "yield"].map((title) => [title, "returns"] as const),
  ...["note", "notes", "warning", "warnings", "todo"].map((title) => [title, "prose"] as const),
  ...["example", "examples", "see also", "references", "methods"].map(
    (title) => [title, "drop"] as const,
  ),
]);

/** Sphinx fields that hold a type, not prose. */
const SPHINX_TYPES = new Set(["type", "rtype", "vartype", "kwtype", "meta"]);

/** Python docstrings: Sphinx fields, Google sections and NumPy sections. */
export function pythonLines(lines: string[], identifiers: Set<string>): string[] {
  const out: string[] = [];
  let section: Section = "prose";
  let sectionStart = false;
  let fieldDropping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const next = lines[i + 1]?.trim() ?? "";
    if (/^-{3,}$/.test(line)) {
      continue;
    }
    const title = /^([A-Za-z][A-Za-z ]*):$/.exec(line)?.[1] ?? (/^-{3,}$/.test(next) ? line : "");
    const titled = SECTIONS.get(title.toLowerCase());
    if (titled) {
      out.push("");
      section = titled;
      sectionStart = true;
      fieldDropping = false;
      continue;
    }
    const field = /^:(\w+)(?:\s+([^:]+))?:\s*(.*)$/.exec(line);
    if (field) {
      out.push("");
      const [, kind, argument, description] = field;
      fieldDropping = SPHINX_TYPES.has(kind!);
      if (argument !== undefined && !fieldDropping) {
        // `:param str name:` names the last word.
        identifiers.add(argument.trim().split(/\s+/).pop()!);
      }
      if (!fieldDropping) {
        out.push(description!);
      }
      continue;
    }
    if (line === "") {
      fieldDropping = false;
    }
    if (fieldDropping || section === "drop") {
      continue;
    }
    const atStart = sectionStart;
    sectionStart = false;
    if (section === "entries") {
      // NumPy `x, y : int` names with a type; the description follows on indented lines.
      const numpy = /^(\*{0,2}\w+(?:\s*,\s*\*{0,2}\w+)*)\s+:(?:\s.*)?$/.exec(line);
      // Google `x (int): text`, or `ValueError: text` under Raises.
      const google = /^(\*{0,2}[\w.]+)\s*(?:\([^)]*\))?:\s*(.*)$/.exec(line);
      // NumPy `ValueError` alone under Raises.
      const bare = /^[A-Z][\w.]*$/.test(line) && /^\s+\S/.test(lines[i + 1] ?? "");
      if (numpy) {
        out.push("");
        for (const name of numpy[1]!.split(",")) {
          identifiers.add(name.trim().replace(/^\*+/, ""));
        }
        continue;
      }
      if (google) {
        out.push("");
        identifiers.add(google[1]!.replace(/^\*+/, ""));
        out.push(google[2]!);
        continue;
      }
      if (bare) {
        out.push("");
        identifiers.add(line);
        continue;
      }
    }
    if (section === "returns" && atStart) {
      // Google `bool: text`, or a NumPy type alone.
      const typed = /^[\w.]+(?:\[[^\]]*\])?\s*:\s+(.+)$/.exec(line);
      if (typed) {
        out.push(typed[1]!);
        continue;
      }
      if (/^[\w.]+(?:\[[^\]]*\])?$/.test(line)) {
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/** C# XML doc comments. */
export function xmldocLines(lines: string[], identifiers: Set<string>): string[] {
  const reference = (name: string): string => {
    identifiers.add(name);
    return splitIdentifier(name);
  };
  return lines
    .join("\n")
    .replace(/<(code|example)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n\n")
    .replace(/<(?:see|seealso)\s+cref="([^"]+)"\s*\/>/gi, (_, cref: string) =>
      reference(crefName(cref)),
    )
    .replace(/<see\s+langword="([^"]+)"\s*\/>/gi, "$1")
    .replace(/<see\s+href="[^"]*"\s*>([\s\S]*?)<\/see>/gi, "$1")
    .replace(/<(?:see|seealso)\s+href="[^"]*"\s*\/>/gi, "")
    .replace(/<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/>/gi, (_, name: string) =>
      reference(name),
    )
    .replace(/<c>([\s\S]*?)<\/c>/gi, "`$1`")
    .replace(/<(?:param|typeparam)\s+name="([^"]+)"\s*>/gi, (_, name: string) => {
      identifiers.add(name);
      return "\n\n";
    })
    .replace(/<exception\s+cref="([^"]+)"\s*>/gi, (_, cref: string) => {
      identifiers.add(crefName(cref));
      return "\n\n";
    })
    .replace(/<inheritdoc\b[^>]*\/>/gi, "")
    .replace(
      /<\/?(?:summary|remarks|returns|value|para|param|typeparam|exception|list|listheader|item|description|term)\b[^>]*>/gi,
      "\n\n",
    )
    .split("\n");
}

/** `T:System.ArgumentException` or `M:Foo.Bar(System.Int32)` → the type or member path. */
function crefName(cref: string): string {
  return cref
    .replace(/^[A-Z]:/, "")
    .replace(/\(.*\)$/, "")
    .replace(/\{[^}]*\}|`\d+/g, "");
}

/** Go doc comments: indented lines are code blocks, unless they are list items. */
export function godocLines(lines: string[]): string[] {
  return lines.map((line) =>
    /^(?:\t| {2,})/.test(line) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(line) ? "" : line,
  );
}
