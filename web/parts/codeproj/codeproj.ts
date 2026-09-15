// WHAT: a git repository read in an IDE shape, with an annotation layer written for the learner's request, plus session-based explanations and questions.
// DEPS: web/src/ai (ai_server client). No npm UI libs; tree, code panel and AI panel are hand-rolled DOM.
// INPUT: a pre-baked `project` (CodeProject), or a repository + request loaded through `loadRepo` — injected, no subject literal.
// INPUT: `request` — what the learner asked of a reopened project, so files still unannotated are written for the same goal.
// INPUT: `annotations` (AnnotationSet) — the explanation layer, injected; the part renders it and never stores it.
// INPUT: `concepts` (ConceptSet) — the concept documents for the project, injected the same way.
// INPUT: `traces` (TraceSet) — debug walkthroughs already built for this project, keyed by entry point.
// EVENTS: file-seen flags via onFileSeen; loaded projects via onProjectLoaded; AI exchanges via onExchange.
// EVENTS: the annotation layer via onAnnotations, once per file as it lands — the part makes it, the owner stores it.
// EVENTS: the concept layer via onConcepts, once per document as the background pass lands them.
// EVENTS: the trace layer via onTraces, once per leg as a run is built — including on a reopened project.
// EVENTS: that pass's progress via onConceptProgress, for chrome the owner draws (the view tabs).
// AI: optional — with a session: loading (/repos/load, then /ai new session) + annotate/explain/ask (/ai resume). With session:null: read a pre-baked project offline (AI panel hidden).
// CONSTRAINTS: subject-agnostic, secrets-gated, session-resume (load-once->resume cost model).
// CONSTRAINTS: every AI call is medium; at most one background call runs beside the learner's own.
// RETURNS: a handle { setView, hasConcepts } — the owner draws the code/concept tabs in its own top bar.
// DEMO: mountCodeproj(el, { session:null, project }) reads a canned CodeProject fully offline (no live AI).
//
// Layout is the three-pane IDE shape: files left, code centre, AI right — and a second pair of
// panels for the concepts view, held in the same grid and swapped by display. This file only assembles
// the panels and routes events; the pure model, the prompts, the AI calls and the DOM panels each
// live in their own module beside it.

import { AiSession, type RepoLoadRequest, type RepoLoadResponse } from "../../src/ai/client";
import type { CodeProject, Lens, ReadingRequest, RepoOrigin, Scrap } from "./model";
import {
  annotationOrder,
  buildTree,
  canAddScrap,
  fileByPath,
  parseScope,
  projectFromRepo,
  sliceLines,
  SCRAP_MAX_COUNT,
  SCRAP_MAX_LINES,
} from "./model";
import {
  annotateProject,
  annotateFile,
  explain,
  explainScraps,
  ask,
  ENTRY_ANNOTATE_MAX,
  pickFocusFiles,
  reseedSession,
  outlineConcepts,
  writeConcept,
  traceRun,
  type Reseed,
} from "./session";
import { createJobQueue } from "./background";
import { parseAnnotations, type AnnotationSet } from "./annotations";
import { conceptProgress, seedSet, type ConceptEntry, type ConceptSet } from "./concepts";
import { changedSince, traceKey, varKey, type TraceRun, type TraceSet } from "./trace";
import { createConceptView } from "./conceptview";
import { LENS_LABELS } from "./prompts";
import { createAiPanel, createCodePanel, createFilePanel, el, type AnswerDepth } from "./view";
import { parseComposed } from "./components/parse";
import { normalizeSemi } from "./components/semi";
import { renderComposed, type RenderContext } from "./components/render";

/*
 * Labels for the summary toggle. Deliberately not 자세히 or 더 알아보기: both already name an AI
 * call on this same screen — the answer-depth pair and the annotation popup's promotion — and a
 * word that means "wait for the model" elsewhere must not mean "expand some text" here.
 */
const SUMMARY_MORE = "더 보기";
const SUMMARY_LESS = "접기";

/** Sizes on the waiting line and in the too-large advice: KB under a megabyte, one decimal above. */
function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export interface ExchangeEvent {
  kind: "explain" | "ask";
  lens?: Lens;
  path: string;
  lines?: [number, number];
  question?: string;
  /** Number of collected regions, when the exchange was about a basket rather than one place. */
  scrapCount?: number;
  /**
   * How much answer was asked for. Recorded because a short answer and a full one cost very
   * differently, and a history that counts them as one thing cannot tell the operator which.
   */
  depth?: AnswerDepth;
  /**
   * The answer itself. Carried because the owner keeps a verbatim record: a history that counts
   * questions but keeps none of them cannot be looked back on, only tallied.
   */
  answer: string;
}

export interface CodeprojProps {
  // Live AI session, or null for offline reading of a pre-baked `project` (loading/AI disabled).
  session: AiSession | null;
  project?: CodeProject;
  /** Reads a repository through the server. Without it there is no form to load one with. */
  loadRepo?: (req: RepoLoadRequest) => Promise<RepoLoadResponse>;
  /**
   * What the learner asked of this project, when reopening one. Files a previous visit left
   * unannotated are written for it, so a project does not read at two levels.
   */
  request?: ReadingRequest;
  onFileSeen?: (path: string) => void;
  /** Fired once, when a repository has been read and put into the session, before entry. */
  onProjectLoaded?: (project: CodeProject, origin: Omit<RepoOrigin, "loaded_at">) => void;
  onExchange?: (event: ExchangeEvent) => void;
  /**
   * The annotation layer for this project, keyed by file path. A snapshot: the part renders what
   * it is given and never writes it back, because the record id is the project id and only the
   * flow knows that id.
   */
  annotations?: AnnotationSet;
  /**
   * Emitted whenever the annotation layer changes: once when the files annotated before entry are
   * done, then after every file the background queue lands, including on a reopened project. The
   * part cannot store it: the record is keyed by project id and only the flow has that.
   */
  onAnnotations?: (set: AnnotationSet) => void;
  /**
   * The concept layer for this project. Same snapshot rule as `annotations`: rendered, never
   * stored here. Present with no session at all -- reopening an archived project reads it from
   * the record and costs nothing.
   */
  concepts?: ConceptSet;
  /**
   * Emitted after every document the background pass lands, not once at the end. The learner is
   * already reading by then, so a set that only arrived at the end would be lost if they left.
   */
  onConcepts?: (set: ConceptSet) => void;
  /** Progress of that pass, for chrome the flow owns -- the tab strip lives in its top bar. */
  onConceptProgress?: (done: number, total: number) => void;
  /**
   * Debug walkthroughs already built for this project. Same snapshot rule as the other two
   * layers, and the same reason it is worth carrying: a run costs a real call to make.
   */
  traces?: TraceSet;
  /**
   * Emitted after every leg of a run, not once when it finishes.
   *
   * Unlike the other two layers this also fires on a REOPENED project: a run is the learner's to
   * start, from any line, at any time, so the owner's reopen path needs a write-back where it
   * previously had none.
   */
  onTraces?: (set: TraceSet) => void;
}

/**
 * What the flow can do to a mounted part.
 *
 * It exists for one reason: the tab strip belongs in the study screen's top bar, which is the
 * flow's element and a sibling of this part's root, while the panes it switches are the part's.
 * Returning a handle keeps that boundary honest -- the flow owns chrome, the part owns content.
 */
export interface CodeprojHandle {
  setView(view: CodeprojView): void;
  /** True when there is a concepts view worth offering at all. */
  hasConcepts(): boolean;
}

export type CodeprojView = "code" | "concepts";

export function mountCodeproj(container: HTMLElement, props: CodeprojProps): CodeprojHandle {
  const { session, project, loadRepo, onFileSeen, onProjectLoaded, onExchange } = props;
  // Replaced as files are annotated, before entry and then behind the learner.
  let annotations = props.annotations ?? { files: {} };
  // What every annotation prompt is written for. Set by the form on a fresh load, or handed in
  // with a reopened project.
  let request: ReadingRequest | undefined = props.request;
  // The concept layer, replaced wholesale as the background pass lands each document.
  let concepts: ConceptSet | null = props.concepts ?? null;
  // The debug layer. Replaced the same way, one leg at a time, and unlike the other two it can
  // grow on a project the learner reopened long after it was loaded.
  let traces: TraceSet = props.traces ?? { runs: {} };
  /*
   * Where a debug run stands. `stepAt` indexes `run.steps`, or -1 for no run.
   *
   * Declared here with the rest of the mount's state rather than beside the functions that use
   * it: `setView` reads `run` and is called during mount, which puts a later `let` in its
   * temporal dead zone. A function hoists, a `let` does not.
   */
  let run: TraceRun | null = null;
  let stepAt = -1;
  /** True from the first leg's request until the last leg resolves, so the end can say which. */
  let runLoading = false;
  // Which concept is open, so the AI panel's target line can name it instead of a file.
  let openConcept: ConceptEntry | null = null;
  let view: CodeprojView = "code";
  container.innerHTML = "";
  container.classList.add("lh-codeproj");

  let currentProject: CodeProject | null = project ?? null;
  let selectedPath: string | null = null;
  const seenPaths = new Set<string>();
  // Collected regions, possibly from several files. They become the subject of the next request.
  let scraps: Scrap[] = [];
  let scrapSeq = 0;

  // Restoring a lost session re-sends the whole codebase, so it is budgeted at one per mount.
  // Without the cap a run of failures (rate limit, overload) would pay that cost on every
  // question and never stop; a second loss is terminal here and the learner reloads.
  let reseedsLeft = 1;

  // Whether a call is in flight, and whether this mount can ever succeed again. Enablement was
  // previously set unconditionally from three directions, so the panel's state was whatever ran
  // last: selecting a file re-armed the buttons in the middle of a request, and a terminal
  // failure re-armed them for a request that can no longer succeed.
  let aiBusy = false;
  let sessionUnrecoverable = false;

  /**
   * The pending entry is the only honest place to mention this: before a call actually fails
   * there is nothing true to say, because whether the server still holds the session cannot be
   * known from here without spending a call.
   */
  function reseedFor(entry: { setWaiting(text: string): void }): Reseed {
    return async () => {
      if (!session || !currentProject) return false;
      if (reseedsLeft <= 0) {
        // Asked to restore a second time in one mount: the first restore worked and was lost
        // again, so nothing available here will help and the learner needs a reload.
        sessionUnrecoverable = true;
        return false;
      }
      reseedsLeft -= 1;
      // Load-class cost behind an explanation-class click, so it says so and keeps a live
      // signal: a minutes-long block of unchanging grey text next to greyed buttons reads as a hang.
      entry.setWaiting("이전 해설 세션이 만료되어 코드베이스를 다시 보내는 중입니다. 잠시 걸립니다...");
      const ok = await reseedSession(session, currentProject);
      if (!ok) sessionUnrecoverable = true;
      return ok;
    };
  }

  /** Every AI call starts here, so nothing else has to remember to mark the panel busy. */
  function beginCall(): void {
    aiBusy = true;
    aiPanel.setEnabled(false);
  }

  /**
   * ...and ends here. The panel comes back only if this mount can still succeed; leaving the
   * buttons live after an unrecoverable session hands the learner controls whose only outcome
   * is failure, styled exactly like working ones.
   */
  function endCall(entry: { setBody(text: string): void }): void {
    aiBusy = false;
    if (sessionUnrecoverable) {
      entry.setBody("해설 세션을 복구하지 못했습니다. 페이지를 새로고침한 뒤 다시 열어 주세요.");
      return;
    }
    aiPanel.setEnabled(true);
  }

  // ── shell ───────────────────────────────────────────────────────────────────

  const header = el("div", "lh-cp-header");
  /*
   * The toggle sits at the right end of the title's own row rather than under the summary, so
   * the collapsed state costs no extra line. This header's vertical budget is the whole reason
   * an instance clamps the summary in the first place; a control that spends a row to reveal
   * two would be taking back most of what the clamp bought.
   *
   * Its own class, not conceptprob's `.lh-cp-title-row`: that one is unscoped, and a bare
   * `lh-cp-` class claimed by the other part is what put this part's AI pane off-screen once.
   */
  const headRow = el("div", "lh-cp-head-row");
  const titleEl = el("h2", "lh-cp-title", "코드 프로젝트 탐색");
  const summaryEl = el("p", "lh-cp-summary", "");
  summaryEl.id = "lh-cp-summary-body";
  const summaryToggle = el("button", "lh-cp-summary-toggle", SUMMARY_MORE);
  summaryToggle.type = "button";
  summaryToggle.hidden = true;
  summaryToggle.setAttribute("aria-expanded", "false");
  summaryToggle.setAttribute("aria-controls", summaryEl.id);
  summaryToggle.addEventListener("click", () => setSummaryOpen(!summaryOpen));
  headRow.appendChild(titleEl);
  headRow.appendChild(summaryToggle);
  header.appendChild(headRow);
  header.appendChild(summaryEl);
  container.appendChild(header);

  /*
   * The kit does not clamp the summary, so nothing overflows and the toggle stays hidden here.
   * It appears exactly where an instance decided to clamp — which is also why the measurement
   * has to be a measurement and not a character count: only the stylesheet knows the budget.
   */
  let summaryOpen = false;

  function setSummaryOpen(open: boolean): void {
    summaryOpen = open;
    summaryEl.classList.toggle("lh-cp-summary--open", open);
    summaryToggle.textContent = open ? SUMMARY_LESS : SUMMARY_MORE;
    summaryToggle.setAttribute("aria-expanded", String(open));
  }

  /**
   * Show the toggle only where there is something hidden to show.
   *
   * Measured while collapsed and never while open, because an expanded paragraph reports no
   * overflow — recomputing then would hide the button and strand the learner in the open state
   * with no way back.
   */
  function syncSummaryToggle(): void {
    if (summaryOpen) return;
    summaryToggle.hidden = summaryEl.scrollHeight <= summaryEl.clientHeight + 1;
  }

  /**
   * Re-measure on resize: the clamp is a line count, so the same text overflows at one width and
   * fits at another, and an instance may change the clamp itself at a breakpoint.
   *
   * An observer on the element rather than a `window` listener. `mountCodeproj` has no teardown
   * and remounts into the same container, so a global listener would hold this closure alive for
   * the life of the page and stack up one copy per mount; the observer dies with the closure.
   */
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => syncSummaryToggle()).observe(summaryEl);
  }

  /** Both writers of the summary go through here: the text changed, so the measurement is stale. */
  function setSummary(text: string): void {
    summaryEl.textContent = text;
    setSummaryOpen(false);
    syncSummaryToggle();
  }

  const panes = el("div", "lh-cp-panes");
  const filePanel = createFilePanel((path) => selectFile(path));
  const codePanel = createCodePanel();
  const aiPanel = createAiPanel({
    onExplain: (lens) => void runExplain(lens),
    onAsk: (question, depth) => void runAsk(question, depth),
    onScrapRemove: (id) => {
      scraps = scraps.filter((s) => s.id !== id);
      syncScraps();
    },
    onScrapReveal: (id) => {
      const scrap = scraps.find((s) => s.id === id);
      if (!scrap) return;
      if (scrap.path !== selectedPath) selectFile(scrap.path);
      codePanel.reveal(scrap.lines);
    },
    onScrapClear: () => {
      scraps = [];
      syncScraps();
    },
  });

  /*
   * Both views live in the grid at once and are swapped by `display`, which is what keeps the
   * code panel's scroll position, the file selection and the answer thread alive across a switch.
   * The AI panel belongs to neither view: it is one thread, so a question about a concept and a
   * question about a line land in the same place.
   */
  const conceptView = createConceptView({
    onOpen: (entry) => {
      openConcept = entry;
      updateTargetHint(codePanel.selection());
    },
    onRetry: session ? (entry) => void retryConcept(entry) : undefined,
  });
  panes.appendChild(filePanel.root);
  panes.appendChild(codePanel.root);
  panes.appendChild(conceptView.rail);
  panes.appendChild(conceptView.reading);
  panes.appendChild(aiPanel.root);
  container.appendChild(panes);
  conceptView.render(concepts);
  setView("code");

  aiPanel.setEnabled(false);
  codePanel.onSelectionChange(updateTargetHint);
  codePanel.onScrapAdd((lines) => addScrap(lines));
  // A note may point at another file. Moving between files belongs to the mount, which is the
  // only thing that knows the project; the panel just says where the learner wanted to go.
  // Registered only with a session, so the popup renders its promote button only where pressing
  // it can do something. The note itself becomes the question, which keeps the promotion on the
  // ordinary ask path instead of inventing a second kind of request.
  if (session) {
    codePanel.onNoteExpand((lines, what) => {
      void runAsk(`${what} 이 부분을 더 자세히 설명해 주세요.`, "semi");
      void lines;
    });
  }

  codePanel.onNoteRef((path, line) => {
    if (!currentProject || !fileByPath(currentProject, path)) return;
    selectFile(path);
    if (line) codePanel.reveal([line, line]);
  });

  // ── debug run (FR-24) ───────────────────────────────────────────────────────
  //
  // The run lives here rather than in the code panel because it spans files, and `show()` clears
  // the panel's own state on every switch. The panel is told only where the run stands in the
  // file currently on screen, exactly as it is told which scraps are in that file.

  codePanel.onStepKey((dir) => stepDebug(dir));

  function publishTraces(key: string, value: TraceRun): void {
    traces = { runs: { ...traces.runs, [key]: value } };
    props.onTraces?.(traces);
  }

  /**
   * Start a walkthrough from the selected line.
   *
   * A cached run starts instantly; a new one costs one call before anything can be shown, and
   * then plays while the rest is still being written. Nothing is ever generated without this
   * being pressed -- opening a project, or a file, sends nothing.
   */
  async function startDebug(): Promise<void> {
    const selection = codePanel.selection();
    if (!session || !currentProject || !selectedPath || !selection || run || runLoading) return;
    const entry = { path: selectedPath, line: selection[0] };
    const key = traceKey(entry.path, entry.line);

    const cached = traces.runs[key];
    if (cached?.status === "ok" && cached.steps.length) {
      beginRun(cached);
      return;
    }

    runLoading = true;
    codePanel.setDebugControl("loading", () => undefined);
    const built = await traceRun(
      session,
      currentProject,
      entry,
      (partial) => {
        publishTraces(key, partial);
        // The first leg with steps starts the walkthrough; later legs extend the same array in
        // place, so the learner's position is untouched by one arriving.
        if (!run && partial.steps.length) beginRun(partial);
        else if (run) paintDebug();
      },
      reseedFor({ setWaiting: (text) => aiPanel.notice(text) }),
    );
    runLoading = false;
    if (built.status === "failed") {
      stopDebug();
      aiPanel.notice("실행 흐름을 만들지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    paintDebug();
  }

  function beginRun(next: TraceRun): void {
    run = next;
    stepAt = 0;
    codePanel.setDebugActive(true);
    paintDebug();
  }

  function stopDebug(): void {
    run = null;
    stepAt = -1;
    codePanel.setDebugActive(false);
    codePanel.markDebug(null, null);
    codePanel.showDebug(0, null);
    updateDebugControl();
  }

  function stepDebug(dir: 1 | -1): void {
    if (!run) return;
    const next = stepAt + dir;
    if (next < 0) return;
    if (next >= run.steps.length) {
      // Either the end of the walkthrough or the moment before the next file's steps land. The
      // popup says which, because they look identical from here and mean different things.
      paintDebug();
      return;
    }
    stepAt = next;
    paintDebug();
  }

  /**
   * Repaint the markers for the file on screen.
   *
   * Split out from `paintDebug` because `selectFile` calls it too: `show()` rebuilds every line,
   * so a run that crossed into a file, or a learner who wandered off and came back, would
   * otherwise find the red dot gone.
   */
  function applyDebugMarks(): void {
    const step = run && stepAt >= 0 ? run.steps[stepAt] : null;
    codePanel.markDebug(
      run && run.entry.path === selectedPath ? run.entry.line : null,
      step && step.path === selectedPath ? step.line : null,
    );
  }

  function paintDebug(): void {
    updateDebugControl();
    const step = run && stepAt >= 0 ? run.steps[stepAt] : null;
    if (!run || !step) {
      applyDebugMarks();
      codePanel.showDebug(0, null);
      return;
    }
    // Stepping into a call opens that file and carries on there. selectFile reapplies the marks.
    if (step.path !== selectedPath) selectFile(step.path);
    else applyDebugMarks();

    const changed = changedSince(stepAt > 0 ? run.steps[stepAt - 1].vars : undefined, step.vars);
    codePanel.showDebug(step.line, {
      at: stepAt + 1,
      total: run.steps.length,
      line: step.line,
      explain: step.explain,
      vars: step.vars.map((v) => ({ ...v, changed: changed.has(varKey(v)) })),
      truncated: !!run.truncated,
      pending: runLoading && stepAt === run.steps.length - 1,
    });
  }

  /**
   * One control, four states. The head is a single row and a run needs both a way in and a way
   * out, so the two share a slot the way the note link already shares one with its retry.
   */
  function updateDebugControl(): void {
    if (!session || view !== "code") {
      codePanel.setDebugControl("hidden", () => undefined);
      return;
    }
    if (run) codePanel.setDebugControl("running", () => stopDebug());
    else if (runLoading) codePanel.setDebugControl("loading", () => undefined);
    else if (codePanel.selection()) codePanel.setDebugControl("ready", () => void startDebug());
    else codePanel.setDebugControl("hidden", () => undefined);
  }

  function addScrap(lines: [number, number]): void {
    if (!currentProject || !selectedPath) return;
    const file = fileByPath(currentProject, selectedPath);
    if (!file) return;

    if (!canAddScrap(scraps, lines)) {
      aiPanel.notice(`구간은 ${SCRAP_MAX_COUNT}개, 총 ${SCRAP_MAX_LINES}행까지 담을 수 있습니다.`);
      return;
    }
    // Same region twice is a mis-click, not an intent to duplicate.
    const already = scraps.some(
      (s) => s.path === selectedPath && s.lines[0] === lines[0] && s.lines[1] === lines[1],
    );
    if (already) return;

    scraps = [
      ...scraps,
      {
        id: `scrap-${++scrapSeq}`,
        path: selectedPath,
        lines,
        code: sliceLines(file.content, lines),
      },
    ];
    syncScraps();
  }

  /**
   * Show an answer. A composed answer is rendered as components; anything else falls back to the
   * raw text, so a malformed response still says what it has to say.
   */
  function showAnswer(
    entry: { setBody(t: string): void; setContent(n: HTMLElement): void },
    text: string,
    depth: AnswerDepth = "full",
  ): void {
    const composed = parseComposed(text);
    if (!composed) {
      entry.setBody(text);
      return;
    }
    // The directive asks for a short answer; this is where the ask is enforced. A model that
    // answered at full length would otherwise arrive wearing the short answer's badge.
    const shaped = depth === "semi" ? normalizeSemi(composed) : composed;
    entry.setContent(renderComposed(shaped, renderContext()));
  }

  function renderContext(): RenderContext {
    return {
      currentPath: selectedPath ?? undefined,
      exists: (path) => !!currentProject && !!fileByPath(currentProject, path),
      navigate: (path, lines) => {
        if (path && path !== selectedPath) selectFile(path);
        if (lines) codePanel.reveal(lines);
      },
    };
  }

  /** Keep both panels showing the same basket after any change. */
  function syncScraps(): void {
    aiPanel.setScraps(scraps.map((s) => ({ id: s.id, path: s.path, lines: s.lines })));
    codePanel.markScraps(scraps.filter((s) => s.path === selectedPath).map((s) => s.lines));
    if (!scraps.length) updateTargetHint(codePanel.selection());
  }

  // Without a session there is nothing for the AI panel to call, so it is not shown at all
  // rather than left as a row of dead buttons.
  if (!session) {
    aiPanel.root.style.display = "none";
    panes.classList.add("lh-cp-no-ai");
  }

  // ── background: what is written behind a learner who is already reading ──────
  //
  // One queue for the files not annotated before entry and for the concept layer, so at most one
  // background call ever runs beside the learner's own (see background.ts for why one). Declared
  // before anything below can open a file, because opening one reads and bumps the queue.

  type Job = { kind: "annotate"; path: string } | { kind: "outline" } | { kind: "concept"; id: string };
  const annotateKey = (path: string): string => `a:${path}`;
  const jobKey = (job: Job): string =>
    job.kind === "annotate" ? annotateKey(job.path) : job.kind === "outline" ? "outline" : `c:${job.id}`;
  const queue = createJobQueue<Job>(jobKey, runJob, {
    // Repainted after the job has left the queue, so the header stops saying "만드는 중".
    onDone: (job) => {
      if (job.kind === "annotate" && job.path === selectedPath) paintAnnotationState();
    },
  });

  async function runJob(job: Job): Promise<void> {
    if (!session || !currentProject) return;
    if (job.kind === "annotate") {
      const file = fileByPath(currentProject, job.path);
      if (!file) return;
      const built = await annotateFile(session, file.path, file.content, request);
      annotations = { files: { ...annotations.files, [file.path]: built } };
      props.onAnnotations?.(annotations);
      return;
    }
    if (job.kind === "outline") {
      const seeds = await outlineConcepts(session, undefined, request);
      if (!seeds.length) return;
      publishConcepts(seedSet(seeds));
      // Ahead of the remaining annotations: a whole concept set is minutes, the rest of a large
      // repository can be hours, and a file the learner opens still jumps ahead of both.
      queue.push(seeds.map((seed) => ({ kind: "concept" as const, id: seed.concept_id })), { front: true });
      return;
    }
    const entry = concepts?.entries.find((e) => e.seed.concept_id === job.id);
    if (!entry || !concepts) return;
    entry.status = "writing";
    entry.reason = undefined;
    publishConcepts(concepts);
    const { doc, reason } = await writeConcept(session, entry.seed);
    if (doc) {
      entry.doc = doc;
      entry.status = "ok";
    } else {
      entry.status = "failed";
      entry.reason = reason;
    }
    publishConcepts(concepts);
  }

  /** A learner's own "make" or "retry" goes through the queue too, and to its front. */
  function requestAnnotation(path: string): void {
    queue.push([{ kind: "annotate", path }], { front: true });
    queue.bump(annotateKey(path));
    paintAnnotationState();
  }

  // ── loading a repository (only starts on an explicit action) ────────────────

  if (!currentProject && session && loadRepo) {
    container.insertBefore(buildLoadPanel(session, loadRepo), panes);
    // The empty grid is hidden while the form is up. Both used to share one fixed-height column,
    // and a form this tall pushed its own button below a viewport that does not scroll.
    panes.style.display = "none";
  } else if (!currentProject) {
    setSummary("표시할 프로젝트가 없습니다 (미리 준비된 프로젝트 주입 또는 AI 설정 필요).");
  } else {
    loadProject(currentProject);
  }

  function buildLoadPanel(live: AiSession, load: NonNullable<CodeprojProps["loadRepo"]>): HTMLElement {
    const panel = el("div", "lh-cp-load-panel");

    let fieldSeq = 0;
    function field(label: string, control: HTMLInputElement | HTMLTextAreaElement, hint?: string): HTMLElement {
      const wrap = el("div", "lh-cp-load-field");
      control.id = `lh-cp-load-${++fieldSeq}`;
      const lab = el("label", "lh-cp-load-label", label);
      lab.setAttribute("for", control.id);
      wrap.appendChild(lab);
      wrap.appendChild(control);
      if (hint) wrap.appendChild(el("p", "lh-cp-load-hint", hint));
      return wrap;
    }
    function text(cls: string, placeholder: string): HTMLInputElement {
      const input = el("input", cls);
      input.type = "text";
      input.placeholder = placeholder;
      input.spellcheck = false;
      input.autocomplete = "off";
      return input;
    }
    function area(cls: string, rows: number, placeholder: string): HTMLTextAreaElement {
      const box = el("textarea", cls);
      box.rows = rows;
      box.placeholder = placeholder;
      return box;
    }

    const sourceInput = text("lh-cp-load-source", "https://github.com/owner/repo 또는 C:\\경로\\폴더");
    const refInput = text("lh-cp-load-ref", "비우면 기본 브랜치");
    const goalInput = area("lh-cp-load-goal", 2, "예: 전체 구조를 파악하고 싶다. 이 언어는 읽을 줄 안다.");
    const focusInput = area("lh-cp-load-focus", 2, "예: 요청이 들어와 응답이 나가기까지");
    const scopeInput = area("lh-cp-load-scope", 3, "src/auth\n*.py");
    scopeInput.spellcheck = false;

    const startBtn = el("button", "lh-cp-load-btn", "불러오기");
    startBtn.type = "button";
    const status = el("div", "lh-cp-load-status", "");
    const phaseEl = el("span", "lh-cp-load-phase", "");
    // Counts, paths and the clock go in their own span: fixed width digits so the line does not
    // twitch every second, and an ellipsis so a long path cannot push the phase text around.
    const metaEl = el("span", "lh-cp-load-meta", "");
    status.appendChild(phaseEl);
    status.appendChild(metaEl);

    let startedAt = 0;
    let ticker: number | null = null;

    function clock(): string {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    }

    /**
     * The opaque phases pulse and show the clock -- a line that does not change for minutes reads
     * as a hang. The annotation phase counts real files, so it already moves without the pulse.
     */
    function setPhase(label: string, meta: string, waiting: boolean): void {
      phaseEl.textContent = label;
      metaEl.textContent = meta ? `${meta} · ${clock()}` : clock();
      status.classList.toggle("lh-cp-load-status--waiting", waiting);
    }

    let phase: () => void = () => undefined;
    function stopTicker(): void {
      if (ticker !== null) window.clearInterval(ticker);
      ticker = null;
    }

    /*
     * Where a failure is explained. Separate from `status` because status is one line the ticker
     * rewrites every second, and this has to stay put and be read.
     */
    const advice = el("div", "lh-cp-load-advice");
    advice.hidden = true;

    function clearAdvice(): void {
      advice.hidden = true;
      advice.innerHTML = "";
    }

    function addToScope(dir: string): void {
      const lines = parseScope(scopeInput.value);
      if (!lines.includes(dir)) lines.push(dir);
      scopeInput.value = lines.join("\n");
    }

    /**
     * Stop, say why, and where there is something to do about it, hand it over. On `too_large` the
     * server says where the bulk is, and each directory is a control that narrows the scope to it:
     * the fix is picking part of the repository, so the part is what gets pressed.
     */
    function showAdvice(detail: string, dirs?: { dir: string; files: number; bytes: number }[]): void {
      advice.innerHTML = "";
      if (detail) advice.appendChild(el("p", "lh-cp-load-warning", detail));
      const picks = (dirs ?? []).filter((d) => d.dir !== ".");
      if (picks.length) {
        advice.appendChild(el("p", "lh-cp-load-advice-lead", "누르면 볼 파일 범위에 추가됩니다."));
        const list = el("div", "lh-cp-load-dirs");
        for (const d of picks) {
          const pick = el("button", "lh-cp-load-dir");
          pick.type = "button";
          pick.appendChild(el("span", "lh-cp-load-dir-name", d.dir));
          pick.appendChild(el("span", "lh-cp-load-dir-meta", `${d.files}개 · ${formatBytes(d.bytes)}`));
          pick.addEventListener("click", () => {
            addToScope(d.dir);
            scopeInput.focus();
          });
          list.appendChild(pick);
        }
        advice.appendChild(list);
      }
      advice.hidden = advice.childElementCount === 0;
    }

    /** One sentence per cause, because each calls for a different response. */
    function failureText(res: Extract<RepoLoadResponse, { ok: false }>): string {
      switch (res.reason) {
        case "source":
          return "저장소 주소나 폴더 경로를 다시 확인해 주세요.";
        case "clone":
          return "저장소를 받아오지 못했습니다. 주소, 브랜치 이름, 공개 저장소인지 확인해 주세요.";
        case "path":
          return "그 경로에서 폴더를 찾지 못했습니다. 이 컴퓨터에서의 전체 경로를 적어 주세요.";
        case "too_large": {
          const found = res.found ? ` (파일 ${res.found.files}개 · ${formatBytes(res.found.bytes)})` : "";
          const limit = res.limits ? ` 한 번에 파일 ${res.limits.files}개, ${formatBytes(res.limits.bytes)}까지 읽습니다.` : "";
          return `저장소가 큽니다${found}.${limit} 볼 파일 범위를 좁혀 주세요.`;
        }
        case "empty":
          return "읽을 파일이 남지 않았습니다. 볼 파일 범위가 맞는지 확인해 주세요.";
        case "call":
          return "AI 서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.";
      }
    }

    function stopWith(label: string, meta = ""): void {
      stopTicker();
      status.classList.remove("lh-cp-load-status--waiting");
      phaseEl.textContent = label;
      // The clock stays: "it failed" without how long it ran is missing a fact already on screen.
      metaEl.textContent = meta ? `${meta} · ${clock()}` : clock();
      startBtn.disabled = false;
    }

    startBtn.addEventListener("click", async () => {
      const source = sourceInput.value.trim();
      if (!source) {
        phaseEl.textContent = "저장소 주소나 폴더 경로를 입력해 주세요.";
        metaEl.textContent = "";
        sourceInput.focus();
        return;
      }
      clearAdvice();
      const reading: ReadingRequest = {
        goal: goalInput.value.trim(),
        focus: focusInput.value.trim(),
        scope: parseScope(scopeInput.value),
      };
      const ref = refInput.value.trim();
      startBtn.disabled = true;
      startedAt = Date.now();
      // Every exit below clears this: leaving it running would keep writing into an element the
      // panel is about to remove.
      ticker = window.setInterval(() => phase(), 1000);

      phase = () => setPhase("저장소를 받아오는 중...", "", true);
      phase();
      const loaded = await load({ source, ref: ref || null, include: reading.scope });
      if (!loaded.ok) {
        stopWith(failureText(loaded));
        // On too_large the status line already carries the sizes, formatted; the server's own
        // sentence would say the same thing again in raw numbers above the directory list.
        showAdvice(loaded.reason === "too_large" ? "" : loaded.error, loaded.dirs);
        return;
      }

      const proj = projectFromRepo(loaded);
      const size = `파일 ${proj.files.length}개 · ${formatBytes(loaded.total_bytes)}`;
      phase = () => setPhase("코드베이스를 AI 세션에 싣는 중...", size, true);
      phase();
      if (!(await reseedSession(live, proj))) {
        stopWith("코드베이스를 AI 세션에 싣지 못했습니다. 다시 눌러 주세요.", size);
        return;
      }

      currentProject = proj;
      request = reading;
      // Announce before rendering: loading the project immediately emits its first file-seen
      // event, and the owner has to be able to set up storage for it first.
      onProjectLoaded?.(proj, {
        kind: "repo",
        source: loaded.source,
        ref: loaded.ref,
        commit: loaded.commit,
        request: reading,
      });

      const paths = proj.files.map((f) => f.path);
      let first: string[] = [];
      if (paths.length > ENTRY_ANNOTATE_MAX && (reading.goal || reading.focus)) {
        phase = () => setPhase("먼저 읽을 파일을 고르는 중...", size, true);
        phase();
        first = await pickFocusFiles(live, proj, reading);
      }
      const order = annotationOrder(paths, first);

      // The files read first are annotated here, while the learner is still on the waiting screen
      // and has nothing to click (design 08 §3.2). Only those: past ENTRY_ANNOTATE_MAX the wait
      // would grow with the repository, so the rest are written behind the learner.
      annotations = await annotateProject(
        live,
        proj,
        (done, total, path) => {
          const at = path ? `(${done + 1}/${total}) ${path}` : `(${total}/${total})`;
          phase = () => setPhase("설명을 다는 중...", at, false);
          phase();
        },
        { paths: order.slice(0, ENTRY_ANNOTATE_MAX), request: reading },
      );
      props.onAnnotations?.(annotations);

      stopTicker();
      panel.remove();
      panes.style.display = "";
      // Open the first file the learner is meant to read, not the first one in the tree.
      loadProject(proj, order[0]);

      queue.push([
        { kind: "outline" },
        ...order.slice(ENTRY_ANNOTATE_MAX).map((path) => ({ kind: "annotate" as const, path })),
      ]);
    });

    panel.appendChild(field("저장소", sourceInput));
    panel.appendChild(field("브랜치 또는 태그 (선택)", refInput));
    panel.appendChild(field("학습 목적과 수준", goalInput));
    panel.appendChild(field("집중할 곳", focusInput));
    panel.appendChild(field("볼 파일 범위 (선택)", scopeInput, "한 줄에 경로나 패턴 하나. 비우면 전체를 읽습니다."));
    panel.appendChild(startBtn);
    panel.appendChild(status);
    panel.appendChild(advice);
    return panel;
  }

  // ── project + file selection ────────────────────────────────────────────────

  function loadProject(proj: CodeProject, firstPath?: string): void {
    titleEl.textContent = proj.title;
    setSummary(proj.summary);
    filePanel.render(proj, buildTree(proj.files));
    filePanel.markSeen(seenPaths);
    const first = (firstPath && fileByPath(proj, firstPath)) || proj.files[0];
    if (first) selectFile(first.path);
  }

  /**
   * The note-link slot for the file on screen: its notes, or what can be done about having none.
   *
   * "Pending" is read from the queue rather than stored, so it cannot outlive the job it describes.
   * A file with no entry at all is offered a "make" only where a session could make it -- never on
   * an offline instance, and never sent on its own: opening a reopened project spends nothing.
   */
  function paintAnnotationState(): void {
    if (!currentProject || !selectedPath) return;
    const file = fileByPath(currentProject, selectedPath);
    if (!file) return;
    const forFile = annotations.files[file.path];
    codePanel.setAnnotations(
      forFile?.status === "ok" ? parseAnnotations(forFile.items, file.content.split(String.fromCharCode(10)).length).items : [],
    );
    const path = file.path;
    if (!session) codePanel.setAnnotationAction("none", () => undefined);
    else if (queue.has(annotateKey(path))) codePanel.setAnnotationAction("pending", () => undefined);
    else if (forFile?.status === "failed") codePanel.setAnnotationAction("retry", () => requestAnnotation(path));
    else if (!forFile) codePanel.setAnnotationAction("make", () => requestAnnotation(path));
    else codePanel.setAnnotationAction("none", () => undefined);
  }

  function selectFile(path: string): void {
    if (!currentProject) return;
    const file = fileByPath(currentProject, path);
    if (!file) return;

    selectedPath = path;
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      onFileSeen?.(path);
    }

    filePanel.markSelected(path);
    filePanel.markSeen(seenPaths);
    codePanel.show(file.path, file.content, file.lang);
    // Regions collected in this file stay visible when returning to it.
    codePanel.markScraps(scraps.filter((s) => s.path === path).map((s) => s.lines));
    // A file still waiting for its notes moves to the front of the queue the moment it is opened,
    // so the wait is the job in flight rather than every file ahead of it in tree order.
    if (session && !annotations.files[path]) queue.bump(annotateKey(path));
    // Parsed there rather than at storage time: the file's own length is what separates a real
    // line range from one the model invented, and only this side knows it.
    paintAnnotationState();
    // A run in progress outlives a file switch -- including the switch the run itself caused.
    // `show()` has just rebuilt every line, so the markers have to be put back.
    applyDebugMarks();
    // Not while a request is in flight: re-arming here is what let a file click cancel the
    // lock a running call had taken.
    if (session && !aiBusy && !sessionUnrecoverable) aiPanel.setEnabled(true);
    updateTargetHint(null);
  }

  /**
   * Swap which pair of panels the grid shows. `display` rather than mount/unmount, so nothing
   * the learner built up -- scroll, selection, the thread -- is thrown away by a tab click.
   */
  function setView(next: CodeprojView): void {
    view = next;
    const code = next === "code";
    filePanel.root.style.display = code ? "" : "none";
    codePanel.root.style.display = code ? "" : "none";
    conceptView.rail.style.display = code ? "none" : "";
    conceptView.reading.style.display = code ? "none" : "";
    // A run is paused, not ended, by reading a concept: the panels are only hidden, so the
    // markers and the position survive and Space picks up where it left off. Space is released
    // while away so the concepts view keeps ordinary page scrolling.
    codePanel.setDebugActive(code && !!run);
    if (!code) codePanel.showDebug(0, null);
    else if (run) paintDebug();
    updateTargetHint(codePanel.selection());
  }

  /**
   * Rebuild one failed document on demand. The pass itself never retries; the learner does. It
   * goes through the queue's front rather than straight to the model, so a retry pressed while the
   * background is busy does not become a third concurrent call.
   */
  function retryConcept(entry: ConceptEntry): void {
    if (!session || !concepts) return;
    entry.status = "pending";
    entry.reason = undefined;
    conceptView.render(concepts);
    queue.push([{ kind: "concept", id: entry.seed.concept_id }], { front: true });
  }

  function publishConcepts(set: ConceptSet): void {
    concepts = set;
    conceptView.render(set);
    const p = conceptProgress(set);
    props.onConceptProgress?.(p.done, p.total);
    props.onConcepts?.(set);
  }

  function updateTargetHint(range: [number, number] | null): void {
    // The debug control is offered by the same thing that makes a question possible -- a chosen
    // line -- so it is refreshed from the same place rather than needing a slot of its own.
    updateDebugControl();
    // In the concepts view the subject of a question is the open concept, not the selected line.
    if (view === "concepts") {
      aiPanel.setTargetHint(openConcept ? `대상: 개념 · ${openConcept.seed.title}` : "");
      return;
    }
    if (!selectedPath) {
      aiPanel.setTargetHint("");
      return;
    }
    aiPanel.setTargetHint(range ? `대상: ${selectedPath} (${range[0]}-${range[1]}행)` : `대상: ${selectedPath}`);
  }

  // ── AI exchanges (both resume the same session) ─────────────────────────────

  function currentTarget() {
    if (!selectedPath || !currentProject) return null;
    const file = fileByPath(currentProject, selectedPath);
    if (!file) return null;
    const lines = codePanel.selection() ?? undefined;
    return { target: { path: selectedPath, lines }, content: file.content };
  }

  async function runExplain(lens: Lens): Promise<void> {
    if (!session) return;

    // A filled basket is the subject; otherwise the current file or selection is.
    if (scraps.length) {
      const entry = aiPanel.startEntry(`${LENS_LABELS[lens]} · ${scraps.length}개 구간`);
      beginCall();
      const text = await explainScraps(session, scraps, lens, reseedFor(entry));
      showAnswer(entry, text);
      endCall(entry);
      onExchange?.({ kind: "explain", lens, path: scraps[0].path, scrapCount: scraps.length, answer: text });
      return;
    }

    const ctx = currentTarget();
    if (!ctx) return;
    const where = ctx.target.lines ? ` (${ctx.target.lines[0]}-${ctx.target.lines[1]}행)` : "";
    const entry = aiPanel.startEntry(`${LENS_LABELS[lens]} · ${ctx.target.path}${where}`);
    beginCall();
    const text = await explain(session, { target: ctx.target, lens }, ctx.content, reseedFor(entry));
    showAnswer(entry, text);
    endCall(entry);
    onExchange?.({ kind: "explain", lens, path: ctx.target.path, lines: ctx.target.lines, answer: text });
  }

  /**
   * The annotation covering the asked-about lines, when there is one. A short answer starts
   * from what the annotation layer already established instead of rediscovering it.
   */
  function groundsFor(target: { path: string; lines?: [number, number] }): { what: string; why?: string } | undefined {
    if (!target.lines) return undefined;
    const forFile = annotations.files[target.path];
    if (forFile?.status !== "ok") return undefined;
    const file = currentProject && fileByPath(currentProject, target.path);
    if (!file) return undefined;
    const items = parseAnnotations(forFile.items, file.content.split(String.fromCharCode(10)).length).items;
    const hit = items.find(
      (a) => a.kind !== "file" && a.target.lines[0] <= target.lines![0] && a.target.lines[1] >= target.lines![0],
    );
    return hit ? { what: hit.what, why: hit.why } : undefined;
  }

  async function runAsk(question: string, depth: AnswerDepth = "semi"): Promise<void> {
    if (!session) return;

    if (scraps.length) {
      const entry = aiPanel.startEntry(`질문 · ${question}`, { depth });
      beginCall();
      // No grounds here on purpose: a basket spans several regions and often several files,
      // and `grounds` carries one annotation. Sending the first region's note as if it covered
      // the rest would be worse than sending none.
      const text = await ask(
        session,
        { target: { path: scraps[0].path }, question, scraps, depth },
        undefined,
        reseedFor(entry),
      );
      showAnswer(entry, text, depth);
      endCall(entry);
      offerPromotion(entry, question, depth);
      onExchange?.({ kind: "ask", path: scraps[0].path, question, scrapCount: scraps.length, depth, answer: text });
      return;
    }

    const ctx = currentTarget();
    if (!ctx) return;
    const entry = aiPanel.startEntry(`질문 · ${question}`, { depth });
    beginCall();
    const text = await ask(
      session,
      { target: ctx.target, question, depth, grounds: depth === "semi" ? groundsFor(ctx.target) : undefined },
      ctx.content,
      reseedFor(entry),
    );
    showAnswer(entry, text, depth);
    endCall(entry);
    offerPromotion(entry, question, depth);
    onExchange?.({
      kind: "ask",
      path: ctx.target.path,
      lines: ctx.target.lines,
      question,
      depth,
      answer: text,
    });
  }

  /**
   * A short answer always offers the way up. Asking again appends a new entry rather than
   * replacing this one: the thread is a log of what was asked, not a view of the latest answer.
   */
  function offerPromotion(
    entry: { setFooter(label: string, run: () => void): void },
    question: string,
    depth: AnswerDepth,
  ): void {
    if (depth !== "semi") return;
    entry.setFooter("전체 해설로 보기", () => {
      void runAsk(question, "full");
    });
  }

  return {
    setView,
    // Offered when there is something to read, or something on its way. An offline instance with
    // no stored concepts gets no tab at all rather than a tab onto an empty page.
    hasConcepts: () => (concepts?.entries.length ?? 0) > 0,
  };
}

// Public surface: the pure model, the prompt builders and the session calls are re-exported so
// callers and tests keep importing one module path.
export * from "./model";
export { LENS_LABELS, LENS_ORDER } from "./prompts";
export { explain, ask } from "./session";
export type { ConceptDoc, ConceptEntry, ConceptSeed, ConceptSet } from "./concepts";
export { AiSession };
export { createAiClient } from "../../src/ai/client";
