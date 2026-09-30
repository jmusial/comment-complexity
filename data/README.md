# Bundled data

## zipf-en.json

Zipf frequencies (log10 of occurrences per billion words) of the 50,000 most common English words,
used to rate word rarity in comments.

- Source: [wordfreq](https://github.com/rspeer/wordfreq) v3.2 (`large_en`) by Robyn Speer, pinned
  to commit `42233e6c36ce792031bcccfa17cdd0cec9af5fa7`
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This file only; the
  rest of the extension is MIT. The file also carries this attribution in its `source` and
  `license` fields.
- Changes: kept ASCII letter-only words; values are wordfreq's centibel buckets converted to Zipf.
- Regenerate: `node scripts/build-zipf.mjs`
