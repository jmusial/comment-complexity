/** Mixed-case words that are prose, not code. */
const WORDS = new Set([
  "iOS",
  "iPadOS",
  "macOS",
  "watchOS",
  "tvOS",
  "iPhone",
  "iPad",
  "eBay",
  "JavaScript",
  "TypeScript",
  "CoffeeScript",
  "GitHub",
  "GitLab",
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "NoSQL",
  "OAuth",
  "WebSocket",
  "WebAssembly",
  "YouTube",
  "PowerShell",
  "DevOps",
]);

/** A code-shaped token: dotted or `::` paths and a trailing `()` included. */
export const IDENTIFIER_TOKEN =
  /(?<![\w$])[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)*(?:\(\))?/g;

/**
 * Whether a prose token is code: camelCase, snake_case, `$var`, `a.b`, `a::b` or `call()`.
 * Plain and Capitalized words are prose; so are `e.g` and `i.e`.
 */
export function isIdentifier(token: string): boolean {
  if (WORDS.has(token)) {
    return false;
  }
  if (token.endsWith("()") || token.includes("::")) {
    return true;
  }
  if (token.includes(".")) {
    return token.split(".").every((part) => part.length > 1);
  }
  return /[a-z0-9][A-Z]|[A-Z]{2,}[a-z]{2}|[A-Za-z0-9]_[A-Za-z0-9]|^_|\$/.test(token);
}

/** `getUserName` → `get user name`, `HTTPServer` → `http server`, `a::b_c()` → `a b c`. */
export function splitIdentifier(identifier: string): string {
  return identifier
    .replace(/\(\)$/, "")
    .split(/[.:_$]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase())
    .join(" ");
}
