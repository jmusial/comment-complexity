import { describe, expect, it } from "vitest";
import {
  type Metric,
  type MetricContext,
  type MetricResult,
  clauseCount,
  danglingReference,
  lexicalDensity,
  meanZipf,
  minZipf,
  negationCount,
  nounStack,
  undefinedAcronyms,
} from "../../metrics/short";
import type { PartOfSpeech, Token } from "../../metrics/tokens";

/** "Returns/VERB the/DET user/NOUN" → tokens, so tables do not depend on the tagger. */
function tag(tagged: string): Token[] {
  return tagged
    .split(" ")
    .filter((part) => part !== "")
    .map((part) => {
      const slash = part.lastIndexOf("/");
      const text = part.slice(0, slash);
      return { text, normal: text.toLowerCase(), pos: part.slice(slash + 1) as PartOfSpeech };
    });
}

const ZIPF = new Map([
  ["the", 7.73],
  ["an", 6.8],
  ["times", 5.9],
  ["user", 5.5],
  ["returns", 5],
  ["retry", 4.2],
  ["cache", 3.63],
]);

function context(overrides: Partial<MetricContext> = {}): MetricContext {
  return {
    identifiers: new Set(),
    vocabulary: new Set(),
    zipf: (word) => ZIPF.get(word),
    ...overrides,
  };
}

type Row = [tagged: string, expected: MetricResult, context?: MetricContext];

function table(metric: Metric, rows: Row[]) {
  it.each(rows)("%s", (tagged, expected, ctx = context()) => {
    expect(metric(tag(tagged), ctx)).toEqual(expected);
  });
}

describe("nounStack", () => {
  table(nounStack, [
    ["Returns/VERB the/DET user/NOUN ./PUNCT", { value: 1 }],
    [
      "Flushes/VERB the/DET user/NOUN session/NOUN cache/NOUN key/NOUN ./PUNCT",
      { value: 4, reason: 'Noun stack: "user session cache key"' },
    ],
    ["Fast/ADJ retry/NOUN policy/NOUN", { value: 3, reason: 'Noun stack: "Fast retry policy"' }],
    ["", { value: 0 }],
  ]);
});

describe("clauseCount", () => {
  table(clauseCount, [
    ["Cache/NOUN key/NOUN for/ADP user/NOUN sessions/NOUN", { value: 0 }],
    ["Returns/VERB the/DET user/NOUN ./PUNCT", { value: 1 }],
    ["Returns/VERB the/DET user/NOUN if/SCONJ it/PRON exists/VERB", { value: 2 }],
    ["The/DET job/NOUN will/AUX not/PART be/AUX retried/VERB", { value: 1 }],
    ["Keep/VERB that/DET value/NOUN", { value: 1 }],
    [
      "Retries/VERB when/SCONJ the/DET request/NOUN fails/VERB ,/PUNCT unless/SCONJ the/DET caller/NOUN cancels/VERB",
      { value: 3, reason: "3 clauses in one comment" },
    ],
  ]);
});

describe("meanZipf", () => {
  table(meanZipf, [
    ["Returns/VERB the/DET user/NOUN", { value: 6.08 }],
    // The workspace uses "idempotent", so only "cache" is rated.
    [
      "Idempotent/ADJ cache/NOUN",
      { value: 3.63 },
      context({ vocabulary: new Set(["idempotent"]) }),
    ],
    ["./PUNCT", { value: 7 }],
  ]);
});

describe("minZipf", () => {
  table(minZipf, [
    ["Returns/VERB the/DET user/NOUN", { value: 5 }],
    // Unlisted words count as rarer than anything in the table.
    ["An/DET idempotent/ADJ retry/NOUN", { value: 2, reason: 'Rare word: "idempotent"' }],
    [
      "An/DET idempotent/ADJ retry/NOUN",
      { value: 6.8 },
      context({ identifiers: new Set(["idempotentRetry"]) }),
    ],
    ["Retry/VERB 3/NUM times/NOUN ./PUNCT", { value: 4.2 }],
  ]);
});

describe("lexicalDensity", () => {
  table(lexicalDensity, [
    ["Returns/VERB the/DET user/NOUN ./PUNCT", { value: 0.67 }],
    [
      "Flush/VERB stale/ADJ session/NOUN cache/NOUN entries/NOUN",
      { value: 1, reason: "Dense: 100% content words" },
    ],
    ["./PUNCT", { value: 0 }],
  ]);
});

describe("negationCount", () => {
  table(negationCount, [
    ["Retry/VERB once/ADV", { value: 0 }],
    ["Do/AUX n't/PART retry/VERB", { value: 1 }],
    [
      "Never/ADV retry/VERB unless/SCONJ not/PART idempotent/ADJ",
      { value: 2, reason: "2 negations" },
    ],
  ]);
});

describe("danglingReference", () => {
  table(danglingReference, [
    ["It/PRON retries/VERB twice/ADV", { value: 1, reason: '"It" has no antecedent' }],
    ["This/PRON is/AUX slow/ADJ", { value: 1, reason: '"This" has no antecedent' }],
    // Taggers also label a standalone "this" DET; it still points at nothing.
    ["This/DET is/AUX slow/ADJ", { value: 1, reason: '"This" has no antecedent' }],
    ["This/DET method/NOUN is/AUX slow/ADJ", { value: 0 }],
    ["Returns/VERB the/DET user/NOUN if/SCONJ it/PRON exists/VERB", { value: 0 }],
  ]);
});

describe("undefinedAcronyms", () => {
  table(undefinedAcronyms, [
    [
      "Caches/VERB the/DET JSON/PROPN for/ADP one/NUM TTL/PROPN",
      { value: 1, reason: "Undefined acronym: TTL" },
    ],
    // The code defines it.
    [
      "Caches/VERB the/DET JSON/PROPN for/ADP one/NUM TTL/PROPN",
      { value: 0 },
      context({ identifiers: new Set(["TTL_MS"]) }),
    ],
    // Defined in place.
    ["Uses/VERB a/DET time/NOUN to/PART live/VERB (/PUNCT TTL/PROPN )/PUNCT", { value: 0 }],
    ["Sends/VERB IDs/NOUN over/ADP HTTP/PROPN", { value: 0 }],
    [
      "Retries/VERB MQ/PROPN and/CCONJ SQS/PROPN calls/NOUN",
      { value: 2, reason: "Undefined acronyms: MQ, SQS" },
    ],
    // Parentheses alone do not define it; the words must spell it out.
    [
      "Retries/VERB SQS/PROPN (/PUNCT see/VERB docs/NOUN )/PUNCT",
      { value: 1, reason: "Undefined acronym: SQS" },
    ],
    [
      "See/VERB the/DET docs/NOUN (/PUNCT SQS/PROPN )/PUNCT",
      { value: 1, reason: "Undefined acronym: SQS" },
    ],
    ["Uses/VERB SQS/PROPN (/PUNCT Simple/PROPN Queue/PROPN Service/PROPN )/PUNCT", { value: 0 }],
    // Minor words may be skipped or counted.
    [
      "Uses/VERB the/DET Bureau/PROPN of/ADP Labor/PROPN Statistics/PROPN (/PUNCT BLS/PROPN )/PUNCT",
      { value: 0 },
    ],
  ]);
});
