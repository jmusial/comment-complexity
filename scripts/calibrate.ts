import { readFileSync, writeFileSync } from "node:fs";
import { loadZipf } from "../src/metrics/zipf";
import { crossValidate, evaluate, fit, parseDataset, toSample } from "../src/score/calibration";

/**
 * Fits the composite weights to `data/calibration/comments.jsonl` and writes them to
 * `src/score/weights.json`. Run with `pnpm calibrate` after changing the labels or the metrics.
 */

const DATASET = "data/calibration/comments.jsonl";
const OUTPUT = "src/score/weights.json";

const zipf = loadZipf("data/zipf-en.json");
const samples = parseDataset(readFileSync(DATASET, "utf8")).map((comment) =>
  toSample(comment, zipf),
);
const fitted = fit(samples);
const { agreement, ordered, easyBelowHard, confusion } = evaluate(samples, fitted);
const heldOut = crossValidate(samples);

writeFileSync(OUTPUT, `${JSON.stringify(fitted, null, 2)}\n`);
const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;
console.log(`Fitted ${samples.length} comments; wrote ${OUTPUT}`);
console.log(`Hard above easy: ${percent(easyBelowHard)}; pairs in order: ${percent(ordered)}`);
console.log(`Exact agreement: ${percent(agreement)}, cross-validated: ${percent(heldOut)}`);
console.table(confusion);
