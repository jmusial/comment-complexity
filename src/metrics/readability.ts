import { syllable } from "syllable";
import type { MetricResult } from "./short";

/**
 * Classic readability formulas for long comments. They need enough text to mean anything, so
 * `readabilityWeight` blends them in by length. SMOG is left out: it assumes 30 sentences.
 */

/** Counts the formulas are built from. */
export interface TextStats {
  readonly sentences: number;
  readonly words: number;
  readonly syllables: number;
  readonly letters: number;
  /** Words of three or more syllables, not counting an -es, -ed or -ing ending (Gunning's rule). */
  readonly complexWords: number;
}

/** A sentence ends at . ! or ?, except after common abbreviations. */
const SENTENCE_END = /(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|cf)\.)\s+/i;

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Counts sentences, words, syllables and letters of normalized comment text; each line is a unit. */
export function textStats(text: string): TextStats {
  let sentences = 0;
  let words = 0;
  let syllables = 0;
  let letters = 0;
  let complexWords = 0;
  for (const line of text.split("\n")) {
    for (const sentence of line.split(SENTENCE_END)) {
      // A unit without end punctuation, like a @param description, still counts as a sentence.
      const found = (sentence.match(WORD) ?? []).filter((word) => /\p{L}/u.test(word));
      if (found.length === 0) {
        continue;
      }
      sentences++;
      for (const word of found) {
        const count = Math.max(1, syllable(word));
        words++;
        syllables += count;
        letters += (word.match(/\p{L}/gu) ?? []).length;
        const stem = word.replace(/(?:es|ed|ing)$/i, "");
        if (count >= 3 && (stem === word || syllable(stem) >= 3)) {
          complexWords++;
        }
      }
    }
  }
  return { sentences, words, syllables, letters, complexWords };
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Formula value at which the text reads like a university textbook. */
const HARD_GRADE = 12;

/** Words per sentence at which sentences feel long. */
const LONG_SENTENCE = 25;

export type ReadabilityMetric = (stats: TextStats) => MetricResult;

/** Flesch-Kincaid Grade Level: US school grade needed to follow the text. */
export const fleschKincaidGrade: ReadabilityMetric = ({ sentences, words, syllables }) => {
  if (words === 0) {
    return { value: 0 };
  }
  const value = round(0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59);
  return value >= HARD_GRADE ? { value, reason: `Flesch-Kincaid grade ${value}` } : { value };
};

/** Gunning Fog index: years of schooling, weighing sentence length and complex words. */
export const gunningFog: ReadabilityMetric = ({ sentences, words, complexWords }) => {
  if (words === 0) {
    return { value: 0 };
  }
  const value = round(0.4 * (words / sentences + 100 * (complexWords / words)));
  return value >= HARD_GRADE ? { value, reason: `Gunning Fog index ${value}` } : { value };
};

/** Coleman-Liau index: grade level from letters and sentences per 100 words, no syllables. */
export const colemanLiau: ReadabilityMetric = ({ sentences, words, letters }) => {
  if (words === 0) {
    return { value: 0 };
  }
  const lettersPer100 = (letters / words) * 100;
  const sentencesPer100 = (sentences / words) * 100;
  const value = round(0.0588 * lettersPer100 - 0.296 * sentencesPer100 - 15.8);
  return value >= HARD_GRADE ? { value, reason: `Coleman-Liau index ${value}` } : { value };
};

/** Mean words per sentence. */
export const averageSentenceLength: ReadabilityMetric = ({ sentences, words }) => {
  if (words === 0) {
    return { value: 0 };
  }
  const value = round(words / sentences);
  return value >= LONG_SENTENCE
    ? { value, reason: `Long sentences: ${value} words on average` }
    : { value };
};

/** Every readability metric by name. */
export const READABILITY_METRICS = {
  fleschKincaidGrade,
  gunningFog,
  colemanLiau,
  averageSentenceLength,
} as const satisfies Record<string, ReadabilityMetric>;

/** Below this many words the formulas are noise, so they get no weight. */
export const RAMP_START = 20;

/** From this many words on the formulas count fully. */
export const RAMP_END = 40;

/** How much the readability formulas count: 0 below 20 words, rising linearly to 1 at 40. */
export function readabilityWeight(words: number): number {
  return Math.min(1, Math.max(0, (words - RAMP_START) / (RAMP_END - RAMP_START)));
}
