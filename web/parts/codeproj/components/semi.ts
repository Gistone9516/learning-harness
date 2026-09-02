// A short answer is a full answer's shape under a budget. Nothing here re-implements parsing or
// rendering — it only enforces what the directive asked for and the model may not have obeyed.

import type { Block, Composed } from "./types";

/**
 * How many blocks a short answer may keep. The same number the directive asks the model for
 * ("부품 3개 이내"), because enforcing a looser bound than the instruction states makes the
 * instruction false by exactly the difference: a four-block answer would pass in silence.
 */
const SEMI_CAP = 3;

/**
 * Put the answer first and keep it short.
 *
 * Both halves exist because the directive is a request, not a guarantee. A model that opens with
 * two paragraphs before the answer has produced something that reads exactly like the full answer
 * this layer exists to avoid, and one that ignores the block budget has produced a full answer
 * wearing a short answer's label.
 */
export function normalizeSemi(composed: Composed): Composed {
  const answers = composed.blocks.filter((b) => b.t === "answer");
  const rest = composed.blocks.filter((b) => b.t !== "answer");
  const ordered: Block[] = [...answers, ...rest];
  return { blocks: ordered.slice(0, SEMI_CAP) };
}

export { SEMI_CAP };
