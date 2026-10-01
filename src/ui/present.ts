import type { ScoredComment } from "../score/analyzer";
import type { Contribution, MetricName } from "../score/composite";

/** How the lens and hover show the score; plain strings, so it is testable without VS Code. */

interface MetricInfo {
  /** Column header in the hover. */
  readonly name: string;
  /** One line on what the metric measures and why it makes reading harder. */
  readonly why: string;
  /** Few words for the lens, from the contribution's value and reason. */
  readonly brief: (contribution: Contribution) => string;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The first quoted part of a reason: the word or phrase it is about. */
const quoted = (reason: string | undefined): string | undefined => /"(.+)"/.exec(reason ?? "")?.[1];

export const METRICS: Readonly<Record<MetricName, MetricInfo>> = {
  nounStack: {
    name: "Noun stack",
    why: "Runs of nouns like “user session cache key” hide how the words relate.",
    brief: ({ value }) => `stack ${value}`,
  },
  clauseCount: {
    name: "Clauses",
    why: "Each clause is one more condition or action to keep in mind.",
    brief: ({ value }) => plural(value, "clause"),
  },
  meanZipf: {
    name: "Word frequency",
    why: "Average everyday frequency of the words (Zipf scale); lower is more unusual.",
    brief: () => "uncommon words",
  },
  minZipf: {
    name: "Rarest word",
    why: "A single rare word can stop a reader who does not know it.",
    brief: ({ reason }) => {
      const word = quoted(reason);
      return word === undefined ? "rare words" : `rare: ${word}`;
    },
  },
  lexicalDensity: {
    name: "Density",
    why: "Share of content words; telegraphic comments leave the reader to fill in the gaps.",
    brief: ({ value }) => `dense ${Math.round(value * 100)}%`,
  },
  negationCount: {
    name: "Negations",
    why: "Every “not” or “never” has to be undone in the reader's head.",
    brief: ({ value }) => plural(value, "negation"),
  },
  danglingReference: {
    name: "Dangling reference",
    why: "“It” or “this” with nothing earlier to point at leaves the reader guessing.",
    brief: ({ reason }) => {
      const word = quoted(reason);
      return word === undefined ? "unclear reference" : `unclear “${word}”`;
    },
  },
  undefinedAcronyms: {
    name: "Acronyms",
    why: "Acronyms that neither the code nor the comment spells out.",
    brief: ({ reason }) => reason?.replace(/^Undefined acronyms?: /, "acronyms: ") ?? "acronyms",
  },
  commentLength: {
    name: "Length",
    why: "Every extra word is more to read.",
    brief: ({ value }) => plural(value, "word"),
  },
  fleschKincaidGrade: {
    name: "Flesch-Kincaid",
    why: "School grade needed, from sentence length and syllables per word.",
    brief: ({ value }) => `grade ${value}`,
  },
  gunningFog: {
    name: "Gunning Fog",
    why: "Years of schooling needed, from sentence length and words of three or more syllables.",
    brief: ({ value }) => `fog ${value}`,
  },
  colemanLiau: {
    name: "Coleman-Liau",
    why: "Grade level from letters per word and sentences per 100 words.",
    brief: ({ value }) => `Coleman-Liau ${value}`,
  },
  averageSentenceLength: {
    name: "Sentence length",
    why: "Long sentences make the reader hold more before the point arrives.",
    brief: ({ value }) => `${value} words/sentence`,
  },
};

/** How many contributors the lens names. */
export const LENS_REASONS = 2;

/** Points shown with one decimal; tiny ones would round to a misleading 0.0. */
const points = (value: number): string => (value > 0 && value < 0.05 ? "<0.1" : value.toFixed(1));

/** Biggest contributors first, only those that added points. */
const contributors = ({ score }: ScoredComment): Contribution[] =>
  score.contributions.filter((c) => c.points > 0).toSorted((a, b) => b.points - a.points);

/** One line above the comment, like `complexity 3.2 · stack 3 · rare: idempotent`. */
export function lensTitle(scored: ScoredComment): string {
  const parts = [
    `complexity ${scored.score.score.toFixed(1)}`,
    // Contributors with a reason of their own say something specific; the rest fill in.
    ...contributors(scored)
      .toSorted((a, b) => Number(b.reason !== undefined) - Number(a.reason !== undefined))
      .slice(0, LENS_REASONS)
      .map((contribution) => METRICS[contribution.metric].brief(contribution)),
  ];
  if (scored.redundancy.redundant) {
    parts.push("restates name");
  }
  if (scored.comment.approx) {
    parts.push("approx");
  }
  return parts.join(" · ");
}

/** Keeps table cells on one row. */
const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** Markdown for the hover: the score, its reasons and every metric with what it measures. */
export function hoverMarkdown(scored: ScoredComment): string {
  const { score, redundancy, comment, words } = scored;
  const lines = [`**Comment complexity ${score.score.toFixed(1)} / 10** · ${score.label}`, ""];
  for (const reason of score.reasons) {
    lines.push(`- ${cell(reason)}`);
  }
  if (redundancy.redundant && redundancy.reason !== undefined) {
    lines.push(`- ${cell(redundancy.reason)}: tells the reader nothing new (not in the score)`);
  }
  if (score.reasons.length > 0 || redundancy.redundant) {
    lines.push("");
  }
  lines.push("| Metric | Value | Points | Why |", "| --- | ---: | ---: | --- |");
  for (const contribution of score.contributions) {
    const info = METRICS[contribution.metric];
    lines.push(
      `| ${info.name} | ${contribution.value} | ${points(contribution.points)} | ${info.why} |`,
    );
  }
  const notes: string[] = [];
  if (score.readability === 0) {
    notes.push(`Readability formulas skipped: ${words} words is too short for them.`);
  }
  if (comment.approx) {
    notes.push("Approximate: no grammar for this language, so comments were found by pattern.");
  }
  if (notes.length > 0) {
    lines.push("", ...notes.map((note) => `_${note}_`));
  }
  return lines.join("\n");
}

/** The diagnostic for a comment at or above the threshold, like `Comment complexity 7.2 (hard): …`. */
export function diagnosticMessage({ score }: ScoredComment): string {
  const head = `Comment complexity ${score.score.toFixed(1)} (${score.label})`;
  return score.reasons.length === 0 ? head : `${head}: ${score.reasons.join("; ")}`;
}

/** One entry of the file report. */
export interface ReportItem {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly scored: ScoredComment;
}

/** Longest comment excerpt in a report entry. */
const EXCERPT = 80;

const excerpt = (text: string): string => {
  const first = text.split("\n")[0]!;
  return first.length > EXCERPT ? `${first.slice(0, EXCERPT - 1)}…` : first;
};

/** Report entries, most complex first; equal scores keep document order. */
export function reportItems(comments: readonly ScoredComment[]): ReportItem[] {
  return comments
    .toSorted((a, b) => b.score.score - a.score.score)
    .map((scored) => ({
      label: `${scored.score.score.toFixed(1)}  ${excerpt(scored.text)}`,
      description: `line ${scored.comment.range.start.row + 1} · ${scored.score.label}${scored.comment.approx ? " · approx" : ""}`,
      detail: scored.score.reasons.join(" · "),
      scored,
    }));
}
