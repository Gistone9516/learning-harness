// WHAT: the practice tab -- set up a batch (mode, level, unit, expressions), write, get graded, revise.
//       Saves the attempt before grading (W-4), resumes the task's session on a revision (W-5), records
//       an unusable grade as ungraded (W-2), and offers self-judging without AI (W-9).
// DEPS: web/src/ai/client, web/src/doc/doc, ../notebook/model, ./model, ./compose (ctx type only).

import { AiSession, type AiResponse } from "../../src/ai/client";
import { el, escapeHtml, inlineMd } from "../../src/doc/doc";
import { curriculumText, isDue, savedTermsBlock, slugTerm } from "../notebook/model";
import {
  GEN_CONTRACT, GRADE_CONTRACT, MODES, isGraded, isPass, parseGrade, parseTasks, scheduleTask, taskId, wordDiff,
  type Attempt, type ComposeError, type Mode, type TaskData,
} from "./model";
import { verdictBadge as badgeOf } from "./badge";
import type { ComposeCtx } from "./compose";

type Outline = { areas?: { key: string; label: string }[]; conceptOutline?: Record<string, { title: string }[]> };

export function mountPractice(root: HTMLElement, ctx: ComposeCtx) {
  const { L, store, props } = ctx;
  const modes = (props.modes?.length ? props.modes : MODES).filter((m) => MODES.includes(m));
  const batchSize = props.batch ?? 5;

  // ── setup column ──
  const side = el("aside", "lh-cm-side");
  const modeRow = el("div", "lh-nb-filters lh-cm-modes");
  const selRow = el("div", "lh-cm-selects");
  const levelSel = document.createElement("select");
  levelSel.className = "lh-nb-input lh-nb-select";
  levelSel.setAttribute("aria-label", L.level);
  for (const lv of props.levels ?? []) { const o = document.createElement("option"); o.value = lv.key; o.textContent = lv.label; levelSel.appendChild(o); }
  levelSel.hidden = !(props.levels?.length);
  const unitSel = document.createElement("select");
  unitSel.className = "lh-nb-input lh-nb-select";
  unitSel.setAttribute("aria-label", L.unit);
  unitSel.hidden = !props.outline;
  selRow.append(levelSel, unitSel);
  const wordsBox = el("div", "lh-cm-words");
  const wordsHead = el("div", "lh-cm-words-head");
  wordsHead.appendChild(el("span", "lh-nb-sec-h", L.words));
  const shuffleBtn = el("button", "lh-nb-link", L.shuffleWords);
  shuffleBtn.type = "button";
  wordsHead.appendChild(shuffleBtn);
  const wordChips = el("div", "lh-nb-chips");
  wordsBox.append(wordsHead, wordChips);
  const genBtn = el("button", "lh-nb-btn lh-nb-btn--primary lh-cm-gen", L.generate);
  genBtn.type = "button";
  const genMsg = el("p", "lh-nb-hint");
  genMsg.setAttribute("role", "status");
  const batchHead = el("h3", "lh-nb-sec-h", L.batch);
  const batchList = el("ul", "lh-nb-thread-list lh-cm-batch");
  side.append(modeRow, selRow, wordsBox, genBtn, genMsg, batchHead, batchList);

  // ── task column ──
  const main = el("div", "lh-cm-main");
  root.append(side, main);

  let mode: Mode = (ctx.recall("mode") as Mode) ?? modes[0];
  if (!modes.includes(mode)) mode = modes[0];
  let words: string[] = [];
  let focus: string[] = [];
  let batch: string[] = [];
  try { batch = JSON.parse(ctx.recall("batch") ?? "[]") as string[]; } catch { batch = []; }
  let openId: string | null = null;
  let openData: TaskData | null = null;
  let busy = false;
  let outline: Outline | null = null;

  const modeBtns = modes.map((m) => {
    const b = el("button", "lh-nb-filter", L.modes[m] ?? m);
    b.type = "button";
    b.addEventListener("click", () => { mode = m; ctx.remember("mode", m); paintSetup(); });
    modeRow.appendChild(b);
    return { m, b };
  });

  function paintSetup(): void {
    for (const { m, b } of modeBtns) { b.classList.toggle("lh-nb-filter--on", m === mode); b.setAttribute("aria-pressed", String(m === mode)); }
    wordsBox.hidden = mode !== "words";
    genBtn.textContent = mode === "free" ? L.modes["free"] ?? "free" : L.generate;
    genBtn.disabled = busy || (mode !== "free" && !ctx.ai);
    genMsg.textContent = mode !== "free" && !ctx.ai ? L.aiOff : "";
    paintWords();
  }

  function paintWords(): void {
    wordChips.innerHTML = "";
    if (!words.length) { wordChips.appendChild(el("span", "lh-nb-hint", L.wordsEmpty)); return; }
    for (const w of words) {
      const c = el("button", "lh-nb-chip", w + " ×");
      c.type = "button";
      c.addEventListener("click", () => { words = words.filter((x) => x !== w); paintWords(); });
      wordChips.appendChild(c);
    }
  }

  /** Pick expressions to practise: due first, then the most looked-up, a little shuffled. */
  async function pickWords(auto: boolean, n = 3): Promise<void> {
    const now = ctx.now();
    const pool = (await ctx.terms.listTerms()).filter((e) => !e.summary.known);
    if (auto && words.length) return;   // words handed over meanwhile win over the automatic pick
    const ranked = pool.slice().sort((a, b) =>
      Number(isDue(b.summary, now)) - Number(isDue(a.summary, now)) || b.summary.lookups - a.summary.lookups);
    const top = ranked.slice(0, 30);
    for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [top[i], top[j]] = [top[j], top[i]]; }
    words = top.slice(0, n).map((e) => String(e.summary.headword));
    paintWords();
  }

  async function loadOutline(): Promise<void> {
    if (!props.outline) return;
    outline = await store.getDoc<Outline>(props.outline.doc);
    unitSel.innerHTML = "";
    const all = document.createElement("option"); all.value = ""; all.textContent = L.allUnits; unitSel.appendChild(all);
    for (const a of outline?.areas ?? []) { const o = document.createElement("option"); o.value = a.key; o.textContent = a.label; unitSel.appendChild(o); }
    unitSel.value = ctx.recall("unit") ?? "";
  }

  async function paintBatch(): Promise<void> {
    batchList.innerHTML = "";
    if (!batch.length) { batchList.appendChild(el("li", "lh-nb-empty", L.batchEmpty)); return; }
    const index = new Map((await store.list()).map((e) => [e.id, e]));
    batch.forEach((id, i) => {
      const e = index.get(id);
      if (!e) return;
      const li = el("li");
      const b = el("button", "lh-nb-thread" + (id === openId ? " lh-nb-thread--on" : ""));
      b.type = "button";
      b.appendChild(el("span", "lh-nb-thread-title", `${i + 1}. ${e.summary.prompt}`));
      const meta = el("span", "lh-nb-thread-meta");
      meta.appendChild(verdictBadge(e.summary.verdict === "none" ? null : e.summary.verdict));
      b.appendChild(meta);
      b.addEventListener("click", () => void openTask(id));
      li.appendChild(b);
      batchList.appendChild(li);
    });
  }

  const verdictBadge = (v: Attempt["verdict"]): HTMLElement => badgeOf(L, v);

  function speakBtn(text: string): HTMLElement | null {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return null;   // W-12
    const b = el("button", "lh-nb-link lh-cm-speak", "🔊 " + L.speak);
    b.type = "button";
    b.addEventListener("click", () => {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = props.speechLang ?? "en-US";
      synth.speak(u);
    });
    return b;
  }

  function line(label: string, text: string, speak = false): HTMLElement {
    const row = el("div", "lh-cm-line");
    row.appendChild(el("span", "lh-cm-line-k", label));
    const v = el("span", "lh-cm-line-v", text);
    row.appendChild(v);
    if (speak) { const s = speakBtn(text); if (s) row.appendChild(s); }
    return row;
  }

  // W-13: the corrected pattern used in new sentences; translation muted under each. Not captured.
  function examplesList(e: ComposeError): HTMLElement | null {
    if (!e.examples?.length) return null;
    const ul = el("ul", "lh-cm-examples");
    for (const x of e.examples) {
      const li = el("li");
      li.appendChild(el("span", "lh-cm-ex-en", x.en));
      if (x.ko) li.appendChild(el("span", "lh-cm-ex-ko", x.ko));
      ul.appendChild(li);
    }
    return ul;
  }

  function renderAttempt(a: Attempt, isLast: boolean): HTMLElement {
    const box = el("div", "lh-cm-attempt");
    const head = el("div", "lh-cm-attempt-head");
    head.appendChild(a.verdict === null && busy && isLast ? el("span", "lh-nb-badge", L.pending) : verdictBadge(a.verdict));
    if (a.self) head.appendChild(el("span", "lh-nb-hint", "self"));
    box.appendChild(head);
    if (a.corrected && a.corrected !== a.text) {
      const diff = el("p", "lh-cm-diff");
      for (const op of wordDiff(a.text, a.corrected)) {
        const tag = op.op === "del" ? "del" : op.op === "ins" ? "ins" : "span";
        diff.appendChild(el(tag as "span", "lh-cm-" + op.op, op.text));
        diff.appendChild(document.createTextNode(" "));
      }
      // The diff already shows the corrected sentence; only its read-aloud is added, not a second copy.
      const s = speakBtn(a.corrected);
      if (s) diff.appendChild(s);
      box.appendChild(diff);
    } else {
      box.appendChild(line(L.yours, a.text, a.verdict === "correct"));
    }
    if (a.natural && a.natural !== a.corrected) box.appendChild(line(L.natural, a.natural, true));
    if (a.reason) { const p = el("p", "lh-cm-reason"); p.innerHTML = inlineMd(escapeHtml(a.reason)); box.appendChild(p); }
    if (a.errors?.length) {
      const ul = el("ul", "lh-cm-errors");
      for (const e of a.errors) {
        const li = el("li");
        if (e.category) li.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", e.category));
        if (e.from || e.to) li.appendChild(el("span", "lh-cm-fix", `${e.from} → ${e.to}`));
        if (e.explain) { const x = el("span", "lh-cm-explain"); x.innerHTML = inlineMd(escapeHtml(e.explain)); li.appendChild(x); }
        const ex = examplesList(e);
        if (ex) li.appendChild(ex);
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    if (a.terms?.length) {
      const chips = el("div", "lh-nb-chips");
      chips.appendChild(el("span", "lh-nb-chips-label", L.captured));
      for (const t of a.terms) chips.appendChild(el("span", "lh-nb-chip lh-nb-chip--flat", t));
      box.appendChild(chips);
    }
    // W-9: no AI -> the learner judges against the model answer: right or wrong only (no grader to call a slip minor).
    if (a.verdict === null && !busy && isLast && !ctx.ai) {
      const sj = el("div", "lh-cm-self");
      sj.appendChild(el("p", "lh-nb-hint", L.selfJudge));
      if (openData?.model_answer) sj.appendChild(line(L.hintAnswer, openData.model_answer, true));
      const ok = el("button", "lh-nb-btn lh-nb-btn--ok", L.selfRight); ok.type = "button";
      const ng = el("button", "lh-nb-btn lh-nb-btn--bad", L.selfWrong); ng.type = "button";
      ok.addEventListener("click", () => void selfJudge(true));
      ng.addEventListener("click", () => void selfJudge(false));
      const row = el("div", "lh-nb-actions"); row.append(ng, ok);
      sj.appendChild(row);
      box.appendChild(sj);
    }
    return box;
  }

  function paintTask(): void {
    main.innerHTML = "";
    if (!openData || !openId) { main.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", ctx.ai ? L.batchEmpty : L.aiOff)); return; }
    const d = openData;
    const card = el("section", "lh-cm-card");
    const top = el("div", "lh-cm-card-top");
    top.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", L.modes[d.mode] ?? d.mode));
    if (d.unit) top.appendChild(el("span", "lh-nb-hint", outline?.areas?.find((a) => a.key === d.unit)?.label ?? d.unit));
    const del = el("button", "lh-nb-btn lh-nb-btn--quiet", L.deleteTask); del.type = "button";
    del.addEventListener("click", async () => {
      if (!del.dataset["armed"]) { del.dataset["armed"] = "1"; del.textContent = L.confirmDelete; del.classList.add("lh-nb-btn--armed"); return; }
      const id = openId!;
      await store.remove(id);
      batch = batch.filter((x) => x !== id); ctx.remember("batch", JSON.stringify(batch));
      openId = null; openData = null; ctx.remember("task", null);
      paintTask(); void paintBatch(); ctx.refreshCounts();
    });
    top.appendChild(del);
    card.appendChild(top);
    card.appendChild(el("p", "lh-cm-prompt", d.prompt));
    if (d.words.length) {
      const chips = el("div", "lh-nb-chips");
      for (const w of d.words) chips.appendChild(el("span", "lh-nb-chip lh-nb-chip--flat", w));
      card.appendChild(chips);
    }

    // C6: hint ladder
    const hints = el("div", "lh-cm-hints");
    const hintOut = el("div", "lh-cm-hint-out");
    const addHint = (label: string, show: () => void, enabled: boolean) => {
      const b = el("button", "lh-nb-btn", label); b.type = "button"; b.disabled = !enabled;
      b.addEventListener("click", () => { show(); b.disabled = true; });
      hints.appendChild(b);
    };
    addHint(L.hintExpressions, () => hintOut.appendChild(line(L.hintExpressions, d.expressions.join(" · "))), d.expressions.length > 0);
    addHint(L.hintSkeleton, () => hintOut.appendChild(line(L.hintSkeleton, d.skeleton ?? "")), !!d.skeleton);
    addHint(L.hintAnswer, () => {
      hintOut.appendChild(line(L.hintAnswer, d.model_answer ?? "", true));
      if (!d.revealed) { d.revealed = true; void store.put(openId!, d, ctx.now()); }
    }, !!d.model_answer);
    if (d.mode !== "free") card.append(hints, hintOut);

    const attempts = el("div", "lh-cm-attempts");
    d.attempts.forEach((a, i) => attempts.appendChild(renderAttempt(a, i === d.attempts.length - 1)));
    card.appendChild(attempts);

    const last = d.attempts[d.attempts.length - 1];
    const ta = document.createElement("textarea");
    ta.className = "lh-nb-input lh-cm-input";
    ta.rows = 3;
    ta.placeholder = d.attempts.length ? L.revisePlaceholder : L.placeholder;
    ta.setAttribute("aria-label", ta.placeholder);
    if (last && last.verdict === "incorrect") ta.value = last.corrected ? "" : last.text;
    const actions = el("div", "lh-nb-actions lh-cm-actions");
    const passed = isPass(last?.verdict);
    // After a pass the next task is the useful action; otherwise submitting (again) is.
    const submit = el("button", "lh-nb-btn" + (passed ? "" : " lh-nb-btn--primary"), busy ? L.grading : L.submit); submit.type = "button";
    submit.disabled = busy;
    submit.addEventListener("click", () => void send(ta.value));
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(ta.value); } });
    actions.appendChild(submit);
    const idx = batch.indexOf(openId);
    if (idx >= 0 && idx < batch.length - 1) {
      const nx = el("button", "lh-nb-btn" + (passed ? " lh-nb-btn--primary" : ""), L.next); nx.type = "button";
      nx.addEventListener("click", () => void openTask(batch[idx + 1]));
      actions.appendChild(nx);
    }
    actions.appendChild(el("span", "lh-nb-hint lh-cm-keyhint", L.sendHint));
    card.append(ta, actions);
    main.appendChild(card);
    if (!busy) ta.focus();
  }

  async function openTask(id: string): Promise<void> {
    if (busy) return;
    const d = await store.get(id);
    if (!d) return;
    openId = id; openData = d;
    ctx.remember("task", id);
    paintTask(); void paintBatch();
  }

  function taskBlock(d: TaskData): string {
    return [`[Task] mode: ${d.mode}`, d.prompt, d.words.length ? `Must use: ${d.words.join(", ")}` : "", d.model_answer ? `Reference answer (do not reveal unless asked): ${d.model_answer}` : ""]
      .filter(Boolean).join("\n");
  }

  function friendly(res: AiResponse): string { return `${L.aiError}: ${res.error ?? "?"}`; }

  async function send(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || busy || !openId || !openData) return;
    const id = openId, d = openData;
    const prior = d.attempts.filter((a) => isGraded(a.verdict));
    const attempt: Attempt = { text, at: ctx.now(), verdict: null };
    d.attempts.push(attempt);
    busy = true;
    await store.put(id, d, ctx.now());                       // W-4
    paintTask();
    if (!ctx.ai) { busy = false; paintTask(); return; }       // W-9: self-judge path
    try {
      const session = new AiSession(ctx.ai);
      session.adopt(d.session_id);
      const { system, model, effort } = props.grader;
      const fullSystem = `${system}\n\n${GRADE_CONTRACT(props.categories ?? [])}`;
      // W-14: the grader sees the dictionary so it proposes only expressions not yet saved.
      const saved = savedTermsBlock((await ctx.terms.listTerms()).map((e) => String(e.summary.headword ?? e.id)));
      const seeded = async (): Promise<AiResponse> => {
        session.reset();
        const history = prior.map((a, i) => `Attempt ${i + 1}: ${a.text}\nVerdict: ${a.verdict}${a.corrected ? `\nCorrected: ${a.corrected}` : ""}`).join("\n\n");
        const prompt = [taskBlock(d), saved, history ? `[Earlier attempts]\n${history}` : "", `[Learner answer]\n${text}`].filter(Boolean).join("\n\n");
        return session.send({ prompt, system: fullSystem, model, effort: effort ?? "medium" });
      };
      let res = d.session_id ? await session.send({ prompt: [saved, `[Revised answer]\n${text}`].filter(Boolean).join("\n\n"), model, effort: effort ?? "medium" }) : await seeded();
      if (!res.ok && res.error_kind === "resume_missing") res = await seeded();   // W-5
      if (!res.ok) { attempt.verdict = "ungraded"; attempt.reason = friendly(res); return; }
      d.session_id = session.sessionId;
      const g = parseGrade(res.text);
      if (!g) { attempt.verdict = "ungraded"; attempt.reason = L.parseError; return; }   // W-2
      attempt.verdict = g.verdict;
      attempt.reason = g.reason;
      if (g.corrected) attempt.corrected = g.corrected;
      if (g.natural) attempt.natural = g.natural;
      attempt.errors = g.errors;
      // W-7: expressions go to the dictionary with this sentence as their example; not a lookup.
      const sentence = g.corrected ?? text;
      const inputs = g.terms.map((t) => (t.example?.en ? t : { ...t, example: { en: sentence } }));
      const ids = await ctx.terms.captureTerms(inputs, { now: ctx.now(), via: "compose", countLookup: false, skipExisting: true });
      attempt.terms = inputs.filter((t) => { const s = slugTerm(t.headword); return !!s && ids.includes(s); }).map((t) => t.headword);
      d.srs = scheduleTask(d.srs, g.verdict, ctx.now(), props.srs?.intervalsDays);
    } finally {
      await store.put(id, d, ctx.now());
      busy = false;
      if (openId === id) paintTask();
      void paintBatch();
      ctx.refreshCounts();
    }
  }

  async function selfJudge(correct: boolean): Promise<void> {
    if (!openId || !openData) return;
    const last = openData.attempts[openData.attempts.length - 1];
    if (!last || last.verdict !== null) return;
    last.verdict = correct ? "correct" : "incorrect";
    last.self = true;
    openData.srs = scheduleTask(openData.srs, last.verdict, ctx.now(), props.srs?.intervalsDays);
    await store.put(openId, openData, ctx.now());
    paintTask(); void paintBatch(); ctx.refreshCounts();
  }

  async function generate(): Promise<void> {
    if (busy) return;
    const now = ctx.now();
    if (mode === "free") {
      const id = taskId(now);
      const d: TaskData = { mode: "free", prompt: L.freePrompt, words: [], expressions: [], session_id: null, attempts: [], revealed: false, srs: null };
      await store.put(id, d, now);
      batch = [id, ...batch].slice(0, 20); ctx.remember("batch", JSON.stringify(batch));
      await openTask(id); ctx.refreshCounts();
      return;
    }
    if (!ctx.ai) return;
    busy = true; genBtn.disabled = true; genBtn.textContent = L.generating; genMsg.textContent = "";
    try {
      const unit = unitSel.value || "";
      ctx.remember("unit", unit);
      const scoped: Outline | null = outline && unit ? { areas: outline.areas?.filter((a) => a.key === unit), conceptOutline: outline.conceptOutline } : outline;
      const level = props.levels?.find((l) => l.key === levelSel.value)?.label ?? "";
      const req = { mode, count: batchSize, level, unit: scoped?.areas?.[0]?.label ?? "", curriculum: curriculumText(scoped), words: mode === "words" ? words : [], focus };
      const { system, model, effort } = props.tasks;
      const res = await ctx.ai.ai({ system: `${system}\n\n${GEN_CONTRACT}`, prompt: JSON.stringify(req), model, effort: effort ?? "medium" });
      const tasks = res.ok ? parseTasks(res.text) : [];
      if (!tasks.length) { genMsg.textContent = `${L.genError}${res.ok ? "" : `: ${res.error ?? "?"}`}`; return; }
      const ids: string[] = [];
      let t = now;
      for (const g of tasks) {
        const id = taskId(t++, Math.random);
        const d: TaskData = { mode, prompt: g.prompt, words: g.words.length ? g.words : req.words, ...(unit ? { unit } : {}),
          ...(g.model_answer ? { model_answer: g.model_answer } : {}), expressions: g.expressions, ...(g.skeleton ? { skeleton: g.skeleton } : {}),
          session_id: null, attempts: [], revealed: false, srs: null };
        if (await store.put(id, d, ctx.now())) ids.push(id);
      }
      batch = ids; focus = [];
      ctx.remember("batch", JSON.stringify(batch));
      busy = false;
      if (ids[0]) await openTask(ids[0]);
      ctx.refreshCounts();
    } finally {
      busy = false; paintSetup();
    }
  }

  genBtn.addEventListener("click", () => void generate());
  shuffleBtn.addEventListener("click", () => void pickWords(false));
  unitSel.addEventListener("change", () => ctx.remember("unit", unitSel.value));

  paintSetup();
  void loadOutline();
  void pickWords(true);
  void paintBatch();
  const last = ctx.recall("task");
  if (last) void openTask(last); else paintTask();

  return {
    openTask,
    useWords(list: string[]): void { mode = "words"; ctx.remember("mode", mode); words = list.slice(0, 5); paintSetup(); },
    generateFocus(cats: string[]): void { mode = modes.includes("translate") ? "translate" : modes[0]; focus = cats; paintSetup(); void generate(); },
  };
}
