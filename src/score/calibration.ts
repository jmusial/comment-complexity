import { readabilityWeight } from "../metrics/readability";
import type { ZipfLookup } from "../metrics/zipf";
import { dialectFor, normalize } from "../normalize/clean";
import type { CommentKind } from "../extract/comments";
import {
  type Bands,
  LABELS,
  type Label,
  type MetricName,
  type MetricResults,
  type Weights,
  composite,
  difficulty,
  isShort,
  measure,
} from "./composite";

/**
 * Fits the composite weights to labeled comments with an ordinal logistic model: the chance a
 * comment is harder than easy is σ(k·(score − bands.ok)), harder than ok σ(k·(score − bands.hard)).
 * The score is the composite itself, so the fitted weights and bands are used as they were fitted.
 * Weights stay non-negative and are pulled towards the hand-picked priors, which keeps a metric the
 * small dataset says little about from swinging to an extreme.
 */

/** Hand-picked starting point; also fixes each metric's easy and hard thresholds. */
export const PRIOR_WEIGHTS: Weights = {
  nounStack: { weight: 1, easy: 2, hard: 5 },
  clauseCount: { weight: 1, easy: 2, hard: 5 },
  meanZipf: { weight: 1, easy: 5.5, hard: 3.5 },
  minZipf: { weight: 1.5, easy: 4, hard: 2 },
  lexicalDensity: { weight: 0.5, easy: 0.5, hard: 0.85 },
  negationCount: { weight: 1, easy: 0, hard: 3 },
  danglingReference: { weight: 1, easy: 0, hard: 2 },
  undefinedAcronyms: { weight: 1.5, easy: 0, hard: 2 },
  commentLength: { weight: 1, easy: 10, hard: 60 },
  fleschKincaidGrade: { weight: 1, easy: 8, hard: 16 },
  gunningFog: { weight: 1, easy: 8, hard: 16 },
  colemanLiau: { weight: 1, easy: 8, hard: 16 },
  averageSentenceLength: { weight: 1, easy: 15, hard: 30 },
};

/** One line of `data/calibration/comments.jsonl`. */
export interface LabeledComment {
  readonly id: number;
  readonly repo: string;
  readonly commit: string;
  readonly path: string;
  readonly line: number;
  readonly languageId: string;
  readonly kind: CommentKind;
  /** Raw comment text, markers included. */
  readonly text: string;
  readonly label: Label;
}

export interface Sample {
  readonly results: MetricResults;
  readonly label: Label;
}

export function parseDataset(jsonl: string): LabeledComment[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const entry = JSON.parse(line) as LabeledComment;
      if (!LABELS.includes(entry.label)) {
        throw new Error(`Line ${i + 1}: unknown label ${JSON.stringify(entry.label)}`);
      }
      return entry;
    });
}

/** Measures a labeled comment the way the extension would, with an empty workspace vocabulary. */
export function toSample(comment: LabeledComment, zipf: ZipfLookup): Sample {
  const { text, identifiers } = normalize(
    comment.text,
    dialectFor(comment.languageId, comment.kind),
  );
  const context = { identifiers: new Set(identifiers), vocabulary: new Set<string>(), zipf };
  return { results: measure(text, context), label: comment.label };
}

export interface Fit {
  readonly weights: Weights;
  readonly bands: Bands;
}

export interface FitOptions {
  readonly iterations: number;
  readonly learningRate: number;
  /** Strength of the pull towards the prior weights. */
  readonly prior: number;
}

export const DEFAULT_FIT_OPTIONS: FitOptions = {
  iterations: 3000,
  learningRate: 0.02,
  prior: 0.05,
};

/** Per-sample difficulties and how much each metric counts, fixed while the weights change. */
interface Features {
  readonly difficulty: readonly number[];
  readonly scale: readonly number[];
  readonly label: number;
}

function features(
  samples: readonly Sample[],
  metrics: readonly MetricName[],
  priors: Weights,
): Features[] {
  return samples.map(({ results, label }) => {
    const blend = readabilityWeight(results.words);
    return {
      difficulty: metrics.map((metric) =>
        difficulty(
          (isShort(metric) ? results.short[metric] : results.readability[metric]).value,
          priors[metric],
        ),
      ),
      scale: metrics.map((metric) => (isShort(metric) ? 1 : blend)),
      label: LABELS.indexOf(label),
    };
  });
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Smallest probability a log is taken of. */
const EPSILON = 1e-9;

/**
 * Fits weights and bands by gradient descent (Adam) on the ordinal log-likelihood, starting from
 * and pulled towards `priors`, whose thresholds it keeps.
 */
export function fit(
  samples: readonly Sample[],
  options: FitOptions = DEFAULT_FIT_OPTIONS,
  priors: Weights = PRIOR_WEIGHTS,
): Fit {
  const metrics = Object.keys(priors) as MetricName[];
  const prior = metrics.map((metric) => priors[metric].weight);
  const data = features(samples, metrics, priors);
  // Parameters: the weights, then bands.ok, log(bands.hard − bands.ok) and log(k).
  const params = [...prior, 3, Math.log(3), 0];
  const n = metrics.length;
  const m = params.map(() => 0);
  const v = params.map(() => 0);
  for (let step = 1; step <= options.iterations; step++) {
    const gradient = params.map(() => 0);
    const okBand = params[n]!;
    const gap = Math.exp(params[n + 1]!);
    const k = Math.exp(params[n + 2]!);
    for (const sample of data) {
      let weighted = 0;
      let total = 0;
      for (let i = 0; i < n; i++) {
        const w = params[i]! * sample.scale[i]!;
        weighted += w * sample.difficulty[i]!;
        total += w;
      }
      const score = total === 0 ? 0 : (10 * weighted) / total;
      const p1 = sigmoid(k * (score - okBand));
      const p2 = sigmoid(k * (score - okBand - gap));
      // ∂loss/∂z1 and ∂loss/∂z2, where z = k·(score − band).
      let d1 = 0;
      let d2 = 0;
      if (sample.label === 0) {
        d1 = p1;
      } else if (sample.label === 2) {
        d2 = -(1 - p2);
      } else {
        const p = Math.max(p1 - p2, EPSILON);
        d1 = (-p1 * (1 - p1)) / p;
        d2 = (p2 * (1 - p2)) / p;
      }
      const dScore = k * (d1 + d2);
      if (total > 0) {
        for (let i = 0; i < n; i++) {
          gradient[i]! +=
            (dScore * 10 * sample.scale[i]! * (sample.difficulty[i]! - score / 10)) / total;
        }
      }
      gradient[n]! -= k * (d1 + d2);
      gradient[n + 1]! -= k * d2 * gap;
      gradient[n + 2]! += k * (d1 * (score - okBand) + d2 * (score - okBand - gap));
    }
    for (let i = 0; i < params.length; i++) {
      let g = gradient[i]! / data.length;
      if (i < n) {
        g += 2 * options.prior * (params[i]! - prior[i]!);
      }
      m[i] = 0.9 * m[i]! + 0.1 * g;
      v[i] = 0.999 * v[i]! + 0.001 * g * g;
      const mHat = m[i]! / (1 - 0.9 ** step);
      const vHat = v[i]! / (1 - 0.999 ** step);
      params[i]! -= (options.learningRate * mHat) / (Math.sqrt(vHat) + 1e-8);
      if (i < n) {
        params[i] = Math.max(0, params[i]!);
      }
    }
  }
  const weights = Object.fromEntries(
    metrics.map((metric, i) => [metric, { ...priors[metric], weight: round(params[i]!) }]),
  ) as Weights;
  const okBand = round(params[n]!);
  return { weights, bands: { ok: okBand, hard: round(okBand + Math.exp(params[n + 1]!)) } };
}

/** Labels per score band, rows by human label and columns by predicted label. */
export type Confusion = Record<Label, Record<Label, number>>;

export interface Evaluation {
  /** Share of samples whose predicted label matches the human one. */
  readonly agreement: number;
  /**
   * Share of pairs with different labels where the harder-labeled comment scores higher; a tie
   * counts half. Measures the score as a ranking, which is what a reader comparing comments sees.
   */
  readonly ordered: number;
  /** The same for easy against hard pairs only. */
  readonly easyBelowHard: number;
  readonly confusion: Confusion;
}

/** Share of (lower, higher) pairs that the scores put in that order; a tie counts half. */
function ordering(lower: readonly number[], higher: readonly number[]): [number, number] {
  let ordered = 0;
  for (const a of lower) {
    for (const b of higher) {
      ordered += a < b ? 1 : a === b ? 0.5 : 0;
    }
  }
  return [ordered, lower.length * higher.length];
}

const emptyRow = (): Record<Label, number> => ({ easy: 0, ok: 0, hard: 0 });

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** Compares the labels and order a fit gives with the human labels. */
export function evaluate(samples: readonly Sample[], { weights, bands }: Fit): Evaluation {
  const confusion: Confusion = { easy: emptyRow(), ok: emptyRow(), hard: emptyRow() };
  const scores: Record<Label, number[]> = { easy: [], ok: [], hard: [] };
  let agreed = 0;
  for (const { results, label } of samples) {
    const score = composite(results, weights, bands);
    confusion[label][score.label]++;
    scores[label].push(score.contributions.reduce((sum, { points }) => sum + points, 0));
    if (score.label === label) {
      agreed++;
    }
  }
  const pairs = [
    ordering(scores.easy, scores.ok),
    ordering(scores.ok, scores.hard),
    ordering(scores.easy, scores.hard),
  ];
  const [ordered, compared] = pairs.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
  const [easyHard, easyHardPairs] = pairs[2]!;
  return {
    agreement: share(agreed, samples.length),
    ordered: share(ordered, compared),
    easyBelowHard: share(easyHard, easyHardPairs),
    confusion,
  };
}

/**
 * Agreement on held-out samples: fits on all folds but one, evaluates on that one, in turn. Folds
 * take every `folds`-th sample, so the result does not depend on chance.
 */
export function crossValidate(
  samples: readonly Sample[],
  folds = 5,
  options: FitOptions = DEFAULT_FIT_OPTIONS,
): number {
  let agreed = 0;
  for (let fold = 0; fold < folds; fold++) {
    const train = samples.filter((_, i) => i % folds !== fold);
    const test = samples.filter((_, i) => i % folds === fold);
    agreed += evaluate(test, fit(train, options)).agreement * test.length;
  }
  return share(agreed, samples.length);
}
