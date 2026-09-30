import { describe, expect, it } from "vitest";
import {
  type TextStats,
  averageSentenceLength,
  colemanLiau,
  fleschKincaidGrade,
  gunningFog,
  readabilityWeight,
  textStats,
} from "../../metrics/readability";

/** Two 15-word sentences of mostly short words. */
const PLAIN: TextStats = { sentences: 2, words: 30, syllables: 45, letters: 135, complexWords: 3 };
/** One 40-word sentence of long words. */
const DENSE: TextStats = { sentences: 1, words: 40, syllables: 80, letters: 240, complexWords: 12 };
const EMPTY: TextStats = { sentences: 0, words: 0, syllables: 0, letters: 0, complexWords: 0 };

describe("fleschKincaidGrade", () => {
  it.each([
    ["plain", PLAIN, { value: 7.96 }],
    ["dense", DENSE, { value: 23.61, reason: "Flesch-Kincaid grade 23.61" }],
    ["empty", EMPTY, { value: 0 }],
  ])("%s", (_, stats, expected) => {
    expect(fleschKincaidGrade(stats)).toEqual(expected);
  });
});

describe("gunningFog", () => {
  it.each([
    ["plain", PLAIN, { value: 10 }],
    ["dense", DENSE, { value: 28, reason: "Gunning Fog index 28" }],
    ["empty", EMPTY, { value: 0 }],
  ])("%s", (_, stats, expected) => {
    expect(gunningFog(stats)).toEqual(expected);
  });
});

describe("colemanLiau", () => {
  it.each([
    ["plain", PLAIN, { value: 8.69 }],
    ["dense", DENSE, { value: 18.74, reason: "Coleman-Liau index 18.74" }],
    ["empty", EMPTY, { value: 0 }],
  ])("%s", (_, stats, expected) => {
    expect(colemanLiau(stats)).toEqual(expected);
  });
});

describe("averageSentenceLength", () => {
  it.each([
    ["plain", PLAIN, { value: 15 }],
    ["dense", DENSE, { value: 40, reason: "Long sentences: 40 words on average" }],
    ["empty", EMPTY, { value: 0 }],
  ])("%s", (_, stats, expected) => {
    expect(averageSentenceLength(stats)).toEqual(expected);
  });
});

describe("textStats", () => {
  it("counts sentences, words, syllables and letters", () => {
    expect(textStats("The cat sat on the mat. It was happy.")).toEqual({
      sentences: 2,
      words: 9,
      syllables: 10,
      letters: 27,
      complexWords: 0,
    });
  });

  it("treats each line as a unit and does not split after e.g.", () => {
    const stats = textStats("Prefer a cache, e.g. an LRU one.\nthe raw bytes");
    expect(stats.sentences).toBe(2);
  });

  it("counts complex words, ignoring -es, -ed and -ing endings", () => {
    expect(textStats("Documentation created unavoidable problems.").complexWords).toBe(2);
  });

  it.each([
    ["documentation", 1],
    // "recipe" already has three syllables; the -s adds none.
    ["recipes", 1],
    // The ending adds the third syllable.
    ["created", 0],
    ["committed", 0],
    ["processes", 0],
    ["documenting", 1],
    // Compounds of one-syllable parts read easily; a long part still counts.
    ["state-of-the-art", 0],
    ["high-performance", 1],
    ["cat", 0],
  ])("rates %s as %i complex", (word, complex) => {
    expect(textStats(word).complexWords).toBe(complex);
  });

  it.each([
    ['"Retry now." Stop here.', 2],
    ["(See the docs.) Then retry.", 2],
    ["It fails! Why? Nobody knows.", 3],
  ])("splits %j into %i sentences", (text, sentences) => {
    expect(textStats(text).sentences).toBe(sentences);
  });

  it("ignores punctuation and bare numbers", () => {
    expect(textStats("Retry 3 times — then stop.")).toMatchObject({ sentences: 1, words: 4 });
  });

  it.each(["", "---\n\n", "42"])("finds nothing in %j", (text) => {
    expect(textStats(text)).toEqual({
      sentences: 0,
      words: 0,
      syllables: 0,
      letters: 0,
      complexWords: 0,
    });
  });
});

describe("readabilityWeight", () => {
  it.each([
    [0, 0],
    [19, 0],
    [20, 0],
    [25, 0.25],
    [30, 0.5],
    [39, 0.95],
    [40, 1],
    [120, 1],
  ])("%i words → %s", (words, weight) => {
    expect(readabilityWeight(words)).toBeCloseTo(weight);
  });
});
