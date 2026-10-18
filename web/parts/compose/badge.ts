// WHAT: the verdict badge shared by the practice, revise and history views (one mapping, W-2).
// DEPS: web/src/doc/doc, ./model (types), ./compose (labels type only).

import { el } from "../../src/doc/doc";
import type { Verdict } from "./model";
import type { ComposeLabels } from "./compose";

const CLASS: Record<Verdict, string> = { correct: " lh-nb-badge--ok", partial: " lh-cm-badge--partial", incorrect: " lh-cm-badge--bad", ungraded: "" };

export function verdictBadge(L: ComposeLabels, v: Verdict | "none" | null): HTMLElement {
  if (!v || v === "none") return el("span", "lh-nb-badge", "—");
  return el("span", "lh-nb-badge" + CLASS[v], L[v]);
}
