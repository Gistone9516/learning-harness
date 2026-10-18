// WHAT: the play tab -- set builder (Q-6), one-problem-at-a-time runner in practice or timed exam mode
//       (Q-7), keyboard (Q-10), results with retry-wrong (Q-12). The active set survives a reload.
// DEPS: web/src/doc/doc, ./model, ./card, ./quiz (ctx type only).

import { el } from "../../src/doc/doc";
import { buildSet, logAnswer, matchesSource, type ActiveSet, type QuizMode, type Source } from "./model";
import { grade, renderQuizCard, type CardHandle } from "./card";
import type { QuizCtx } from "./quiz";

const SOURCES: Source[] = ["all", "unseen", "wrong", "flagged"];
const MODES: QuizMode[] = ["practice", "exam"];

export function mountPlay(root: HTMLElement, ctx: QuizCtx) {
  const { L } = ctx;
  const counts = ctx.props.counts?.length ? ctx.props.counts : [10, 20, 65];
  const wrap = el("div", "lh-qz-play");
  root.appendChild(wrap);

  let active: ActiveSet | null = null;
  try { active = JSON.parse(ctx.recall("set") ?? "null") as ActiveSet | null; } catch { active = null; }
  let handle: CardHandle | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const secondary = new Set<string>();   // cards the learner switched to the secondary language (kept across repaints)

  let units: string[] = [];
  try { units = JSON.parse(ctx.recall("units") ?? "[]") as string[]; } catch { units = []; }
  let source = (ctx.recall("source") as Source) ?? "all";
  let count = Number(ctx.recall("count") ?? counts[0]) || counts[0];
  let mode = (ctx.recall("mode") as QuizMode) ?? "practice";

  const save = () => ctx.remember("set", active ? JSON.stringify(active) : null);
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };

  function chipRow<T extends string | number>(label: string, items: T[], cur: () => T, text: (t: T) => string, set: (t: T) => void): HTMLElement {
    const row = el("div", "lh-qz-row");
    row.appendChild(el("span", "lh-nb-sec-h", label));
    const chips = el("div", "lh-nb-filters");
    for (const it of items) {
      const b = el("button", "lh-nb-filter" + (it === cur() ? " lh-nb-filter--on" : ""), text(it));
      b.type = "button"; b.setAttribute("aria-pressed", String(it === cur()));
      b.addEventListener("click", () => { set(it); paintBuilder(); });
      chips.appendChild(b);
    }
    row.appendChild(chips);
    return row;
  }

  function paintBuilder(): void {
    stopTimer(); handle = null;
    wrap.innerHTML = "";
    const box = el("section", "lh-qz-builder");
    const bank = ctx.bank();
    const areas = ctx.outline().areas.filter((a) => bank.some((p) => p.area === a.key));
    units = units.filter((u) => areas.some((a) => a.key === u));

    const unitRow = el("div", "lh-qz-row");
    unitRow.appendChild(el("span", "lh-nb-sec-h", L.units));
    const unitChips = el("div", "lh-nb-filters");
    const allBtn = el("button", "lh-nb-filter" + (!units.length ? " lh-nb-filter--on" : ""), L.allUnits); allBtn.type = "button";
    allBtn.addEventListener("click", () => { units = []; ctx.remember("units", "[]"); paintBuilder(); });
    unitChips.appendChild(allBtn);
    for (const a of areas) {
      const on = units.includes(a.key);
      const b = el("button", "lh-nb-filter" + (on ? " lh-nb-filter--on" : ""), a.label); b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => { units = on ? units.filter((u) => u !== a.key) : units.concat(a.key); ctx.remember("units", JSON.stringify(units)); paintBuilder(); });
      unitChips.appendChild(b);
    }
    unitRow.appendChild(unitChips);
    box.appendChild(unitRow);
    box.appendChild(chipRow(L.source, SOURCES, () => source, (s) => L.sources[s] ?? s, (s) => { source = s; ctx.remember("source", s); }));
    box.appendChild(chipRow(L.count, counts, () => count, (n) => String(n), (n) => { count = n; ctx.remember("count", String(n)); }));
    box.appendChild(chipRow(L.mode, MODES, () => mode, (m) => L.modes[m] ?? m, (m) => { mode = m; ctx.remember("mode", m); }));

    const log = ctx.log();
    const avail = bank.filter((p) => (!units.length || units.includes(p.area)) && matchesSource(log, p.card_id, source)).length;
    const foot = el("div", "lh-qz-builder-foot");
    foot.appendChild(el("span", "lh-qz-avail", `${L.available} ${avail}`));
    const start = el("button", "lh-nb-btn lh-nb-btn--primary lh-qz-start", avail ? L.startN.replace("{n}", String(Math.min(count, avail))) : L.start); start.type = "button";
    start.disabled = avail === 0;
    start.addEventListener("click", () => {
      active = buildSet(bank, log, { units, source, count, mode, secondsPerItem: ctx.props.secondsPerItem ?? 120, now: ctx.now() });
      save(); paintRun();
    });
    foot.appendChild(start);
    box.appendChild(foot);
    if (!avail) {
      const empty = el("div", "lh-nb-empty lh-qz-empty");
      empty.appendChild(el("p", undefined, L.none));
      const toBank = el("button", "lh-nb-btn lh-nb-btn--primary", L.toBank); toBank.type = "button";
      toBank.addEventListener("click", () => ctx.goBank());
      empty.appendChild(toBank);
      box.appendChild(empty);
    }
    wrap.appendChild(box);
  }

  function remaining(): number {
    if (!active || !active.limitSec) return 0;
    return Math.max(0, Math.round(active.limitSec - (ctx.now() - active.started) / 1000));
  }
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  function paintRun(): void {
    if (!active) { paintBuilder(); return; }
    active.ids = active.ids.filter((id) => !!ctx.byId(id));
    if (!active.ids.length) { active = null; save(); paintBuilder(); return; }
    active.idx = Math.min(active.idx, active.ids.length - 1);
    wrap.innerHTML = "";
    const a = active;
    const id = a.ids[a.idx];
    const p = ctx.byId(id)!;
    const ans = a.answers[id];
    const practice = a.mode === "practice";

    const head = el("div", "lh-qz-runhead");
    const bar = el("div", "lh-qz-bar"); const fill = el("div", "lh-qz-bar-fill");
    const done = Object.keys(a.answers).filter((k) => a.ids.includes(k)).length;
    fill.style.width = `${Math.round((done / a.ids.length) * 100)}%`;
    bar.appendChild(fill);
    head.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", L.modes[a.mode] ?? a.mode));
    head.appendChild(el("span", "lh-qz-progress", `${L.progress} ${done}/${a.ids.length}`));
    head.appendChild(bar);
    const clock = el("span", "lh-qz-clock");
    if (a.limitSec) {
      const tick = () => { const r = remaining(); clock.textContent = `${L.timeLeft} ${mmss(r)}`; clock.classList.toggle("lh-qz-clock--low", r < 300); if (r <= 0) finish(); };
      tick(); stopTimer(); timer = setInterval(tick, 1000);
      head.appendChild(clock);
    }
    const quit = el("button", "lh-nb-btn lh-nb-btn--quiet", L.quit); quit.type = "button";
    quit.addEventListener("click", () => { active = null; save(); paintBuilder(); });
    head.appendChild(quit);
    wrap.appendChild(head);

    handle = renderQuizCard(ctx, p, {
      num: a.idx + 1, total: a.ids.length,
      reveal: practice && !!ans?.verdict, answer: ans, locked: practice && !!ans?.verdict,
      onSubmit: (value) => void submit(id, value),
      onDeleted: () => { a.ids = a.ids.filter((x) => x !== id); delete a.answers[id]; save(); void ctx.reload().then(paintRun); },
      startSecondary: secondary.has(id),
      onLang: (on) => { if (on) secondary.add(id); else secondary.delete(id); },
    });
    wrap.appendChild(handle.el);

    const nav = el("div", "lh-nb-actions lh-qz-nav");
    const prev = el("button", "lh-nb-btn", L.prev); prev.type = "button"; prev.disabled = a.idx === 0;
    prev.addEventListener("click", () => { a.idx--; save(); paintRun(); });
    nav.appendChild(prev);
    if (practice && !ans?.verdict) {
      const sub = el("button", "lh-nb-btn lh-nb-btn--primary", L.submit); sub.type = "button";
      sub.addEventListener("click", () => handle?.submit());
      nav.appendChild(sub);
    }
    const last = a.idx === a.ids.length - 1;
    const nx = el("button", "lh-nb-btn" + (practice && ans?.verdict ? " lh-nb-btn--primary" : ""), last ? L.finish : L.next); nx.type = "button";
    nx.addEventListener("click", () => advance());
    nav.appendChild(nx);
    if (!practice && !last) {
      const fin = el("button", "lh-nb-btn lh-nb-btn--quiet", L.finish); fin.type = "button";
      fin.addEventListener("click", () => finish());
      nav.appendChild(fin);
    }
    nav.appendChild(el("span", "lh-nb-hint", L.keys));
    wrap.appendChild(nav);
  }

  function advance(): void {
    if (!active) return;
    if (active.idx >= active.ids.length - 1) { finish(); return; }
    active.idx++; save(); paintRun();
  }

  async function submit(id: string, value: string | string[]): Promise<void> {
    if (!active) return;
    const p = ctx.byId(id);
    if (!p) return;
    if (active.mode === "practice") {
      if (active.answers[id]?.verdict) return;
      const verdict = grade(p, value);
      active.answers[id] = { value, verdict };
      save();
      await ctx.saveLog(logAnswer(ctx.log(), id, verdict === "correct", ctx.now()));
      paintRun();
    } else {
      active.answers[id] = { value };
      save();
      advance();
    }
  }

  async function finish(): Promise<void> {
    if (!active || active.finished) return;
    stopTimer();
    if (active.mode === "exam") {
      let log = ctx.log();
      for (const id of active.ids) {
        const p = ctx.byId(id), a = active.answers[id];
        if (!p || !a) continue;
        a.verdict = grade(p, a.value);
        log = logAnswer(log, id, a.verdict === "correct", ctx.now());
      }
      await ctx.saveLog(log);
    }
    active.finished = true;
    save();
    paintResults();
  }

  function paintResults(): void {
    stopTimer(); handle = null;
    if (!active) { paintBuilder(); return; }
    const a = active;
    wrap.innerHTML = "";
    const box = el("section", "lh-qz-results");
    box.appendChild(el("h2", "lh-qz-results-h", L.results));
    const ids = a.ids.filter((id) => ctx.byId(id));
    const right = ids.filter((id) => a.answers[id]?.verdict === "correct");
    const pct = ids.length ? Math.round((right.length / ids.length) * 100) : 0;
    box.appendChild(el("p", "lh-qz-score", `${L.score} ${right.length} / ${ids.length} (${pct}%)`));

    const byUnit = new Map<string, { n: number; c: number }>();
    for (const id of ids) { const p = ctx.byId(id)!; const s = byUnit.get(p.area) ?? { n: 0, c: 0 }; s.n++; if (a.answers[id]?.verdict === "correct") s.c++; byUnit.set(p.area, s); }
    box.appendChild(el("h3", "lh-nb-sec-h", L.byUnit));
    const ul = el("ul", "lh-qz-units");
    for (const [area, s] of byUnit) {
      const li = el("li");
      li.appendChild(el("span", "lh-qz-unit-k", ctx.areaLabel(area)));
      const bar = el("span", "lh-qz-bar"); const f = el("span", "lh-qz-bar-fill"); f.style.width = `${Math.round((s.c / s.n) * 100)}%`; bar.appendChild(f);
      li.appendChild(bar);
      li.appendChild(el("span", "lh-qz-unit-v", `${s.c}/${s.n}`));
      ul.appendChild(li);
    }
    box.appendChild(ul);

    const wrong = ids.filter((id) => a.answers[id]?.verdict !== "correct");
    const btns = el("div", "lh-nb-actions");
    if (wrong.length) {
      const retry = el("button", "lh-nb-btn lh-nb-btn--primary", `${L.retryWrong} (${wrong.length})`); retry.type = "button";
      retry.addEventListener("click", () => startWith(wrong));
      btns.appendChild(retry);
    }
    const again = el("button", "lh-nb-btn", L.newSet); again.type = "button";
    again.addEventListener("click", () => { active = null; save(); paintBuilder(); });
    btns.appendChild(again);
    box.appendChild(btns);

    if (wrong.length) {
      box.appendChild(el("h3", "lh-nb-sec-h", `${L.wrongList} ${wrong.length}`));
      const list = el("div", "lh-qz-wrong");
      wrong.forEach((id, i) => {
        const p = ctx.byId(id)!;
        const ans = a.answers[id] ?? { value: "", verdict: "incorrect" as const };
        list.appendChild(renderQuizCard(ctx, p, { num: i + 1, total: wrong.length, reveal: true, locked: true,
          answer: ans.verdict ? ans : { ...ans, verdict: "incorrect" }, onSubmit: () => undefined }).el);
      });
      box.appendChild(list);
    }
    wrap.appendChild(box);
  }

  function startWith(ids: string[]): void {
    const keep = ids.filter((id) => !!ctx.byId(id));
    if (!keep.length) return;
    active = { mode: "practice", ids: keep, answers: {}, idx: 0, started: ctx.now(), limitSec: 0, finished: false };
    save(); paintRun();
  }

  // Q-10 keyboard, only while this tab shows a running set and no text field has focus.
  document.addEventListener("keydown", (e) => {
    if (!handle || !active || active.finished || root.hidden || !root.isConnected) return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const id = active.ids[active.idx];
    const answered = active.mode === "practice" ? !!active.answers[id]?.verdict : !!active.answers[id];
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); handle.choose(Number(e.key) - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (answered && active.mode === "practice") advance(); else handle.submit(); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); handle.toggleLang(); }
  });

  return {
    refresh(): void { if (active?.finished) paintResults(); else if (active) paintRun(); else paintBuilder(); },
    startWith,
  };
}
