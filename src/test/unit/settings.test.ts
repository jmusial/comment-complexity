import { describe, expect, it } from "vitest";
import { DEFAULT_RAMP } from "../../metrics/readability";
import { DEFAULT_WEIGHTS } from "../../score/composite";
import { DEFAULT_SETTINGS, parseSettings, scores } from "../../settings";

const parse = (values: Record<string, unknown>) => parseSettings((key) => values[key]);

describe("parseSettings", () => {
  it("defaults everything that is not set, with diagnostics off", () => {
    expect(parse({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.diagnostics).toBe(false);
  });

  it("reads valid values", () => {
    const settings = parse({
      enabled: false,
      languages: ["typescript", "python"],
      threshold: 6.5,
      showOnlyAbove: true,
      diagnostics: true,
      weights: { negationCount: 3, gunningFog: 0 },
      acronymWhitelist: ["SQS", " DLQ "],
      readabilityRamp: { start: 10, end: 30 },
    });
    expect(settings).toMatchObject({
      enabled: false,
      threshold: 6.5,
      showOnlyAbove: true,
      diagnostics: true,
      ramp: { start: 10, end: 30 },
    });
    expect([...settings.languages!]).toEqual(["typescript", "python"]);
    expect([...settings.acronyms]).toEqual(["sqs", "dlq"]);
    expect(settings.weights.negationCount).toEqual({ ...DEFAULT_WEIGHTS.negationCount, weight: 3 });
    expect(settings.weights.gunningFog.weight).toBe(0);
    expect(settings.weights.nounStack).toBe(DEFAULT_WEIGHTS.nounStack);
  });

  it("falls back to defaults for values of the wrong type or out of range", () => {
    const settings = parse({
      enabled: "yes",
      languages: "typescript",
      threshold: -1,
      weights: { negationCount: -2, nounStack: "high", unknownMetric: 4 },
      acronymWhitelist: ["SQS", 42, "two words", ""],
      readabilityRamp: { start: 40, end: 20 },
    });
    expect(settings).toMatchObject({ enabled: true, languages: undefined, threshold: 5 });
    expect(settings.weights).toEqual(DEFAULT_WEIGHTS);
    expect([...settings.acronyms]).toEqual(["sqs"]);
    expect(settings.ramp).toBe(DEFAULT_RAMP);
    expect(parse({ weights: [1, 2], readabilityRamp: "20/40" })).toMatchObject({
      weights: DEFAULT_WEIGHTS,
      ramp: DEFAULT_RAMP,
    });
  });

  it("caps the threshold at the top of the scale", () => {
    expect(parse({ threshold: 12 }).threshold).toBe(10);
    expect(parse({ threshold: Number.NaN }).threshold).toBe(5);
  });
});

describe("scores", () => {
  it("scores every language unless limited or turned off", () => {
    expect(scores(DEFAULT_SETTINGS, "kotlin")).toBe(true);
    const onlyTs = parse({ languages: ["typescript"] });
    expect(scores(onlyTs, "typescript")).toBe(true);
    expect(scores(onlyTs, "kotlin")).toBe(false);
    expect(scores(parse({ enabled: false }), "typescript")).toBe(false);
  });
});
