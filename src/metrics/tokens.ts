import winkNLP, { type ItemToken, type PartOfSpeech, type WinkMethods } from "wink-nlp";
import model from "wink-eng-lite-web-model";

export type { PartOfSpeech };

export interface Token {
  /** As written. */
  readonly text: string;
  /** Lower-cased. */
  readonly normal: string;
  /** Universal Dependencies tag, like `NOUN` or `VERB`. */
  readonly pos: PartOfSpeech;
}

// Loading the model takes a moment, so it waits for the first comment.
let nlp: WinkMethods | undefined;

/** Splits normalized comment text into tagged tokens. Each line is tagged on its own. */
export function tokenize(text: string): Token[] {
  nlp ??= winkNLP(model, ["sbd", "pos"]);
  const { its } = nlp;
  const tokens: Token[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    nlp
      .readDoc(line)
      .tokens()
      // Typed by hand: `each` takes a union of callback types, which defeats inference.
      .each((token: ItemToken) => {
        tokens.push({
          text: token.out(),
          normal: token.out(its.normal),
          pos: token.out(its.pos) as PartOfSpeech,
        });
      });
  }
  return tokens;
}
