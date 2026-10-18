// WHAT: one quiz problem card -- primary-language first with a per-card language toggle (Q-4), option
//       buttons / blanks / text input, position-based grading of a translated judge item (Q-3), and the
//       reveal (verdict, answer, explanation), flag, ask and delete controls.
// DEPS: web/src/doc/doc, ../conceptprob (gradeProblem), ./model, ./quiz (ctx type only).

import { el, renderAiBody } from "../../src/doc/doc";
import { gradeProblem } from "../conceptprob/conceptprob";
import { markDeleted, parseTranslation, setFlag, stemOf, TRANSLATE_CONTRACT, validKo, type AnswerState, type FrontKo, type QuizProblem } from "./model";
import type { QuizCtx } from "./quiz";

export interface CardOpts {
  num: number;
  total: number;
  reveal: boolean;                       // show verdict + answer + explanation
  answer?: AnswerState;
  locked?: boolean;                      // answered and graded: inputs disabled
  onSubmit: (value: string | string[]) => void;
  onDeleted?: () => void;
  startSecondary?: boolean;              // reopen in the language the learner last chose for this card
  onLang?: (secondary: boolean) => void;
}
export interface CardHandle { el: HTMLElement; choose(i: number): void; submit(): void; toggleLang(): void }

const GLYPHS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const hasMd = (s: string) => /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>\s|\||:::|```)/.test(s) || /\*\*|==|`/.test(s);

export function answerText(p: QuizProblem, ko?: FrontKo | null): string {
  const sp = p.answer_spec;
  if (p.grade_mode === "cloze" && sp.blanks) return sp.blanks.map((b) => b[0]).join(", ");
  if (p.grade_mode === "keyword" && sp.required_keywords) return sp.required_keywords.map((g) => g[0]).join(", ");
  const acc = (sp.accepted ?? [])[0] ?? "";
  const opts = p.front["options"];
  if (ko?.options && Array.isArray(opts)) {
    const i = (opts as string[]).findIndex((o) => o.trim().toLowerCase() === acc.trim().toLowerCase());
    if (i >= 0 && ko.options[i]) return `${acc}\n${ko.options[i]}`;
  }
  return acc;
}

export function renderQuizCard(ctx: QuizCtx, p: QuizProblem, o: CardOpts): CardHandle {
  const { L } = ctx;
  const rw = ctx.props.rewriteFront ?? ((s: string) => s);
  let lang: "primary" | "secondary" = "primary";
  let ko: FrontKo | null = validKo(p, p.front_ko) ? p.front_ko : null;
  const enOptions = Array.isArray(p.front["options"]) ? (p.front["options"] as unknown[]).map((x) => String(x)) : null;
  let chosen = -1;
  if (o.answer && enOptions && typeof o.answer.value === "string") chosen = enOptions.indexOf(o.answer.value);

  const card = el("article", "lh-qz-card");
  card.dataset["cardId"] = p.card_id;

  // ── meta row ──
  const meta = el("div", "lh-qz-meta");
  meta.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", ctx.areaLabel(p.area)));
  meta.appendChild(el("span", "lh-qz-concept", ctx.conceptTitle(p.concept_id)));
  meta.appendChild(el("span", "lh-qz-num", `${o.num} / ${o.total}`));
  const hist = el("span", "lh-qz-hist");
  for (const v of (ctx.log().items[p.card_id]?.h ?? []).slice(-5)) hist.appendChild(el("span", "lh-qz-dot lh-qz-dot--" + v, v === "c" ? "✓" : "✗"));
  meta.appendChild(hist);
  // Two fixed segments showing the language you are IN (not the one you would switch to).
  const langBtn = el("button", "lh-qz-lang");
  langBtn.type = "button";
  const segA = el("span", "lh-qz-seg", L.langPrimary);
  const segB = el("span", "lh-qz-seg", L.langSecondary);
  langBtn.append(segA, segB);
  const flagBtn = el("button", "lh-nb-btn lh-nb-btn--quiet lh-qz-flag");
  flagBtn.type = "button";
  meta.append(langBtn, flagBtn);
  card.appendChild(meta);

  const stem = el("div", "lh-qz-stem");
  const body = el("div", "lh-qz-body");
  card.append(stem, body);
  const nudge = el("p", "lh-qz-nudge");
  nudge.setAttribute("aria-live", "polite");
  card.appendChild(nudge);
  const result = el("div", "lh-qz-result");
  const actions = el("div", "lh-nb-actions lh-qz-actions");
  card.append(result, actions);

  const inputs: HTMLInputElement[] = [];
  const optBtns: HTMLButtonElement[] = [];

  function paintLang(): void {
    const f = lang === "secondary" && ko ? ko : (p.front as FrontKo);
    const s = rw(stemOf(f));
    stem.innerHTML = "";
    if (p.grade_mode === "cloze") stem.textContent = s.replace(/\{\{\d+\}\}/g, " ( ___ ) ");
    else if (hasMd(s)) stem.appendChild(renderAiBody(s));
    else stem.textContent = s;
    const opts = lang === "secondary" && ko?.options ? ko.options : enOptions;
    optBtns.forEach((b, i) => { b.querySelector(".lh-qz-opt-text")!.textContent = rw(opts?.[i] ?? ""); });
    segA.classList.toggle("lh-qz-seg--on", lang === "primary");
    segB.classList.toggle("lh-qz-seg--on", lang === "secondary");
    segB.textContent = L.langSecondary;
    langBtn.setAttribute("aria-pressed", String(lang === "secondary"));
    langBtn.setAttribute("aria-label", `${L.langPrimary} / ${L.langSecondary}`);
    langBtn.title = L.keys;
    card.classList.toggle("lh-qz-card--secondary", lang === "secondary");
  }

  // ── answer area ──
  if (p.type === "judge" && enOptions) {
    const list = el("div", "lh-qz-options");
    enOptions.forEach((_, i) => {
      const b = el("button", "lh-qz-opt");
      b.type = "button";
      b.appendChild(el("span", "lh-qz-opt-glyph", GLYPHS[i] ?? String(i + 1)));
      b.appendChild(el("span", "lh-qz-opt-text"));
      b.addEventListener("click", () => choose(i));
      list.appendChild(b);
      optBtns.push(b);
    });
    body.appendChild(list);
  } else if (p.grade_mode === "cloze") {
    const row = el("div", "lh-qz-blanks");
    (p.answer_spec.blanks ?? []).forEach((_, i) => {
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = "lh-nb-input lh-qz-input";
      inp.placeholder = `${L.blank} ${i + 1}`; inp.setAttribute("aria-label", inp.placeholder);
      if (Array.isArray(o.answer?.value)) inp.value = (o.answer!.value as string[])[i] ?? "";
      inputs.push(inp); row.appendChild(inp);
    });
    body.appendChild(row);
  } else {
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "lh-nb-input lh-qz-input";
    inp.placeholder = L.answerPlaceholder; inp.setAttribute("aria-label", L.answerPlaceholder);
    if (typeof o.answer?.value === "string") inp.value = o.answer.value;
    inputs.push(inp);
    body.appendChild(inp);
  }
  for (const inp of inputs) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });

  function paintChoice(): void {
    optBtns.forEach((b, i) => b.classList.toggle("lh-qz-opt--sel", i === chosen));
  }
  function choose(i: number): void {
    if (o.locked || i < 0 || i >= optBtns.length) return;
    chosen = i; paintChoice(); nudge.textContent = "";
  }
  function value(): string | string[] {
    if (optBtns.length) return chosen >= 0 && enOptions ? enOptions[chosen] : "";   // Q-3: always the primary option
    if (p.grade_mode === "cloze") return inputs.map((x) => x.value);
    return inputs[0]?.value ?? "";
  }
  function submit(): void {
    if (o.locked) return;
    const v = value();
    if ((Array.isArray(v) && v.every((x) => !x.trim())) || (!Array.isArray(v) && !v.trim())) {
      nudge.textContent = optBtns.length ? L.pickFirst : L.typeFirst;   // an empty submit says why nothing happened
      return;
    }
    o.onSubmit(v);
  }

  async function toggleLang(): Promise<void> {
    if (ctx.props.langToggle === false) return;
    if (lang === "secondary") { lang = "primary"; paintLang(); o.onLang?.(false); return; }
    if (!ko) {
      const set = await ctx.getSet(p.concept_id);
      const stored = set.ko[p.card_id];
      if (validKo(p, stored)) ko = stored;
      else if (ctx.ai) {
        langBtn.disabled = true; segB.textContent = L.translating;
        const tr = ctx.props.translate;
        const src: Record<string, unknown> = {};
        for (const k of ["scenario", "prompt", "text"]) if (typeof p.front[k] === "string") src[k] = p.front[k];
        if (enOptions) src["options"] = enOptions;
        const res = await ctx.ai.ai({ system: `${tr?.system ?? ""}\n\n${TRANSLATE_CONTRACT}`, prompt: JSON.stringify(src), model: tr?.model, effort: tr?.effort ?? "low" });
        langBtn.disabled = false;
        ko = res.ok ? parseTranslation(res.text, p) : null;
        if (ko) { set.ko[p.card_id] = ko; p.front_ko = ko; await ctx.putSet(p.concept_id, set); }
        else { segB.textContent = L.translateFail; return; }
      } else { segB.textContent = L.translateFail; return; }
    }
    lang = "secondary"; paintLang(); o.onLang?.(true);
  }
  langBtn.addEventListener("click", () => void toggleLang());
  langBtn.hidden = ctx.props.langToggle === false;
  if (!ko && !ctx.ai) langBtn.title = L.aiOff;

  function paintFlag(): void {
    const on = !!ctx.log().items[p.card_id]?.f;
    flagBtn.textContent = (on ? "★ " : "☆ ") + (on ? L.unflag : L.flag);
    flagBtn.setAttribute("aria-pressed", String(on));
  }
  flagBtn.addEventListener("click", async () => {
    await ctx.saveLog(setFlag(ctx.log(), p.card_id, !ctx.log().items[p.card_id]?.f));
    paintFlag();
  });

  // ── reveal ──
  function paintResult(): void {
    result.innerHTML = "";
    if (!o.reveal || !o.answer?.verdict) return;
    const ok = o.answer.verdict === "correct";
    result.appendChild(el("div", "lh-qz-verdict lh-qz-verdict--" + (ok ? "ok" : "bad"), ok ? L.verdictRight : L.verdictWrong));
    if (optBtns.length && enOptions) {
      const acc = (p.answer_spec.accepted ?? []).map((a) => a.trim().toLowerCase());
      optBtns.forEach((b, i) => {
        b.classList.remove("lh-qz-opt--sel");
        if (acc.includes(enOptions[i].trim().toLowerCase())) b.classList.add("lh-qz-opt--right");
        else if (i === chosen) b.classList.add("lh-qz-opt--wrong");
      });
    }
    const ans = el("div", "lh-qz-answer");
    ans.appendChild(el("span", "lh-cm-line-k", L.answer));
    ans.appendChild(el("span", "lh-qz-answer-v", rw(answerText(p, ko))));
    result.appendChild(ans);
    if (p.explain) {
      const ex = el("div", "lh-qz-explain");
      ex.appendChild(el("span", "lh-cm-line-k", L.explain));
      ex.appendChild(renderAiBody(p.explain));
      result.appendChild(ex);
    }
  }

  // ── actions: ask, delete ──
  const ask = ctx.props.askElsewhere;
  if (ask) {
    const b = el("button", "lh-nb-btn", L.ask); b.type = "button";
    b.addEventListener("click", () => ask.onAsk(rw(stemOf(p.front as FrontKo)) + (enOptions ? "\n" + enOptions.map((x, i) => `${GLYPHS[i]}. ${rw(x)}`).join("\n") : "")));
    actions.appendChild(b);
  }
  const del = el("button", "lh-nb-btn lh-nb-btn--quiet", L.deleteProblem); del.type = "button";
  const delBox = el("div", "lh-qz-delbox"); delBox.hidden = true;
  const reason = document.createElement("input"); reason.type = "text"; reason.className = "lh-nb-input"; reason.placeholder = L.deleteReason;
  reason.setAttribute("aria-label", L.deleteReason);
  const confirm = el("button", "lh-nb-btn lh-nb-btn--armed", L.deleteConfirm); confirm.type = "button";
  delBox.append(reason, confirm);
  del.addEventListener("click", () => { delBox.hidden = !delBox.hidden; if (!delBox.hidden) reason.focus(); });
  confirm.addEventListener("click", async () => {
    await ctx.saveLog(markDeleted(ctx.log(), p.card_id, reason.value.trim() || "-"));
    o.onDeleted?.();
  });
  actions.appendChild(del);
  card.appendChild(delBox);

  if (o.locked) { optBtns.forEach((b) => (b.disabled = true)); inputs.forEach((x) => (x.disabled = true)); }
  if (o.startSecondary && ko) lang = "secondary";
  paintLang(); paintChoice(); paintFlag(); paintResult();
  return { el: card, choose, submit, toggleLang: () => void toggleLang() };
}

/** Grade one answer (token 0). */
export function grade(p: QuizProblem, value: string | string[]): "correct" | "incorrect" {
  return gradeProblem(p, value).verdict;
}
