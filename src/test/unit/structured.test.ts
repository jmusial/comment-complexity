import { describe, expect, it } from "vitest";
import { isStructured, withoutStructured } from "../../extract/structured";

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
    ["an array of numbers", ["[", "1,", "2,", "3.5,", "-4e2", "]"]],
    ["an array of literals", ["[", "true,", "false,", "null", "]"]],
    ["a heading over two data lines", ["Defaults:", '"timeout": 30,', '"retries": 3']],
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

/** Splits line comments, one line each; returns the kept groups as text. */
const kept = (...lines: string[]) =>
  withoutStructured(lines, (line) => line).map((group) => group.join(" / "));

describe("withoutStructured", () => {
  it("keeps prose next to an annotation in the same run", () => {
    expect(
      kept(
        "__GDPR__",
        '"event" : {',
        '"owner": "someone"',
        "}",
        "Sends the event once the network is back.",
      ),
    ).toEqual(["Sends the event once the network is back."]);
    expect(
      kept(
        "Sends the event once the network is back.",
        '__GDPR__COMMON__ "common.tid" : { "purpose": "BusinessInsight" }',
        "Then clears the queue.",
      ),
    ).toEqual(["Sends the event once the network is back.", "Then clears the queue."]);
  });

  it("drops an annotation at the end of a run, after an empty line", () => {
    expect(
      kept("", "Sends the event once the network is back.", "__GDPR__", '"event": {}'),
    ).toEqual([" / Sends the event once the network is back."]);
  });

  it("keeps prose with a short example whole, empty lines included", () => {
    const lines = ["Reads the config, for example:", '"timeout": 30', "", "and applies it."];
    expect(kept(...lines)).toEqual([lines.join(" / ")]);
  });

  it("drops data that is only structured as a whole", () => {
    expect(kept("Defaults:", '"timeout": 30,', '"retries": 3')).toEqual([]);
  });

  it("keeps or drops a single comment whole", () => {
    expect(kept("Retries the upload.")).toEqual(["Retries the upload."]);
    expect(kept('__GDPR__ "event": {}')).toEqual([]);
    expect(withoutStructured([], (line: string) => line)).toEqual([]);
  });
});
