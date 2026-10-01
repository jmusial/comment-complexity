import {
  DEFAULT_RAMP,
  READABILITY_METRICS,
  type Ramp,
  readabilityWeight,
  textStats,
} from "../metrics/readability";
import { type MetricContext, type MetricResult, SHORT_METRICS } from "../metrics/short";
import { tokenize } from "../metrics/tokens";
import calibrated from "./weights.json";

/**
 * Combines the metrics into one 0–10 score. Each value becomes a difficulty from 0 to 1 by a ramp
 * between its own easy and hard thresholds; the score is the weighted mean of those, times 10. The
 * readability formulas count only as much as `readabilityWeight` allows for the comment's length.
 */

export type ShortMetricName = keyof typeof SHORT_METRICS;
export type ReadabilityMetricName = keyof typeof READABILITY_METRICS;
export type MetricName = ShortMetricName | ReadabilityMetricName;

export interface MetricWeight {
  readonly weight: number;
  /** Value with no difficulty. */
  readonly easy: number;
  /** Value from which the difficulty is full. Below `easy` for metrics where lower is harder. */
  readonly hard: number;
}

export type Weights = Readonly<Record<MetricName, MetricWeight>>;

/** Labels people give comments, easiest first. */
export const LABELS = ["easy", "ok", "hard"] as const;
export type Label = (typeof LABELS)[number];

/** Scores from which a comment counts as ok, and as hard. */
export interface Bands {
  readonly ok: number;
  readonly hard: number;
}

/** Fitted to labeled comments by `pnpm calibrate` (see `calibration.ts`). */
export const DEFAULT_WEIGHTS: Weights = calibrated.weights;
export const DEFAULT_BANDS: Bands = calibrated.bands;

export function labelFor(score: number, bands: Bands): Label {
  return score >= bands.hard ? "hard" : score >= bands.ok ? "ok" : "easy";
}

/** Said for metrics that matter but give no reason of their own. */
const FALLBACK_REASONS: Partial<Record<MetricName, string>> = {
  meanZipf: "Uncommon vocabulary",
};

/** How many reasons a score carries. */
export const TOP_REASONS = 3;

export interface Contribution {
  readonly metric: MetricName;
  readonly value: number;
  /** 0 to 1, from the metric's thresholds. */
  readonly difficulty: number;
  /** Points of the 0–10 score this metric accounts for. */
  readonly points: number;
  readonly reason?: string;
}

export interface Score {
  /** 0 (easy) to 10 (hard), one decimal. */
  readonly score: number;
  /** The score's band; compared before rounding. */
  readonly label: Label;
  /** How much the readability formulas counted, 0 to 1, from the comment's length. */
  readonly readability: number;
  /** Reasons of the metrics that added the most points, most first. */
  readonly reasons: readonly string[];
  /** Every metric, in `Weights` order. */
  readonly contributions: readonly Contribution[];
}

export interface MetricResults {
  readonly short: Readonly<Record<ShortMetricName, MetricResult>>;
  readonly readability: Readonly<Record<ReadabilityMetricName, MetricResult>>;
  /** Words in the comment, for the readability blend. */
  readonly words: number;
}

/** 0 at `easy`, 1 at `hard`, linear between; works either way round. */
export function difficulty(value: number, { easy, hard }: MetricWeight): number {
  return Math.min(1, Math.max(0, (value - easy) / (hard - easy)));
}

export const isShort = (metric: MetricName): metric is ShortMetricName => metric in SHORT_METRICS;

/** Scores metric results already computed. */
export function composite(
  results: MetricResults,
  weights: Weights = DEFAULT_WEIGHTS,
  bands: Bands = DEFAULT_BANDS,
  ramp: Ramp = DEFAULT_RAMP,
): Score {
  const blend = readabilityWeight(results.words, ramp);
  const scored = (Object.keys(weights) as MetricName[]).map((metric) => {
    const result = isShort(metric) ? results.short[metric] : results.readability[metric];
    const config = weights[metric];
    return {
      metric,
      result,
      hardness: difficulty(result.value, config),
      weight: config.weight * (isShort(metric) ? 1 : blend),
    };
  });
  const total = scored.reduce((sum, { weight }) => sum + weight, 0);
  const contributions: Contribution[] = scored.map(({ metric, result, hardness, weight }) => {
    const points = total === 0 ? 0 : (10 * weight * hardness) / total;
    const reason = result.reason ?? (hardness > 0 ? FALLBACK_REASONS[metric] : undefined);
    const contribution = { metric, value: result.value, difficulty: hardness, points };
    return reason === undefined ? contribution : { ...contribution, reason };
  });
  const score = contributions.reduce((sum, { points }) => sum + points, 0);
  const reasons = contributions
    .filter((contribution) => contribution.points > 0)
    .toSorted((a, b) => b.points - a.points)
    .flatMap(({ reason }) => (reason === undefined ? [] : [reason]))
    .slice(0, TOP_REASONS);
  return {
    score: Math.round(score * 10) / 10,
    label: labelFor(score, bands),
    readability: blend,
    reasons,
    contributions,
  };
}

/** Runs every metric over normalized comment text. */
export function measure(text: string, context: MetricContext): MetricResults {
  const tokens = tokenize(text);
  const stats = textStats(text);
  return {
    short: Object.fromEntries(
      Object.entries(SHORT_METRICS).map(([name, metric]) => [name, metric(tokens, context)]),
    ) as MetricResults["short"],
    readability: Object.fromEntries(
      Object.entries(READABILITY_METRICS).map(([name, metric]) => [name, metric(stats)]),
    ) as MetricResults["readability"],
    words: stats.words,
  };
}

/** Scores normalized comment text. */
export function scoreComment(
  text: string,
  context: MetricContext,
  weights: Weights = DEFAULT_WEIGHTS,
  bands: Bands = DEFAULT_BANDS,
): Score {
  return composite(measure(text, context), weights, bands);
}
