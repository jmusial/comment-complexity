import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadZipf } from "../../metrics/zipf";
import {
  type Fit,
  type LabeledComment,
  PRIOR_WEIGHTS,
  type Sample,
  crossValidate,
  evaluate,
  fit,
  parseDataset,
  toSample,
} from "../../score/calibration";
import { DEFAULT_BANDS, DEFAULT_WEIGHTS, type Label, type Weights } from "../../score/composite";
import { results } from "./metricResults";

const comment = (overrides: Partial<LabeledComment> = {}): LabeledComment => ({
  id: 1,
  repo: "jmusial/comment-complexity",
  commit: "0000000",
  path: "src/a.ts",
  line: 1,
  languageId: "typescript",
  kind: "doc",
  text: "/** Returns the user name. */",
  label: "easy",
  ...overrides,
});

/** Comments that only differ in their negations: none, some, many. */
const byNegations: Sample[] = (["easy", "ok", "hard"] as const).flatMap((label, i) =>
  Array.from({ length: 4 }, () => ({
    results: results({ negationCount: { value: i * 1.5 } }),
    label,
  })),
);

const everyday = () => 6;

/** A sample with every metric easy. */
const same = (label: Label): Sample => ({ results: results(), label });

const round = (share: number) => Math.round(share * 1000) / 1000;

describe("parseDataset", () => {
  it("reads one comment per line, skipping blank ones", () => {
    const jsonl = `${JSON.stringify(comment())}\n\n${JSON.stringify(comment({ id: 2, label: "hard" }))}\n`;
    expect(parseDataset(jsonl).map(({ id, label }) => [id, label])).toEqual([
      [1, "easy"],
      [2, "hard"],
    ]);
  });

  it("rejects unknown labels with their line", () => {
    const jsonl = `${JSON.stringify(comment())}\n${JSON.stringify({ ...comment(), label: "meh" })}`;
    expect(() => parseDataset(jsonl)).toThrow('Line 2: unknown label "meh"');
  });
});

describe("toSample", () => {
  it("normalizes and measures the comment, keeping its label", () => {
    const sample = toSample(comment({ label: "ok" }), everyday);
    expect(sample.label).toBe("ok");
    expect(sample.results.words).toBe(4);
    expect(sample.results.short.commentLength.value).toBe(4);
  });
});

describe("evaluate", () => {
  const fitted: Fit = { weights: PRIOR_WEIGHTS, bands: { ok: 0.3, hard: 0.8 } };

  it("counts agreement, confusion and order", () => {
    const evaluation = evaluate(byNegations, fitted);
    expect(evaluation).toMatchObject({ agreement: 1, ordered: 1, easyBelowHard: 1 });
    expect(evaluation.confusion.ok).toEqual({ easy: 0, ok: 4, hard: 0 });
  });

  it("counts ties as half ordered and misses as disagreement", () => {
    expect(evaluate([same("easy"), same("hard")], fitted)).toMatchObject({
      agreement: 0.5,
      ordered: 0.5,
      easyBelowHard: 0.5,
    });
  });

  it("scores nothing without samples", () => {
    expect(evaluate([], fitted)).toMatchObject({ agreement: 0, ordered: 0, easyBelowHard: 0 });
  });
});

describe("fit", () => {
  it("weights the metric that separates the labels and places the bands between them", () => {
    const fitted = fit(byNegations);
    expect(fitted.weights.negationCount.weight).toBeGreaterThan(PRIOR_WEIGHTS.negationCount.weight);
    // Thresholds are not fitted.
    expect(fitted.weights.negationCount).toMatchObject({ easy: 0, hard: 3 });
    expect(fitted.bands.ok).toBeLessThan(fitted.bands.hard);
    expect(evaluate(byNegations, fitted).agreement).toBe(1);
  });

  it("starts from other priors, and survives all of them being zero", () => {
    const zero = Object.fromEntries(
      Object.entries(PRIOR_WEIGHTS).map(([metric, config]) => [metric, { ...config, weight: 0 }]),
    ) as Weights;
    const options = { iterations: 50, learningRate: 0.05, prior: 1 };
    const fitted = fit([same("easy"), same("hard")], options, zero);
    expect(Object.values(fitted.weights).every(({ weight }) => weight >= 0)).toBe(true);
    expect(Number.isFinite(fitted.bands.ok)).toBe(true);
  });

  it("cross-validates on held-out folds", () => {
    const options = { iterations: 500, learningRate: 0.05, prior: 0.05 };
    expect(crossValidate(byNegations, 4, options)).toBe(1);
    expect(crossValidate([], 4, options)).toBe(0);
  });
});

describe("calibration dataset", () => {
  const zipf = loadZipf("data/zipf-en.json");
  const samples = parseDataset(readFileSync("data/calibration/comments.jsonl", "utf8")).map(
    (labeled) => toSample(labeled, zipf),
  );

  it("is what weights.json was fitted on (run `pnpm calibrate` after changing either)", () => {
    expect(fit(samples)).toEqual({ weights: DEFAULT_WEIGHTS, bands: DEFAULT_BANDS });
  });

  it("ranks hard comments above easy ones at least 75% of the time", () => {
    const evaluation = evaluate(samples, { weights: DEFAULT_WEIGHTS, bands: DEFAULT_BANDS });
    expect(evaluation.easyBelowHard).toBeGreaterThanOrEqual(0.75);
    expect({
      samples: samples.length,
      easyBelowHard: round(evaluation.easyBelowHard),
      ordered: round(evaluation.ordered),
      agreement: round(evaluation.agreement),
      confusion: evaluation.confusion,
    }).toMatchSnapshot();
  });
});
