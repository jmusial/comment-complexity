// Regenerates data/zipf-en.json: Zipf frequencies of the most common English words, read straight
// from wordfreq's data file (CC BY-SA 4.0, see data/README.md). Run: node scripts/build-zipf.mjs

import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decode } from "@msgpack/msgpack";

// wordfreq v3.2, pinned by commit so the download cannot change under us.
const COMMIT = "42233e6c36ce792031bcccfa17cdd0cec9af5fa7";
const SOURCE = `https://raw.githubusercontent.com/rspeer/wordfreq/${COMMIT}/wordfreq/data/large_en.msgpack.gz`;
const WORDS = 50_000;
const OUT = new URL("../data/zipf-en.json", import.meta.url);

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`${response.status} ${response.statusText} fetching ${SOURCE}`);
}
// "cBpack": a header, then buckets of words; bucket i holds words at -i centibels.
const [header, ...buckets] = decode(gunzipSync(Buffer.from(await response.arrayBuffer())));
if (header?.format !== "cB" || header?.version !== 1) {
  throw new Error(`Unexpected cBpack header: ${JSON.stringify(header)}`);
}

// -i centibels is a frequency of 10^(-i/100), so i/100 below 10^9 per billion: Zipf = 9 - i/100,
// the value wordfreq's zipf_frequency() returns.
const zipf = new Map();
for (const [i, bucket] of buckets.entries()) {
  for (const word of bucket) {
    // Letters only: numbers, symbols and contraction fragments ("n't") are not words to rate.
    if (zipf.size < WORDS && /^[a-z]+$/.test(word) && !zipf.has(word)) {
      zipf.set(word, (900 - i) / 100);
    }
  }
  if (zipf.size === WORDS) {
    break;
  }
}

// Sanity checks against values wordfreq documents, so a format change fails loudly.
const the = zipf.get("the");
if (zipf.size !== WORDS || the === undefined || the < 7.5 || the > 8) {
  throw new Error(`Suspicious output: ${zipf.size} words, "the" = ${the}`);
}

// Attribution travels inside the file, as CC BY-SA requires. One word per line keeps diffs readable.
const lines = [...zipf].map(([word, value]) => `    ${JSON.stringify(word)}: ${value}`);
const json = [
  "{",
  `  "source": ${JSON.stringify(`wordfreq v3.2 large_en (https://github.com/rspeer/wordfreq/tree/${COMMIT}), by Robyn Speer`)},`,
  `  "license": "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)",`,
  `  "note": "Zipf = log10 of occurrences per billion words. ASCII letter-only words. See data/README.md.",`,
  `  "words": {`,
  lines.join(",\n"),
  "  }",
  "}",
  "",
].join("\n");
writeFileSync(OUT, json);
console.log(`Wrote ${zipf.size} words to data/zipf-en.json ("the" = ${the})`);
