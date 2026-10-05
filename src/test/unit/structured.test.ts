import { describe, expect, it } from "vitest";
import { isStructured } from "../../extract/structured";

describe("isStructured", () => {
  it.each([
    [
      "a __GDPR__ telemetry annotation",
      [
        "__GDPR__",
        '"fetcherTelemetry" : {',
        '"owner": "chrmarti",',
        '"comment": "Telemetry event to test connectivity of different fetcher implementations."',
        "}",
      ],
    ],
    ["a marker alone", ["__GDPR__FRAGMENT__"]],
    [
      "a one-line annotation",
      [
        '__GDPR__COMMON__ "common.tid" : { "endPoint": "GoogleAnalyticsId", "purpose": "BusinessInsight" }',
      ],
    ],
    [
      "a marker in a block gutter",
      [" * __GDPR__COMMON__", ' * "common.os": { "classification": "x" }'],
    ],
    [
      "a JSON example without a marker",
      ["{", '  "name": "comment-complexity",', '  "version": "0.0.1",', '  "private": true', "}"],
    ],
    [
      "a list of quoted values",
      ["Allowed values:", '"lens",', '"hover",', '"diagnostics",', '"report"'],
    ],
  ])("%s", (_, lines) => {
    expect(isStructured(lines.join("\n"))).toBe(true);
  });

  it.each([
    ["plain prose", ["Retries the upload when the network drops."]],
    [
      "prose about a constant named like a marker",
      ["__DEV__ is true in development builds, so the checks below run only locally."],
    ],
    [
      "prose with one JSON example",
      ["Reads the config, for example:", '"timeout": 30', "and applies it."],
    ],
    [
      "prose with a few data lines among many",
      [
        "Merges the user settings over the defaults.",
        '"timeout": 30',
        '"retries": 3',
        '"backoff": "linear"',
        "Unknown keys are kept as they are, so newer settings survive a downgrade.",
        "Invalid values fall back to the default and are reported once.",
        "The result is frozen.",
      ],
    ],
    ["an empty body", [""]],
  ])("keeps %s", (_, lines) => {
    expect(isStructured(lines.join("\n"))).toBe(false);
  });
});
