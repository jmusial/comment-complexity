import { DEFAULT_RAMP, type Ramp } from "./metrics/readability";
import { DEFAULT_WEIGHTS, type MetricName, type Weights } from "./score/composite";

/**
 * The `commentComplexity.*` settings, validated: a value of the wrong type or out of range falls
 * back to its default rather than breaking the score. Kept free of `vscode` so it is unit-tested.
 */

export interface Settings {
  readonly enabled: boolean;
  /** Language ids to score; `undefined` scores every supported language. */
  readonly languages: ReadonlySet<string> | undefined;
  /** Score from which a comment counts as complex, for `showOnlyAbove` and diagnostics. */
  readonly threshold: number;
  /** Show lenses only on comments at or above `threshold`. */
  readonly showOnlyAbove: boolean;
  /** Report comments at or above `threshold` as Information diagnostics. */
  readonly diagnostics: boolean;
  /** The fitted weights with the user's overrides applied. */
  readonly weights: Weights;
  /** Extra acronyms the reader knows, lower-cased like the workspace vocabulary. */
  readonly acronyms: ReadonlySet<string>;
  readonly ramp: Ramp;
}

export const SECTION = "commentComplexity";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  languages: undefined,
  threshold: 5,
  showOnlyAbove: false,
  diagnostics: false,
  weights: DEFAULT_WEIGHTS,
  acronyms: new Set(),
  ramp: DEFAULT_RAMP,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function weights(value: unknown): Weights {
  if (!isRecord(value)) {
    return DEFAULT_WEIGHTS;
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_WEIGHTS).map(([metric, config]) => {
      const weight = value[metric];
      return [metric, isCount(weight) ? { ...config, weight } : config];
    }),
  ) as Record<MetricName, Weights[MetricName]>;
}

function ramp(value: unknown): Ramp {
  if (!isRecord(value)) {
    return DEFAULT_RAMP;
  }
  const { start, end } = value;
  return isCount(start) && isCount(end) && end > start ? { start, end } : DEFAULT_RAMP;
}

/** Reads the settings through `get`, which returns a setting's value by its key under `SECTION`. */
export function parseSettings(get: (key: string) => unknown): Settings {
  const flag = (key: string, fallback: boolean): boolean => {
    const value = get(key);
    return typeof value === "boolean" ? value : fallback;
  };
  const threshold = get("threshold");
  const languages = strings(get("languages"));
  return {
    enabled: flag("enabled", DEFAULT_SETTINGS.enabled),
    languages: languages.length === 0 ? undefined : new Set(languages),
    threshold: isCount(threshold) ? Math.min(threshold, 10) : DEFAULT_SETTINGS.threshold,
    showOnlyAbove: flag("showOnlyAbove", DEFAULT_SETTINGS.showOnlyAbove),
    diagnostics: flag("diagnostics", DEFAULT_SETTINGS.diagnostics),
    weights: weights(get("weights")),
    acronyms: new Set(
      strings(get("acronymWhitelist"))
        .map((acronym) => acronym.trim().toLowerCase())
        .filter((acronym) => /^[a-z0-9]+$/.test(acronym)),
    ),
    ramp: ramp(get("readabilityRamp")),
  };
}

/** Whether comments in `languageId` are scored at all. */
export function scores(settings: Settings, languageId: string): boolean {
  return settings.enabled && (settings.languages?.has(languageId) ?? true);
}
