import type { PartOfSpeech, Token } from "./tokens";
import type { ZipfLookup } from "./zipf";

/**
 * Metrics that stay meaningful on 3–20-word comments, where readability formulas are noise.
 * Each is a pure function of the tagged tokens and the context; `reason` is set when the value is
 * worth telling the reader about.
 */

export interface MetricContext {
  /** Identifiers the comment and its code mention, as written (see `normalize`). */
  readonly identifiers: ReadonlySet<string>;
  /** Lower-cased words of the workspace vocabulary; known to the reader, so never rare. */
  readonly vocabulary: ReadonlySet<string>;
  readonly zipf: ZipfLookup;
}

export interface MetricResult {
  readonly value: number;
  readonly reason?: string;
}

export type Metric = (tokens: readonly Token[], context: MetricContext) => MetricResult;

const WORD_TAGS = new Set<PartOfSpeech>([
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "SCONJ",
  "VERB",
]);

const isWord = (token: Token): boolean => WORD_TAGS.has(token.pos);

/** Longest run of NOUN/ADJ/PROPN, like "user session cache key". Hard to parse past three. */
export const nounStack: Metric = (tokens) => {
  let best: readonly Token[] = [];
  let run: Token[] = [];
  for (const token of tokens) {
    if (token.pos === "NOUN" || token.pos === "ADJ" || token.pos === "PROPN") {
      run.push(token);
      if (run.length > best.length) {
        best = [...run];
      }
    } else {
      run = [];
    }
  }
  return best.length >= 3
    ? { value: best.length, reason: `Noun stack: "${best.map((t) => t.text).join(" ")}"` }
    : { value: best.length };
};

const SUBORDINATORS = new Set([
  "which",
  "that",
  "if",
  "unless",
  "when",
  "whenever",
  "because",
  "although",
  "though",
  "whereas",
  "whether",
  "while",
  "until",
]);

/**
 * Clauses: verb groups ("will not be retried" is one), or subordinators plus the main clause if the
 * tagger missed a verb. `that` and `which` as determiners ("that value") are not subordinators.
 */
export const clauseCount: Metric = (tokens) => {
  let verbGroups = 0;
  let inGroup = false;
  let subordinators = 0;
  for (const token of tokens) {
    if (token.pos === "VERB" || token.pos === "AUX") {
      if (!inGroup) {
        verbGroups++;
      }
      inGroup = true;
    } else if (token.pos !== "PART" && token.pos !== "ADV") {
      inGroup = false;
    }
    if (SUBORDINATORS.has(token.normal) && token.pos !== "DET") {
      subordinators++;
    }
  }
  const value = Math.max(verbGroups, verbGroups > 0 ? subordinators + 1 : subordinators);
  return value >= 3 ? { value, reason: `${value} clauses in one comment` } : { value };
};

/** Zipf given to words missing from the table: rarer than its last entry (about 2.5). */
export const UNLISTED_ZIPF = 2;

/** Zipf reported when there is nothing to rate: an everyday word. */
const COMMON_ZIPF = 7;

/** Lower-cased words of the identifiers: `TTL_MS` and `maxRetries` give ttl, ms, max, retries. */
function identifierWords(context: MetricContext): Set<string> {
  return new Set(
    [...context.identifiers].flatMap((identifier) =>
      identifier
        .split(/[^A-Za-z]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
        .filter((word) => word !== "")
        .map((word) => word.toLowerCase()),
    ),
  );
}

/** Words to rate: letters only, not the reader's own vocabulary or the code's identifiers. */
function ratedWords(tokens: readonly Token[], context: MetricContext): Token[] {
  const fromIdentifiers = identifierWords(context);
  return tokens.filter(
    (token) =>
      isWord(token) &&
      /^[a-z]+$/.test(token.normal) &&
      !context.vocabulary.has(token.normal) &&
      !fromIdentifiers.has(token.normal),
  );
}

const zipfOf = (token: Token, context: MetricContext): number =>
  context.zipf(token.normal) ?? UNLISTED_ZIPF;

/** Mean Zipf frequency of the rated words; lower means rarer vocabulary overall. */
export const meanZipf: Metric = (tokens, context) => {
  const words = ratedWords(tokens, context);
  if (words.length === 0) {
    return { value: COMMON_ZIPF };
  }
  const total = words.reduce((sum, token) => sum + zipfOf(token, context), 0);
  return { value: Math.round((total / words.length) * 100) / 100 };
};

/** Zipf frequency of the rarest rated word; below 3 is rarer than once per million words. */
export const minZipf: Metric = (tokens, context) => {
  let rarest: Token | undefined;
  let value = COMMON_ZIPF;
  for (const token of ratedWords(tokens, context)) {
    const zipf = zipfOf(token, context);
    if (zipf < value) {
      value = zipf;
      rarest = token;
    }
  }
  return rarest !== undefined && value < 3
    ? { value, reason: `Rare word: "${rarest.text}"` }
    : { value };
};

const CONTENT_TAGS = new Set<PartOfSpeech>(["NOUN", "PROPN", "VERB", "ADJ", "ADV"]);

/** Share of content words among all words; telegraphic comments run high. */
export const lexicalDensity: Metric = (tokens) => {
  const words = tokens.filter(isWord);
  if (words.length === 0) {
    return { value: 0 };
  }
  const value =
    Math.round((words.filter((token) => CONTENT_TAGS.has(token.pos)).length / words.length) * 100) /
    100;
  return value >= 0.75
    ? { value, reason: `Dense: ${Math.round(value * 100)}% content words` }
    : { value };
};

const NEGATIONS = new Set([
  "not",
  "n't",
  "no",
  "never",
  "none",
  "nothing",
  "nobody",
  "nowhere",
  "neither",
  "nor",
  "cannot",
  "without",
]);

/** Negations; each one more makes a sentence harder to follow ("not unless it isn't…"). */
export const negationCount: Metric = (tokens) => {
  const value = tokens.filter((token) => NEGATIONS.has(token.normal)).length;
  return value >= 2 ? { value, reason: `${value} negations` } : { value };
};

const REFERENCES = new Set(["it", "its", "this", "that", "these", "those", "they", "them"]);
const NOMINAL = new Set<PartOfSpeech>(["NOUN", "PROPN", "ADJ", "NUM"]);

/**
 * Pronouns that point at nothing earlier in the comment: "It retries…", "This is slow".
 * "This method" is not one: a determiner followed by its noun names its own referent.
 */
export const danglingReference: Metric = (tokens) => {
  const dangling: Token[] = [];
  let antecedent = false;
  for (const [i, token] of tokens.entries()) {
    if (token.pos === "NOUN" || token.pos === "PROPN") {
      antecedent = true;
      continue;
    }
    const next = tokens[i + 1];
    const standalone =
      token.pos === "PRON" ||
      (token.pos === "DET" && (next === undefined || !NOMINAL.has(next.pos)));
    if (!antecedent && standalone && REFERENCES.has(token.normal)) {
      dangling.push(token);
    }
  }
  return dangling.length > 0
    ? { value: dangling.length, reason: `"${dangling[0]!.text}" has no antecedent` }
    : { value: 0 };
};

/** Acronyms any developer knows. */
export const KNOWN_ACRONYMS: ReadonlySet<string> = new Set([
  "API",
  "ASCII",
  "AST",
  "AWS",
  "CI",
  "CLI",
  "CPU",
  "CRUD",
  "CSS",
  "CSV",
  "DB",
  "DNS",
  "DOM",
  "FIXME",
  "GB",
  "GPU",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IO",
  "IP",
  "JSON",
  "JWT",
  "KB",
  "MB",
  "NOTE",
  "OK",
  "OS",
  "PDF",
  "PR",
  "RAM",
  "REST",
  "SDK",
  "SQL",
  "SSH",
  "SSL",
  "TCP",
  "TLS",
  "TODO",
  "UDP",
  "UI",
  "URI",
  "URL",
  "USB",
  "UTC",
  "UTF",
  "UUID",
  "UX",
  "XML",
  "XXX",
  "YAML",
]);

/** Words an expansion may skip, like the "of" in "Bureau of Labor Statistics" (BLS). */
const MINOR_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to"]);

const isPlainWord = (token: Token): boolean => /^[A-Za-z][A-Za-z'-]*$/.test(token.text);

const initials = (words: readonly Token[]): string =>
  words.map((word) => word.text[0]!.toUpperCase()).join("");

/** Whether the words' initials spell the acronym, with or without minor words. */
function expands(words: readonly Token[], acronym: string): boolean {
  return (
    initials(words) === acronym ||
    initials(words.filter((word) => !MINOR_WORDS.has(word.normal))) === acronym
  );
}

/**
 * Whether the acronym at `index` comes with its expansion: "TTL (time to live)" or
 * "time to live (TTL)". A parenthetical that does not spell it out ("SQS (see docs)") is no definition.
 */
function definedInPlace(tokens: readonly Token[], index: number, acronym: string): boolean {
  if (tokens[index + 1]?.text === "(") {
    const close = tokens.findIndex((token, i) => i > index + 1 && token.text === ")");
    const inside = tokens.slice(index + 2, close === -1 ? undefined : close);
    if (inside.every(isPlainWord) && expands(inside, acronym)) {
      return true;
    }
  }
  if (tokens[index - 1]?.text === "(") {
    const before: Token[] = [];
    for (let i = index - 2; i >= 0 && isPlainWord(tokens[i]!); i--) {
      before.unshift(tokens[i]!);
    }
    // The expansion ends right before "(", so try each run of preceding words that could spell it.
    for (let length = acronym.length; length <= before.length; length++) {
      if (expands(before.slice(-length), acronym)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * All-caps words the reader may not know: not in `KNOWN_ACRONYMS`, not in the code's identifiers
 * or the workspace vocabulary, and not defined in place ("time to live (TTL)" or "TTL (time to live)").
 */
export const undefinedAcronyms: Metric = (tokens, context) => {
  const known = new Set(
    [...identifierWords(context), ...context.vocabulary].map((word) => word.toUpperCase()),
  );
  const undefinedOnes = new Set<string>();
  for (const [i, token] of tokens.entries()) {
    const acronym = /^([A-Z]{2,})s?$/.exec(token.text)?.[1];
    if (acronym === undefined || KNOWN_ACRONYMS.has(acronym) || known.has(acronym)) {
      continue;
    }
    if (!definedInPlace(tokens, i, acronym)) {
      undefinedOnes.add(acronym);
    }
  }
  const value = undefinedOnes.size;
  return value > 0
    ? {
        value,
        reason: `Undefined acronym${value > 1 ? "s" : ""}: ${[...undefinedOnes].join(", ")}`,
      }
    : { value };
};

/** Words from which a comment is long enough to say so. */
const LONG_COMMENT = 60;

/** Words in the comment; every extra one is more to read, whatever the sentences look like. */
export const commentLength: Metric = (tokens) => {
  const value = tokens.filter(isWord).length;
  return value >= LONG_COMMENT ? { value, reason: `Long comment: ${value} words` } : { value };
};

/** Every short-comment metric by name. */
export const SHORT_METRICS = {
  nounStack,
  clauseCount,
  meanZipf,
  minZipf,
  lexicalDensity,
  negationCount,
  danglingReference,
  undefinedAcronyms,
  commentLength,
} as const satisfies Record<string, Metric>;
