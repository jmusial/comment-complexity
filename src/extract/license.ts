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

/** Vocabulary of the lines of a license text, from the notice to the warranty disclaimer. */
const LEGAL_LINE =
  /\b(?:copyright|licen[cs]|sublicen[cs]|spdx|warrant|liabilit|liable|permission|permit|redistribut|merchantab|infring|rights|reserved|software|notice|provided|conditions|damages|authors?|holders?|contributors?|compliance|governing|limitations?|express|implied)|©|\(c\)/i;

/**
 * Cuts license text out of a run of line comments, so an explanation right below a notice
 * (`// SPDX-License-Identifier: MIT` then `// Explains the calculation.`) is still scored.
 */
export function withoutLicense<T>(comments: readonly T[], body: (comment: T) => string): T[][] {
  if (comments.length <= 1) {
    return comments.length === 0 ? [] : [[...comments]];
  }
  return cutParts(comments, body, (line) => LEGAL_LINE.test(line), isLicenseText);
}
