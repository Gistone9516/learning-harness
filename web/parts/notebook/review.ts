// WHAT: the review tab -- a Leitner flashcard queue over due terms (N-8). The front shows the headword and an
//       answer field (N-7); the typed meaning is graded by AI in one session per visit (N-20), or 뜻 보기
//       reveals the back and counts as not known. A wrong answer re-queues the card once in this session.
//       The example on the back opens in its original language with a toggle to the stored translation (N-18).
// DEPS: web/src/ai/client, web/src/doc/doc, ./model, ./store, ./notebook (ctx type only).

import { AiSession, type AiResponse } from "../../src/ai/client";
import { el, escapeHtml, inlineMd } from "../../src/doc/doc";
import { REVIEW_CONTRACT, isDue, parseReviewGrade, review, reviewOrder, reviewPrompt, type TermData } from "./model";
import type { TermEntry } from "./store";
import type { NotebookCtx } from "./notebook";

type Outcome = "correct" | "incorrect" | "ungraded";

/** Enter right after a grade arrives must not skip the feedback the learner has not read yet. */
const NEXT_GUARD_MS = 400;

export function mountReview(root: HTMLElement, ctx: NotebookCtx) {
  const { L, store } = ctx;
  const stage = el("div", "lh-nb-review");
  root.appendChild(stage);

  let queue: TermEntry[] = [];
  let requeued = new Set<string>();
  let doneCount = 0;
  let busy = false;
  // N-20: one grading session per visit to this tab; start() opens a fresh one.
  let session: AiSession | null = null;
  const grader = ctx.props.review;
  const canGrade = () => !!(ctx.ai && grader);

  function empty(text: string): void {
    stage.innerHTML = "";
    stage.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", text));
  }

  async function start(): Promise<void> {
    const now = ctx.now();
    queue = reviewOrder((await store.listTerms()).filter((e) => isDue(e.summary, now)), (e) => e.summary);
    requeued = new Set();
    doneCount = 0;
    session = ctx.ai ? new AiSession(ctx.ai) : null;
    show();
  }

  // Keyboard outside the answer field: Enter/Space = 다음 once graded, E = example language (N-18).
  let keys: { next: HTMLButtonElement | null; lang: HTMLButtonElement | null; readyAt: number } | null = null;
  document.addEventListener("keydown", (e) => {
    if (!keys || root.hidden || !root.isConnected) return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.key === "Enter" || e.key === " ") && keys.next) {
      e.preventDefault();
      if (ctx.now() >= keys.readyAt) keys.next.click();
    } else if ((e.key === "e" || e.key === "E") && keys.lang && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); keys.lang.click(); }
  });

  // N-18: the example opens in its original language; the toggle swaps it for the stored translation.
  // No translation stored -> no toggle (nothing to switch to; no AI call from a review card).
  function exampleBox(ex: { en: string; ko?: string }): { box: HTMLElement; lang: HTMLButtonElement | null } {
    const box = el("div", "lh-nb-example");
    const text = el("p", "lh-nb-example-en", ex.en);
    box.appendChild(text);
    const ko = ex.ko;
    if (!ko) return { box, lang: null };
    box.classList.add("lh-nb-example--toggle");
    const btn = el("button", "lh-qz-lang lh-nb-example-lang");
    btn.type = "button";
    btn.title = L.exampleLangKey;
    btn.setAttribute("aria-label", `${L.exampleLangPrimary} / ${L.exampleLangSecondary}`);
    const segA = el("span", "lh-qz-seg", L.exampleLangPrimary);
    const segB = el("span", "lh-qz-seg", L.exampleLangSecondary);
    btn.append(segA, segB);
    box.appendChild(btn);
    let secondary = false;
    const paint = () => {
      text.textContent = secondary ? ko : ex.en;
      text.className = secondary ? "lh-nb-example-ko" : "lh-nb-example-en";
      segA.classList.toggle("lh-qz-seg--on", !secondary);
      segB.classList.toggle("lh-qz-seg--on", secondary);
      btn.setAttribute("aria-pressed", String(secondary));
      box.classList.toggle("lh-nb-example--secondary", secondary);
    };
    btn.addEventListener("click", () => { secondary = !secondary; paint(); });
    paint();
    return { box, lang: btn };
  }

  /** One grading request in the visit's session; the first one carries the role text and contract. */
  async function grade(d: TermData, answer: string): Promise<{ outcome: Outcome; feedback: string }> {
    if (!session || !grader) return { outcome: "ungraded", feedback: L.reviewUngraded };
    const s = session;
    const prompt = reviewPrompt(d, answer);
    // live: one long-lived process answers every card of the visit (ai-mode §4.1).
    const req = { model: grader.model, effort: grader.effort ?? "low", live: true };
    const seeded = (): Promise<AiResponse> => { s.reset(); return s.send({ ...req, prompt, system: `${grader.system}\n\n${REVIEW_CONTRACT}` }); };
    let res = s.sessionId ? await s.send({ ...req, prompt }) : await seeded();
    if (!res.ok && res.error_kind === "resume_missing") res = await seeded();
    const g = res.ok ? parseReviewGrade(res.text) : null;
    return g ? { outcome: g.verdict, feedback: g.feedback } : { outcome: "ungraded", feedback: L.reviewUngraded };
  }

  function show(): void {
    const cur = queue[0];
    keys = null;
    if (!cur) { empty(doneCount ? L.reviewDone : L.reviewEmpty); return; }
    stage.innerHTML = "";
    const progress = el("div", "lh-nb-review-progress", `${queue.length} ${L.reviewLeft}`);
    const card = el("div", "lh-nb-card");
    const front = el("div", "lh-nb-card-front");
    front.appendChild(el("div", "lh-nb-card-word", String(cur.summary.headword)));   // N-7: headword only
    front.appendChild(el("span", "lh-nb-badge", L.types[cur.summary.type] ?? cur.summary.type));
    card.appendChild(front);
    // N-22: the same two-step delete as the dictionary entry; the card leaves this session's queue too.
    const delBtn = el("button", "lh-nb-btn lh-nb-btn--quiet lh-nb-card-del", L.deleteTerm);
    delBtn.type = "button";
    delBtn.addEventListener("click", async () => {
      if (busy) return;
      if (!delBtn.dataset["armed"]) { delBtn.dataset["armed"] = "1"; delBtn.textContent = L.confirmDelete; delBtn.classList.add("lh-nb-btn--armed"); return; }
      if (!(await store.removeTerm(cur.id))) return;
      queue = queue.filter((e) => e.id !== cur.id);
      requeued.delete(cur.id);
      ctx.refreshCounts();
      show();
    });
    card.appendChild(delBtn);

    const answerRow = el("div", "lh-nb-answer");
    const input = document.createElement("input");
    input.type = "text"; input.className = "lh-nb-input lh-nb-answer-input";
    input.placeholder = L.reviewInput; input.setAttribute("aria-label", L.reviewInput);
    input.autocomplete = "off";
    const submitBtn = el("button", "lh-nb-btn lh-nb-btn--primary", L.reviewSubmit);
    submitBtn.type = "button"; submitBtn.disabled = true;
    answerRow.append(input, submitBtn);
    if (canGrade()) card.appendChild(answerRow);

    const back = el("div", "lh-nb-card-back");
    back.hidden = true;
    card.appendChild(back);

    const actions = el("div", "lh-nb-review-actions");
    const showBtn = el("button", "lh-nb-btn" + (canGrade() ? "" : " lh-nb-btn--primary lh-nb-btn--wide"), L.reviewShow);
    showBtn.type = "button";
    const nextBtn = el("button", "lh-nb-btn lh-nb-btn--primary lh-nb-btn--wide", L.reviewNext);
    nextBtn.type = "button"; nextBtn.hidden = true;
    actions.append(showBtn, nextBtn);
    const hint = el("p", "lh-nb-hint lh-nb-hint--center", canGrade() ? L.reviewKeys : L.reviewKeysAfter);
    stage.append(progress, card, actions, hint);
    keys = { next: null, lang: null, readyAt: 0 };
    const mine = keys;
    if (canGrade()) input.focus(); else showBtn.focus();

    input.addEventListener("input", () => { submitBtn.disabled = busy || !input.value.trim(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); void submit(); } });
    submitBtn.addEventListener("click", () => void submit());
    // 뜻 보기 = "I do not know" (N-8); with no grader at all it only reveals and leaves the record alone.
    showBtn.addEventListener("click", () => void finish(canGrade() ? "incorrect" : "ungraded", null));
    nextBtn.addEventListener("click", () => advance(cur, lastOutcome));

    let lastOutcome: Outcome = "ungraded";

    async function submit(): Promise<void> {
      const answer = input.value.trim();
      if (!answer || busy) return;
      busy = true;
      input.disabled = true; submitBtn.disabled = true; showBtn.disabled = true;
      submitBtn.textContent = L.reviewGrading; card.setAttribute("aria-busy", "true");
      try {
        const d = await store.getTerm(cur.id);
        const r = d ? await grade(d, answer) : { outcome: "ungraded" as Outcome, feedback: L.reviewUngraded };
        await finish(r.outcome, r.feedback);
      } finally {
        busy = false;
        submitBtn.textContent = L.reviewSubmit; card.removeAttribute("aria-busy");
      }
    }

    /** Save the outcome at once (N-8), then reveal the back with the verdict on top. */
    async function finish(outcome: Outcome, feedback: string | null): Promise<void> {
      lastOutcome = outcome;
      const d = await store.getTerm(cur.id);
      if (d && outcome !== "ungraded") await store.putTerm(cur.id, { ...d, srs: review(d.srs, outcome === "correct", ctx.now(), ctx.props.srs?.intervalsDays) });
      input.disabled = true; submitBtn.hidden = true; showBtn.hidden = true;
      back.innerHTML = "";
      const v = el("div", "lh-nb-verdict" + (outcome === "correct" ? " lh-nb-verdict--ok" : outcome === "incorrect" ? " lh-nb-verdict--bad" : ""));
      v.setAttribute("role", "status");
      const label = feedback === null ? L.reviewWrong : outcome === "correct" ? L.reviewCorrect : outcome === "incorrect" ? L.reviewIncorrect : "";
      if (label) v.appendChild(el("span", "lh-nb-badge" + (outcome === "correct" ? " lh-nb-badge--ok" : " lh-nb-badge--bad"), label));
      if (feedback) { const p = el("p", "lh-nb-verdict-text"); p.innerHTML = inlineMd(escapeHtml(feedback)); v.appendChild(p); }
      back.appendChild(v);
      if (d?.pos || d?.ipa) back.appendChild(el("div", "lh-nb-card-sub", [d.pos, d.ipa].filter(Boolean).join("  ")));
      if (d?.expansion) back.appendChild(el("div", "lh-nb-card-exp", d.expansion));
      const ol = el("ol", "lh-nb-senses");
      for (const s of d?.senses ?? []) { const li = el("li"); li.innerHTML = inlineMd(escapeHtml(s.gloss)); ol.appendChild(li); }
      if (!d?.senses.length && cur.summary.gloss) ol.appendChild(el("li", undefined, String(cur.summary.gloss)));
      back.appendChild(ol);
      const ex = d?.examples[0];
      const lang = ex ? exampleBox(ex) : null;
      if (lang) back.appendChild(lang.box);
      back.hidden = false;
      nextBtn.hidden = false;
      hint.textContent = L.reviewKeysAfter;
      if (keys === mine) { mine.next = nextBtn; mine.lang = lang?.lang ?? null; mine.readyAt = ctx.now() + NEXT_GUARD_MS; }
      nextBtn.focus();
      ctx.refreshCounts();
    }
  }

  function advance(cur: TermEntry, outcome: Outcome): void {
    if (busy || queue[0] !== cur) return;
    queue.shift();
    doneCount++;
    if (outcome === "incorrect" && !requeued.has(cur.id)) { requeued.add(cur.id); queue.push(cur); }
    show();
  }

  empty(L.reviewEmpty);
  return { start };
}
