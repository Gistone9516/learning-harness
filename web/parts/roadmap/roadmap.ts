// WHAT: roadmap part -- a project curriculum read from the instance's planning document, as cycles and steps,
//       with each step's derived study status, its build status from the document, links to the quiz and the
//       notebook, and graded build hints that never show runnable code.
// DEPS: web/src/ai/client, web/src/storage/port, web/src/doc (el, renderAiBody, inlineMd), ../quiz/bankload,
//       ../quiz/model, ./model.
// INPUT: RoadmapProps (specs/web-roadmap.md §2).
// EVENTS: collection "roadmap-hints" (one record per step). Reads the outline doc, quiz-log, concepts, problems.
// AI: optional -- hints only; statuses are token 0 (RM-12).
// CONSTRAINTS: subject-agnostic, secrets-gated, state-backed, token0.
// DEMO: mountRoadmap(el, {storage: memory, aiClient: null, roadmapText: md, source, outline: {doc: "outline"}, subjectKey: "demo"}).

import type { AiClient } from "../../src/ai/client";
import { el, escapeHtml, inlineMd, renderAiBody } from "../../src/doc/doc";
import { makeRecord, type StoragePort } from "../../src/storage/port";
import { loadBank } from "../quiz/bankload";
import { unitProgress, type UnitProgress } from "../quiz/model";
import {
  accuracy, currentStep, DEFAULT_CRITERION, DEFAULT_FENCES, guardFences, HINTS, hintId, hintRequest, levelOpen, parseRoadmap,
  studyStatus, unitFor, type Criterion, type Cycle, type HintsConfig, type RoadmapSource, type Step, type StepHints, type StudyStatus,
} from "./model";

export const DEFAULT_ROADMAP_LABELS = {
  title: "로드맵",
  loading: "로드맵을 불러오는 중…",
  readFail: "로드맵 파일을 읽지 못했습니다. 계획 문서를 확인해 주세요.",
  noCycles: "표시할 사이클이 없습니다. 계획 문서의 제목 형식을 확인해 주세요.",
  offline: "저장 서버에 연결되지 않아 공부 상태를 계산하지 못했습니다.",
  current: "지금 단계",
  allDone: "모든 단계를 마쳤습니다.",
  jump: "이동",
  now: "지금",
  total: "전체",
  status: { none: "공부 없음", todo: "공부 전", studying: "공부 중", studied: "공부 끝", unknown: "확인 불가" } as Record<string, string>,
  built: "구현 완료",
  buildPrefix: "구현",
  secStudy: "공부",
  secBuild: "구현",
  secCheck: "완료 확인",
  progress: "푼 문제 {answered}/{total} · 최근 정답률 {acc} (기준 {min}문제 이상, {pct}% 이상)",
  progressNone: "이 단계에는 아직 문제가 없습니다.",
  noUnit: "이 단계에는 아직 개념이 없습니다. 질문·용어장의 단계 관리에서 추가하세요.",
  solveEmpty: "문제 만들기",
  hintsTitle: "구현 힌트",
  hintsHelp: "먼저 직접 해 보고, 막힌 만큼만 받으세요.",
  noteLabel: "막힌 곳 메모",
  notePlaceholder: "어디까지 해 봤고 어디서 막혔는지 적어 주세요 (선택)",
  hintGet: "힌트 받기",
  hintLocked: "이전 힌트를 먼저 받으세요",
  hintPending: "힌트를 만드는 중입니다…",
  hintBusy: "받는 중…",
  hintFail: "힌트를 받지 못했습니다. 다시 시도해 주세요.",
  hintAgain: "다시 받기",
  hintAgainArmed: "지금 힌트가 바뀝니다. 한 번 더",
  hintAt: "받은 시각",
  codeRemoved: "(코드는 표시하지 않습니다.)",
};
export type RoadmapLabels = typeof DEFAULT_ROADMAP_LABELS;

export interface RoadmapProps {
  storage: StoragePort;
  aiClient: AiClient | null;
  roadmapText: string;
  source: RoadmapSource;
  outline: { doc: string };
  subjectKey: string;
  criterion?: Partial<Criterion>;
  hints?: HintsConfig & { labels?: Partial<RoadmapLabels> };
  title?: string;
  intro?: string;
  labels?: Partial<RoadmapLabels>;
  /** Shell-provided handoffs (RM-8); absent = the link is not shown. */
  solve?: { label: string; run: (unit: string, hasProblems: boolean) => void };
  ask?: { label: string; onAsk: (text: string) => void };
}

function fmt(t: string, vars: Record<string, string | number>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

function inline(text: string): HTMLElement {
  const p = el("p", "lh-rm-text");
  p.innerHTML = inlineMd(escapeHtml(text));
  return p;
}

export function mountRoadmap(container: HTMLElement, props: RoadmapProps): void {
  const L: RoadmapLabels = { ...DEFAULT_ROADMAP_LABELS, ...(props.labels ?? {}), ...(props.hints?.labels ?? {}),
    status: { ...DEFAULT_ROADMAP_LABELS.status, ...(props.labels?.status ?? {}) } };
  const crit: Criterion = { ...DEFAULT_CRITERION, ...(props.criterion ?? {}) };
  const flagLabel = new Map((props.source.flags ?? []).map((f) => [f.key, f.label]));
  const storage = props.storage;

  container.innerHTML = "";
  container.className = "lh-nb lh-rm";
  const banner = el("div", "lh-nb-banner");
  banner.hidden = true;
  const col = el("div", "lh-rm-col");
  container.append(banner, col);
  col.appendChild(el("p", "lh-nb-empty lh-nb-empty--center", L.loading));

  let cycles: Cycle[] = [];
  try { cycles = parseRoadmap(typeof props.roadmapText === "string" ? props.roadmapText : "", props.source); } catch { cycles = []; }

  void (async () => {
    let progress = new Map<string, UnitProgress>();
    let areas: { key: string; label: string }[] = [];
    let known = true;
    try {
      const { parts, bank } = await loadBank(storage, props.outline.doc);
      progress = unitProgress(bank, parts.log);
      areas = parts.outline.areas;
    } catch { known = false; }
    const units = new Map<string, string>();
    for (const c of cycles) for (const s of c.steps) { const u = unitFor(s, areas); if (u) units.set(s.key, u); }
    if (!storage.online) known = false;
    banner.textContent = L.offline;
    banner.hidden = known;
    render(progress, units, known);
  })();

  function render(progress: Map<string, UnitProgress>, units: Map<string, string>, known: boolean): void {
    col.innerHTML = "";
    const head = el("header", "lh-rm-head");
    head.appendChild(el("h1", "lh-rm-title", props.title ?? L.title));
    if (props.intro) head.appendChild(el("p", "lh-rm-intro", props.intro));
    col.appendChild(head);
    if (typeof props.roadmapText !== "string" || !props.roadmapText.trim()) {
      banner.textContent = L.readFail; banner.hidden = false;
      col.appendChild(el("p", "lh-nb-empty lh-nb-empty--center", L.readFail));
      return;
    }
    if (!cycles.length) { col.appendChild(el("p", "lh-nb-empty lh-nb-empty--center", L.noCycles)); return; }

    const all = cycles.flatMap((c) => c.steps);
    const prog = (s: Step) => { const u = units.get(s.key); return u ? progress.get(u) : undefined; };
    const status = (s: Step): StudyStatus | "unknown" => (known || s.noStudy ? studyStatus(s, prog(s), crit) : "unknown");
    const cur = currentStep(cycles);
    const stepEls = new Map<string, HTMLDetailsElement>();

    // Summary (RM-7)
    const sum = el("section", "lh-rm-sum");
    const line = el("div", "lh-rm-sum-line");
    if (cur) {
      line.appendChild(el("span", "lh-rm-sum-label", L.current));
      line.appendChild(el("strong", "lh-rm-sum-step", `${cur.code} ${cur.title}`));
      const jump = el("button", "lh-nb-link", L.jump);
      jump.type = "button";
      jump.addEventListener("click", () => {
        const d = stepEls.get(cur.key);
        if (!d) return;
        d.open = true;
        (d.parentElement?.closest("details") as HTMLDetailsElement | null)?.setAttribute("open", "");
        d.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      line.appendChild(jump);
    } else line.appendChild(el("strong", "lh-rm-sum-step", L.allDone));
    sum.appendChild(line);
    const counts = { built: 0, studied: 0, studying: 0, todo: 0 };
    for (const s of all) {
      if (s.built) counts.built++;
      const st = status(s);
      if (st === "studied" || st === "studying" || st === "todo") counts[st]++;
    }
    const chips = el("div", "lh-nb-chips");
    chips.appendChild(el("span", "lh-nb-chip lh-nb-chip--flat", `${L.total} ${all.length}`));
    chips.appendChild(el("span", "lh-nb-chip lh-nb-chip--flat", `${L.built} ${counts.built}`));
    if (known) for (const k of ["studied", "studying", "todo"] as const) chips.appendChild(el("span", "lh-nb-chip lh-nb-chip--flat", `${L.status[k]} ${counts[k]}`));
    sum.appendChild(chips);
    sum.appendChild(bar(counts.built, all.length));
    col.appendChild(sum);

    for (const c of cycles) {
      const det = el("details", "lh-rm-cycle") as HTMLDetailsElement;
      if (cur && c.steps.includes(cur)) det.open = true;
      const s = el("summary", "lh-rm-cycle-sum");
      s.appendChild(el("span", "lh-rm-cycle-label", c.label));
      s.appendChild(el("span", "lh-rm-cycle-count", `${c.steps.filter((x) => x.built).length}/${c.steps.length}`));
      det.appendChild(s);
      for (const step of c.steps) {
        const d = stepRow(step, status(step), step === cur, prog(step), units.get(step.key) ?? null, known);
        stepEls.set(step.key, d);
        det.appendChild(d);
      }
      col.appendChild(det);
    }
  }

  function bar(n: number, total: number): HTMLElement {
    const b = el("div", "lh-rm-bar");
    b.setAttribute("role", "progressbar");
    b.setAttribute("aria-valuemin", "0");
    b.setAttribute("aria-valuemax", String(total));
    b.setAttribute("aria-valuenow", String(n));
    const fill = el("span", "lh-rm-bar-fill");
    fill.style.width = total ? `${Math.round((n / total) * 100)}%` : "0%";
    b.appendChild(fill);
    return b;
  }

  function stepRow(step: Step, st: StudyStatus | "unknown", isCur: boolean, p: UnitProgress | undefined, unit: string | null, known: boolean): HTMLDetailsElement {
    const d = el("details", "lh-rm-step" + (isCur ? " lh-rm-step--current" : "")) as HTMLDetailsElement;
    d.dataset.step = step.key;
    if (isCur) d.open = true;
    const s = el("summary", "lh-rm-step-sum");
    s.appendChild(el("span", "lh-rm-key", step.code));
    s.appendChild(el("span", "lh-rm-step-title", step.title));
    const tags = el("span", "lh-rm-tags");
    if (isCur) tags.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", L.now));
    for (const f of step.flags) tags.appendChild(el("span", "lh-rm-flag", flagLabel.get(f) ?? f));
    tags.appendChild(el("span", "lh-nb-badge" + (st === "studied" ? " lh-nb-badge--ok" : st === "studying" ? " lh-nb-badge--soft" : ""), L.status[st]));
    tags.appendChild(el("span", "lh-nb-badge" + (step.built ? " lh-nb-badge--ok" : ""), step.status ? `${L.buildPrefix} ${step.status}` : L.buildPrefix));
    s.appendChild(tags);
    d.appendChild(s);

    let filled = false;
    d.addEventListener("toggle", () => { if (d.open && !filled) { filled = true; d.appendChild(detail(step, p, unit, known)); } });
    if (d.open) { filled = true; d.appendChild(detail(step, p, unit, known)); }
    return d;
  }

  function detail(step: Step, p: UnitProgress | undefined, unit: string | null, known: boolean): HTMLElement {
    const box = el("div", "lh-rm-detail");
    for (const [h, text] of [[L.secStudy, step.study], [L.secBuild, step.build], [L.secCheck, step.check]] as const) {
      if (!text) continue;
      const sec = el("section", "lh-nb-sec");
      sec.appendChild(el("h3", "lh-nb-sec-h", h));
      sec.appendChild(inline(text));
      box.appendChild(sec);
    }
    if (!step.noStudy && known) {
      const prog = el("div", "lh-rm-prog");
      if (!unit) prog.appendChild(el("p", "lh-nb-hint", L.noUnit));
      else if (!p || !p.total) prog.appendChild(el("p", "lh-nb-hint", L.progressNone));
      else {
        const acc = accuracy(p);
        prog.appendChild(el("p", "lh-rm-prog-line", fmt(L.progress, {
          answered: p.answered, total: p.total, acc: acc === null ? "-" : `${Math.round(acc * 100)}%`,
          min: crit.minAnswered, pct: Math.round(crit.minAccuracy * 100),
        })));
        prog.appendChild(bar(Math.min(p.answered, crit.minAnswered), crit.minAnswered));
      }
      box.appendChild(prog);
    }
    const actions = el("div", "lh-nb-actions lh-rm-actions");
    if (props.solve && !step.noStudy && unit) {
      const has = !!p && p.total > 0;
      const b = el("button", "lh-nb-btn lh-nb-btn--primary", has ? props.solve.label : L.solveEmpty);
      b.type = "button";
      b.addEventListener("click", () => props.solve!.run(unit, has));
      actions.appendChild(b);
    }
    if (props.ask) {
      const b = el("button", "lh-nb-btn", props.ask.label);
      b.type = "button";
      b.addEventListener("click", () => props.ask!.onAsk(`[${step.code}] ${step.title}: `));
      actions.appendChild(b);
    }
    if (actions.childElementCount) box.appendChild(actions);
    if (props.aiClient && props.hints?.levels?.length) box.appendChild(hintsBox(step));
    return box;
  }

  // ── hints (RM-9..RM-12) ───────────────────────────────────────────────────────────
  function hintsBox(step: Step): HTMLElement {
    const cfg = props.hints!;
    const levels = cfg.levels;
    const id = hintId(step.key);
    const sec = el("section", "lh-rm-hints");
    sec.appendChild(el("h3", "lh-nb-sec-h", L.hintsTitle));
    sec.appendChild(el("p", "lh-nb-hint", L.hintsHelp));
    const noteId = `lh-rm-note-${id}`;
    const lab = el("label", "lh-rm-note-label", L.noteLabel);
    lab.htmlFor = noteId;
    const note = el("textarea", "lh-nb-input lh-rm-note") as HTMLTextAreaElement;
    note.id = noteId;
    note.rows = 2;
    note.placeholder = L.notePlaceholder;
    sec.append(lab, note);
    const ol = el("ol", "lh-rm-ladder");
    sec.appendChild(ol);

    let rec: StepHints | null = null;
    const save = async (next: StepHints) => {
      rec = next;
      await storage.put(HINTS, makeRecord("step-hints", id, { step: step.key, levels: Object.keys(next.levels).length }, next));
    };
    note.addEventListener("blur", () => {
      const v = note.value;
      if ((rec?.note ?? "") === v) return;
      void save({ step: step.key, levels: rec?.levels ?? {}, note: v });
    });

    function paint(busy: string | null, failed: string | null): void {
      ol.innerHTML = "";
      const lastGot = [...levels].reverse().find((l) => rec?.levels[l.key])?.key;
      levels.forEach((lv, i) => {
        const li = el("li", "lh-rm-level");
        const got = rec?.levels[lv.key];
        const open = levelOpen(levels, rec, i);
        const top = el("div", "lh-rm-level-head");
        top.appendChild(el("span", "lh-rm-level-label", lv.label));
        li.appendChild(top);
        if (got) {
          const det = el("details", "lh-rm-level-body") as HTMLDetailsElement;
          det.open = lv.key === lastGot || busy === lv.key;
          det.appendChild(el("summary", "lh-nb-hint", `${L.hintAt} ${new Date(got.at).toLocaleString()}`));
          const msg = el("div", "lh-nb-msg lh-nb-msg--ai");
          const bubble = el("div", "lh-nb-bubble");
          bubble.appendChild(renderAiBody(got.text));
          msg.appendChild(bubble);
          det.appendChild(msg);
          const again = el("button", "lh-nb-btn lh-nb-btn--quiet", busy === lv.key ? L.hintBusy : L.hintAgain);
          again.type = "button";
          again.disabled = !!busy;
          let armed = false;
          again.addEventListener("click", () => {
            if (!armed) { armed = true; again.textContent = L.hintAgainArmed; return; }
            void ask(lv.key);
          });
          det.appendChild(again);
          li.appendChild(det);
        } else {
          const b = el("button", "lh-nb-btn" + (open ? " lh-nb-btn--primary" : ""), busy === lv.key ? L.hintBusy : L.hintGet);
          b.type = "button";
          b.disabled = !open || !!busy;
          b.addEventListener("click", () => void ask(lv.key));
          top.appendChild(b);
          if (!open) li.appendChild(el("p", "lh-nb-hint", L.hintLocked));
        }
        if (busy === lv.key) li.appendChild(el("div", "lh-nb-bubble lh-nb-bubble--pending", L.hintPending));
        if (failed === lv.key) li.appendChild(el("div", "lh-nb-bubble lh-nb-bubble--error", L.hintFail));
        ol.appendChild(li);
      });
    }

    async function ask(levelKey: string): Promise<void> {
      const level = levels.find((l) => l.key === levelKey);
      if (!level || !props.aiClient) return;
      if (note.value !== (rec?.note ?? "")) rec = { step: step.key, levels: rec?.levels ?? {}, note: note.value };
      paint(levelKey, null);
      const req = hintRequest(step, level, rec, levels, cfg);
      const res = await props.aiClient.ai(req);
      const text = res.ok ? guardFences(res.text.trim(), cfg.allowFences ?? DEFAULT_FENCES, L.codeRemoved) : "";
      if (!text) { paint(null, levelKey); return; }
      await save({ step: step.key, levels: { ...(rec?.levels ?? {}), [levelKey]: { text, at: Date.now() } }, note: note.value });
      paint(null, null);
    }

    void (async () => {
      rec = (await storage.get<StepHints>(HINTS, id))?.data ?? null;
      note.value = rec?.note ?? "";
      paint(null, null);
    })();
    paint(null, null);
    return sec;
  }
}
