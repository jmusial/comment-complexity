import { describe, expect, it } from "vitest";
import type { Comment } from "../../extract/comments";
import type { ScoredComment } from "../../score/analyzer";
import { type Contribution, type MetricName, composite } from "../../score/composite";
import { METRICS, diagnosticMessage, hoverMarkdown, lensTitle } from "../../ui/present";
import { PRIOR_WEIGHTS } from "../../score/calibration";
import { results } from "./metricResults";

const COMMENT: Comment = {
  range: { start: { row: 0, column: 0 }, end: { row: 0, column: 20 } },
  kind: "line",
  rawText: "// text",
  targetSymbolName: undefined,
  approx: false,
};

function scored(
  overrides: Parameters<typeof results>[0] = {},
  { words = 10, approx = false, redundant = false } = {},
): ScoredComment {
  return {
    comment: { ...COMMENT, approx },
    text: "text",
    words,
    score: composite(results(overrides, words), PRIOR_WEIGHTS, { ok: 3, hard: 6 }),
    redundancy: redundant
      ? { redundant: true, overlap: 1, reason: 'Restates the name "getUser"' }
      : { redundant: false, overlap: 0 },
  };
}

const contribution = (metric: MetricName, value: number, reason?: string): Contribution => ({
  metric,
  value,
  difficulty: 1,
  points: 1,
  ...(reason === undefined ? {} : { reason }),
});

describe("lensTitle", () => {
  it("shows the score and its two biggest contributors", () => {
    expect(
      lensTitle(
        scored({
          nounStack: { value: 5, reason: 'Noun stack: "a b c d e"' },
          minZipf: { value: 2, reason: 'Rare word: "selectable"' },
          negationCount: { value: 1 },
        }),
      ),
    ).toBe("complexity 3.0 · rare: selectable · stack 5");
  });

  it("prefers contributors with a reason of their own", () => {
    expect(
      lensTitle(
        scored({
          clauseCount: { value: 5 },
          nounStack: { value: 4 },
          negationCount: { value: 1, reason: "1 negation" },
        }),
      ),
    ).toBe("complexity 2.1 · 1 negation · 5 clauses");
  });

  it("shows only the score when nothing adds points", () => {
    expect(lensTitle(scored())).toBe("complexity 0.0");
  });

  it("tags redundant comments and fallback languages", () => {
    expect(lensTitle(scored({}, { approx: true, redundant: true }))).toBe(
      "complexity 0.0 · restates name · approx",
    );
  });
});

describe("METRICS brief", () => {
  it.each<[Contribution, string]>([
    [contribution("nounStack", 4), "stack 4"],
    [contribution("clauseCount", 5), "5 clauses"],
    [contribution("meanZipf", 3.9), "uncommon words"],
    [contribution("minZipf", 2, 'Rare word: "selectable"'), "rare: selectable"],
    [contribution("minZipf", 3.5), "rare words"],
    [contribution("lexicalDensity", 0.82), "dense 82%"],
    [contribution("negationCount", 2), "2 negations"],
    [contribution("negationCount", 1), "1 negation"],
    [contribution("clauseCount", 1), "1 clause"],
    [contribution("danglingReference", 1, '"It" has no antecedent'), "unclear “It”"],
    [contribution("danglingReference", 1), "unclear reference"],
    [contribution("undefinedAcronyms", 2, "Undefined acronyms: SQS, DLQ"), "acronyms: SQS, DLQ"],
    [contribution("undefinedAcronyms", 1, "Undefined acronym: SQS"), "acronyms: SQS"],
    [contribution("undefinedAcronyms", 1), "acronyms"],
    [contribution("commentLength", 70), "70 words"],
    [contribution("fleschKincaidGrade", 14.2), "grade 14.2"],
    [contribution("gunningFog", 15), "fog 15"],
    [contribution("colemanLiau", 13), "Coleman-Liau 13"],
    [contribution("averageSentenceLength", 28), "28 words/sentence"],
  ])("%o → %s", (input, expected) => {
    expect(METRICS[input.metric].brief(input)).toBe(expected);
  });
});

describe("hoverMarkdown", () => {
  it("lists the score, the reasons and every metric with what it measures", () => {
    const markdown = hoverMarkdown(
      scored({ negationCount: { value: 3, reason: "3 negations | 2 nots" } }, { words: 40 }),
    );
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("**Comment complexity 0.7 / 10** · easy");
    expect(lines).toContain("- 3 negations \\| 2 nots");
    const rows = lines.filter((line) => /^\| [A-Z]/.test(line) && !line.startsWith("| Metric"));
    expect(rows).toHaveLength(Object.keys(PRIOR_WEIGHTS).length);
    expect(rows).toContain(`| Negations | 3 | 0.7 | ${METRICS.negationCount.why} |`);
    expect(markdown).not.toContain("_");
  });

  it("goes straight to the table when there is nothing to point out", () => {
    const lines = hoverMarkdown(scored({}, { words: 40 })).split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "**Comment complexity 0.0 / 10** · easy",
      "",
      "| Metric | Value | Points | Why |",
    ]);
  });

  it("marks tiny contributions, short comments, restated names and approximate ones", () => {
    const markdown = hoverMarkdown(
      scored({ lexicalDensity: { value: 0.505 } }, { words: 5, approx: true, redundant: true }),
    );
    expect(markdown).toContain("| Density | 0.505 | <0.1 |");
    expect(markdown).toContain(
      '- Restates the name "getUser": tells the reader nothing new (not in the score)',
    );
    expect(markdown).toContain("_Readability formulas skipped: 5 words is too short for them._");
    expect(markdown).toContain("_Approximate: no grammar for this language");
  });
});

describe("diagnosticMessage", () => {
  it("gives the score, its label and the reasons", () => {
    expect(
      diagnosticMessage(
        scored({
          undefinedAcronyms: { value: 2, reason: "Undefined acronyms: SQS, DLQ" },
          negationCount: { value: 3, reason: "3 negations" },
        }),
      ),
    ).toBe("Comment complexity 2.6 (easy): Undefined acronyms: SQS, DLQ; 3 negations");
    expect(diagnosticMessage(scored())).toBe("Comment complexity 0.0 (easy)");
  });
});
