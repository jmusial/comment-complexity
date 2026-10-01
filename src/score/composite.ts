import { READABILITY_METRICS, readabilityWeight, textStats } from "../metrics/readability";
import { type MetricContext, type MetricResult, SHORT_METRICS } from "../metrics/short";
import { tokenize } from "../metrics/tokens";

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

/** Hand-picked until calibration (#14) fits them to labeled comments. */
export const DEFAULT_WEIGHTS: Weights = {
  nounStack: { weight: 1, easy: 2, hard: 5 },
  clauseCount: { weight: 1, easy: 2, hard: 5 },
  meanZipf: { weight: 1, easy: 5.5, hard: 3.5 },
  minZipf: { weight: 1.5, easy: 4, hard: 2 },
  lexicalDensity: { weight: 0.5, easy: 0.5, hard: 0.85 },
  negationCount: { weight: 1, easy: 0, hard: 3 },
  danglingReference: { weight: 1, easy: 0, hard: 2 },
  undefinedAcronyms: { weight: 1.5, easy: 0, hard: 2 },
  fleschKincaidGrade: { weight: 1, easy: 8, hard: 16 },
  gunningFog: { weight: 1, easy: 8, hard: 16 },
  colemanLiau: { weight: 1, easy: 8, hard: 16 },
  averageSentenceLength: { weight: 1, easy: 15, hard: 30 },
};

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

const isShort = (metric: MetricName): metric is ShortMetricName => metric in SHORT_METRICS;

/** Scores metric results already computed. */
export function composite(results: MetricResults, weights: Weights = DEFAULT_WEIGHTS): Score {
  const blend = readabilityWeight(results.words);
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
  return { score: Math.round(score * 10) / 10, reasons, contributions };
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
): Score {
  return composite(measure(text, context), weights);
}
