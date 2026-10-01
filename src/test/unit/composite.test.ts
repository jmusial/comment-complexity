import { describe, expect, it } from "vitest";
import type { MetricContext } from "../../metrics/short";
import { loadZipf } from "../../metrics/zipf";
import { PRIOR_WEIGHTS } from "../../score/calibration";
import {
  type Bands,
  DEFAULT_WEIGHTS,
  type MetricResults,
  TOP_REASONS,
  type Weights,
  composite,
  difficulty,
  labelFor,
  scoreComment,
} from "../../score/composite";
import { results } from "./metricResults";

/** Fixed weights, so the arithmetic below does not change when calibration refits the defaults. */
const WEIGHTS = PRIOR_WEIGHTS;
const BANDS: Bands = { ok: 3, hard: 6 };
const score = (measured: MetricResults, weights: Weights = WEIGHTS) =>
  composite(measured, weights, BANDS);

/** Every metric at its hard threshold. */
const allHard = (words: number) =>
  results(
    Object.fromEntries(
      Object.entries(WEIGHTS).map(([metric, { hard }]) => [metric, { value: hard }]),
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
    expect(score(results())).toMatchObject({ score: 0, reasons: [] });
  });

  it("scores 10 when every metric is hard, short or long", () => {
    expect(score(allHard(10)).score).toBe(10);
    expect(score(allHard(60)).score).toBe(10);
  });

  it("blends the readability formulas in by length", () => {
    // Below 20 words the formulas are noise.
    expect(score(hardReadability(15))).toMatchObject({ score: 0, reasons: [] });
    // Half weight at 30 words: 4 × 0.5 of 9.5 + 4 × 0.5.
    expect(score(hardReadability(30)).score).toBeCloseTo(1.7);
    // Full weight from 40: 4 of 13.5.
    expect(score(hardReadability(40))).toMatchObject({
      score: 3,
      reasons: ["Flesch-Kincaid grade 16"],
    });
  });

  it("gives the reasons of the biggest contributors, at most three", () => {
    const scored = score(
      results({
        undefinedAcronyms: { value: 2, reason: "Undefined acronyms: SQS, DLQ" },
        nounStack: { value: 3, reason: 'Noun stack: "retry queue item"' },
        negationCount: { value: 3, reason: "3 negations" },
        minZipf: { value: 3, reason: 'Rare word: "idempotent"' },
        // Contributes, but has no reason to give.
        clauseCount: { value: 5 },
      }),
    );
    expect(scored.reasons).toHaveLength(TOP_REASONS);
    expect(scored.reasons).toEqual([
      "Undefined acronyms: SQS, DLQ",
      "3 negations",
      'Rare word: "idempotent"',
    ]);
    const total = scored.contributions.reduce((sum, { points }) => sum + points, 0);
    expect(scored.score).toBeCloseTo(total, 1);
  });

  it("names uncommon vocabulary, which has no reason of its own", () => {
    const scored = score(results({ meanZipf: { value: 3.5 } }));
    expect(scored.reasons).toEqual(["Uncommon vocabulary"]);
    expect(scored.contributions.find(({ metric }) => metric === "meanZipf")).toMatchObject({
      difficulty: 1,
      points: 10 / 9.5,
    });
  });

  it("leaves out reasons of metrics that add nothing", () => {
    // A metric may give a reason below the composite's easy threshold.
    const scored = score(results({ lexicalDensity: { value: 0.4, reason: "Dense" } }));
    expect(scored.reasons).toEqual([]);
  });

  it("takes other weights", () => {
    const weights: Weights = Object.fromEntries(
      Object.entries(WEIGHTS).map(([metric, config]) => [
        metric,
        { ...config, weight: metric === "negationCount" ? 1 : 0 },
      ]),
    ) as Weights;
    expect(score(results({ negationCount: { value: 3 } }), weights).score).toBe(10);
    expect(score(results({ nounStack: { value: 5 } }), weights).score).toBe(0);
  });

  it("labels the score by its band, before rounding", () => {
    expect(score(results()).label).toBe("easy");
    expect(score(allHard(10)).label).toBe("hard");
    expect(labelFor(2.99, BANDS)).toBe("easy");
    expect(labelFor(3, BANDS)).toBe("ok");
    expect(labelFor(5.99, BANDS)).toBe("ok");
    expect(labelFor(6, BANDS)).toBe("hard");
  });

  it("scores 0 when nothing has weight", () => {
    const weights = Object.fromEntries(
      Object.entries(WEIGHTS).map(([metric, config]) => [metric, { ...config, weight: 0 }]),
    ) as Weights;
    expect(score(allHard(60), weights).score).toBe(0);
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
    expect(plain).toMatchObject({ label: "easy" });
    expect(dense.score).toBeGreaterThan(plain.score + 2);
    expect(dense.reasons).toHaveLength(TOP_REASONS);
    expect(dense.contributions.map(({ metric }) => metric)).toEqual(Object.keys(DEFAULT_WEIGHTS));
  });

  it("counts readability for long comments", () => {
    const sentence =
      "Notwithstanding considerable organizational complexity, the reconciliation subsystem " +
      "asynchronously revalidates intermediate authorization certificates whenever administrative " +
      "configuration modifications necessitate comprehensive recomputation of dependent " +
      "infrastructure.";
    const long = scoreComment(`${sentence} ${sentence}`, context);
    const readability = long.contributions.filter(({ metric }) =>
      ["fleschKincaidGrade", "gunningFog", "colemanLiau", "averageSentenceLength"].includes(metric),
    );
    expect(readability.every(({ points }) => points > 0)).toBe(true);
    expect(long.label).toBe("hard");
  });
});
