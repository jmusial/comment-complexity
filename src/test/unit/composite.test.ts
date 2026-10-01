import { describe, expect, it } from "vitest";
import type { MetricContext, MetricResult } from "../../metrics/short";
import { loadZipf } from "../../metrics/zipf";
import {
  DEFAULT_WEIGHTS,
  type MetricResults,
  TOP_REASONS,
  type Weights,
  composite,
  difficulty,
  scoreComment,
} from "../../score/composite";

/** Results at each metric's easy threshold, so every difficulty is 0, with overrides. */
function results(
  overrides: Partial<Record<keyof Weights, MetricResult>> = {},
  words = 10,
): MetricResults {
  const at = (metric: keyof Weights): MetricResult =>
    overrides[metric] ?? { value: DEFAULT_WEIGHTS[metric].easy };
  return {
    short: {
      nounStack: at("nounStack"),
      clauseCount: at("clauseCount"),
      meanZipf: at("meanZipf"),
      minZipf: at("minZipf"),
      lexicalDensity: at("lexicalDensity"),
      negationCount: at("negationCount"),
      danglingReference: at("danglingReference"),
      undefinedAcronyms: at("undefinedAcronyms"),
    },
    readability: {
      fleschKincaidGrade: at("fleschKincaidGrade"),
      gunningFog: at("gunningFog"),
      colemanLiau: at("colemanLiau"),
      averageSentenceLength: at("averageSentenceLength"),
    },
    words,
  };
}

/** Every metric at its hard threshold. */
const allHard = (words: number) =>
  results(
    Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([metric, { hard }]) => [metric, { value: hard }]),
    ),
    words,
  );

/** Every readability formula at its hard threshold; the short metrics easy. */
const hardReadability = (words: number) =>
  results(
    {
      fleschKincaidGrade: { value: 16, reason: "Flesch-Kincaid grade 16" },
      gunningFog: { value: 16 },
      colemanLiau: { value: 16 },
      averageSentenceLength: { value: 30 },
    },
    words,
  );

describe("difficulty", () => {
  it.each([
    [2, 0],
    [3.5, 0.5],
    [5, 1],
    [0, 0],
    [9, 1],
  ])("ramps %d between easy 2 and hard 5 to %d", (value, expected) => {
    expect(difficulty(value, { weight: 1, easy: 2, hard: 5 })).toBeCloseTo(expected);
  });

  it("ramps the other way when lower is harder", () => {
    const zipf = { weight: 1, easy: 4, hard: 2 };
    expect(difficulty(5, zipf)).toBe(0);
    expect(difficulty(3, zipf)).toBeCloseTo(0.5);
    expect(difficulty(1, zipf)).toBe(1);
  });
});

describe("composite", () => {
  it("scores 0 with no reasons when every metric is easy", () => {
    expect(composite(results())).toMatchObject({ score: 0, reasons: [] });
  });

  it("scores 10 when every metric is hard, short or long", () => {
    expect(composite(allHard(10)).score).toBe(10);
    expect(composite(allHard(60)).score).toBe(10);
  });

  it("blends the readability formulas in by length", () => {
    // Below 20 words the formulas are noise.
    expect(composite(hardReadability(15))).toMatchObject({ score: 0, reasons: [] });
    // Half weight at 30 words: 4 × 0.5 of 8.5 + 4 × 0.5.
    expect(composite(hardReadability(30)).score).toBeCloseTo(1.9);
    // Full weight from 40: 4 of 12.5.
    expect(composite(hardReadability(40))).toMatchObject({
      score: 3.2,
      reasons: ["Flesch-Kincaid grade 16"],
    });
  });

  it("gives the reasons of the biggest contributors, at most three", () => {
    const score = composite(
      results({
        undefinedAcronyms: { value: 2, reason: "Undefined acronyms: SQS, DLQ" },
        nounStack: { value: 3, reason: 'Noun stack: "retry queue item"' },
        negationCount: { value: 3, reason: "3 negations" },
        minZipf: { value: 3, reason: 'Rare word: "idempotent"' },
        // Contributes, but has no reason to give.
        clauseCount: { value: 5 },
      }),
    );
    expect(score.reasons).toHaveLength(TOP_REASONS);
    expect(score.reasons).toEqual([
      "Undefined acronyms: SQS, DLQ",
      "3 negations",
      'Rare word: "idempotent"',
    ]);
    const total = score.contributions.reduce((sum, { points }) => sum + points, 0);
    expect(score.score).toBeCloseTo(total, 1);
  });

  it("names uncommon vocabulary, which has no reason of its own", () => {
    const score = composite(results({ meanZipf: { value: 3.5 } }));
    expect(score.reasons).toEqual(["Uncommon vocabulary"]);
    expect(score.contributions.find(({ metric }) => metric === "meanZipf")).toMatchObject({
      difficulty: 1,
      points: 10 / 8.5,
    });
  });

  it("leaves out reasons of metrics that add nothing", () => {
    // A metric may give a reason below the composite's easy threshold.
    const score = composite(results({ lexicalDensity: { value: 0.4, reason: "Dense" } }));
    expect(score.reasons).toEqual([]);
  });

  it("takes other weights", () => {
    const weights: Weights = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([metric, config]) => [
        metric,
        { ...config, weight: metric === "negationCount" ? 1 : 0 },
      ]),
    ) as Weights;
    expect(composite(results({ negationCount: { value: 3 } }), weights).score).toBe(10);
    expect(composite(results({ nounStack: { value: 5 } }), weights).score).toBe(0);
  });

  it("scores 0 when nothing has weight", () => {
    const weights = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([metric, config]) => [metric, { ...config, weight: 0 }]),
    ) as Weights;
    expect(composite(allHard(60), weights).score).toBe(0);
  });
});

describe("scoreComment", () => {
  const context: MetricContext = {
    identifiers: new Set(),
    vocabulary: new Set(),
    zipf: loadZipf("data/zipf-en.json"),
  };

  it("scores plain comments low and dense ones high", () => {
    const plain = scoreComment("Returns the user name.", context);
    const dense = scoreComment(
      "Idempotent DLQ reconciliation shard lease heartbeat isn't never not renewed unless it wasn't.",
      context,
    );
    expect(plain.score).toBeLessThan(1);
    expect(dense.score).toBeGreaterThan(3);
    expect(dense.reasons).toHaveLength(TOP_REASONS);
    expect(dense.contributions.map(({ metric }) => metric)).toEqual(Object.keys(DEFAULT_WEIGHTS));
  });

  it("counts readability for long comments", () => {
    const sentence =
      "Notwithstanding considerable organizational complexity, the reconciliation subsystem " +
      "asynchronously revalidates intermediate authorization certificates whenever administrative " +
      "configuration modifications necessitate comprehensive recomputation of dependent " +
      "infrastructure.";
    const score = scoreComment(`${sentence} ${sentence}`, context);
    const readability = score.contributions.filter(({ metric }) =>
      ["fleschKincaidGrade", "gunningFog", "colemanLiau", "averageSentenceLength"].includes(metric),
    );
    expect(readability.every(({ points }) => points > 0)).toBe(true);
    expect(score.score).toBeGreaterThan(5);
  });
});
