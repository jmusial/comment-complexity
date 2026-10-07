import { LICENSE_TEXTS } from "./licenseTexts";
import { cutParts } from "./runs";

/** Words a license header has; enough to drop the file's first comment. */
export const LICENSE = /\b(?:copyright|licen[cs]ed?|spdx-license-identifier)\b|\(c\)|©/i;

/** Wording only license texts use; `\s+` because notices wrap anywhere. */
const LEGAL_BOILERPLATE =
  /\bspdx-license-identifier\b|\bpermission\s+is\s+hereby\s+granted\b|\bwithout\s+warranties\s+or\s+conditions\b|\bprovided\s+["“]?as\s+is["”]?|\blicensed\s+under\s+the\b/i;

/** A copyright notice: `Copyright (c)`, `Copyright 2024`, `© 2024`. */
const COPYRIGHT_NOTICE = /\bcopyright\s*(?:\(c\)|©|\d{4})|©\s*\d{4}/i;

/** A license by name, or the proprietary "all rights reserved"; either may wrap across lines. */
const LICENSE_NAME =
  /\b(?:MIT|Apache|BSD|GNU|L?GPL|AGPL|MPL|Mozilla\s+Public|ISC|Unlicense|Creative\s+Commons|Eclipse\s+Public)\b[\s\S]{0,40}?\blicen[cs]e\b|\blicen[cs]e\b[\s\S]{0,20}?\b(?:MIT|Apache|BSD|L?GPL|AGPL|MPL|ISC)\b|\ball\s+rights\s+reserved\b/i;

/**
 * Whether a comment is unmistakably license text, wherever it sits: after an include guard,
 * `#pragma once` or `"use strict"`, or above vendored code. Prose that only mentions a license
 * ("this file is licensed oddly") is not.
 */
export function isLicenseText(body: string): boolean {
  return LEGAL_BOILERPLATE.test(body) || (COPYRIGHT_NOTICE.test(body) && LICENSE_NAME.test(body));
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const trigrams = (words: readonly string[]): string[] =>
  words.slice(2).map((word, i) => `${words[i]} ${words[i + 1]} ${word}`);

/** Words and word trigrams of the standard license texts, built on first use. */
let corpus:
  | { readonly words: ReadonlySet<string>; readonly trigrams: ReadonlySet<string> }
  | undefined;

function licenseCorpus(): NonNullable<typeof corpus> {
  if (corpus === undefined) {
    const words = LICENSE_TEXTS.map(wordsOf);
    corpus = { words: new Set(words.flat()), trigrams: new Set(words.flatMap(trigrams)) };
  }
  return corpus;
}

/** Share of a line's word trigrams found in the license texts from which it is one of theirs. */
const LICENSE_LINE_SHARE = 0.6;

/** Consecutive trigrams (six words) of license wording that make a line one of theirs anyway. */
const LICENSE_LINE_RUN = 4;

/**
 * Whether a line belongs to a license notice: a copyright or SPDX line, a license name, or wording
 * taken from a standard license text: mostly, or six words verbatim (allowing for a substituted
 * name, as in "Neither the name of Google Inc. nor the names of its contributors"). Prose that
 * shares a few words ("Returns a copy of the software update queue") is not.
 */
export function isLicenseLine(line: string): boolean {
  if (COPYRIGHT_NOTICE.test(line) || LEGAL_BOILERPLATE.test(line) || LICENSE_NAME.test(line)) {
    return true;
  }
  const words = wordsOf(line);
  const { words: known, trigrams: knownTrigrams } = licenseCorpus();
  if (words.length < 3) {
    // Too short for trigrams: the tail of a wrapped sentence, like "SOFTWARE." or "the License.".
    return words.length > 0 && words.every((word) => known.has(word));
  }
  let found = 0;
  let run = 0;
  let longestRun = 0;
  const lineTrigrams = trigrams(words);
  for (const trigram of lineTrigrams) {
    run = knownTrigrams.has(trigram) ? run + 1 : 0;
    found += run > 0 ? 1 : 0;
    longestRun = Math.max(longestRun, run);
  }
  // A long verbatim stretch survives a substituted name; a share alone would miss it.
  return found / lineTrigrams.length >= LICENSE_LINE_SHARE || longestRun >= LICENSE_LINE_RUN;
}

/**
 * Cuts license text out of a run of line comments, so an explanation right below a notice
 * (`// SPDX-License-Identifier: MIT` then `// Explains the calculation.`) is still scored.
 */
export function withoutLicense<T>(comments: readonly T[], body: (comment: T) => string): T[][] {
  if (comments.length <= 1) {
    return comments.length === 0 ? [] : [[...comments]];
  }
  return cutParts(comments, body, isLicenseLine, isLicenseText);
}
