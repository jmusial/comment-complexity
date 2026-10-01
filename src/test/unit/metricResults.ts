import type { MetricResult } from "../../metrics/short";
import { PRIOR_WEIGHTS } from "../../score/calibration";
import type { MetricName, MetricResults } from "../../score/composite";

/**
 * Results at each metric's easy threshold in `PRIOR_WEIGHTS`, so every difficulty is 0, with
 * overrides.
 */
export function results(
  overrides: Partial<Record<MetricName, MetricResult>> = {},
  words = 10,
): MetricResults {
  const at = (metric: MetricName): MetricResult =>
    overrides[metric] ?? { value: PRIOR_WEIGHTS[metric].easy };
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
      commentLength: at("commentLength"),
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
