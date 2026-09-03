// WHAT: AI-generated project, IDE-shaped read-only comprehension with session-based explanations and questions.
// DEPS: web/src/ai (ai_server client). No npm UI libs; tree, code panel and AI panel are hand-rolled DOM.
// INPUT: a pre-baked `project` (GeneratedProject), or { topic, scale, seed? } generated live — injected, no subject literal.
// INPUT: `annotations` (AnnotationSet) — the explanation layer, injected; the part renders it and never stores it.
// EVENTS: file-seen flags via onFileSeen; generated projects via onProjectGenerated; AI exchanges via onExchange.
// EVENTS: the freshly built annotation layer via onAnnotations — the part makes it, the owner stores it.
// AI: optional — with a session: generation (/ai new session, force_json) + explain/ask (/ai resume). With session:null: read a pre-baked project offline (AI panel hidden).
// CONSTRAINTS: subject-agnostic, secrets-gated, session-resume (load-once->resume cost model).
// CONSTRAINTS: generation is the only xhigh call; annotations, explanations and questions are medium.
// DEMO: mountCodeproj(el, { session:null, project }) reads a canned GeneratedProject fully offline (no live AI).
//
// Layout is the three-pane IDE shape: files left, code centre, AI right. This file only assembles
// the panels and routes events; the pure model, the prompts, the AI calls and the DOM panels each
// live in their own module beside it.

import { AiSession } from "../../src/ai/client";
import type { GeneratedProject, GenerateInput, Lens, Scrap } from "./model";
import { buildTree, canAddScrap, fileByPath, sliceLines, SCRAP_MAX_COUNT, SCRAP_MAX_LINES } from "./model";
import { generateProject, annotateProject, annotateFile, explain, explainScraps, ask, reseedSession, type Reseed } from "./session";
import { parseAnnotations, type AnnotationSet } from "./annotations";
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
  // Live AI session, or null for offline reading of a pre-baked `project` (generation/AI disabled).
  session: AiSession | null;
  project?: GeneratedProject;
  /** Pre-filled generation inputs (e.g. from an accepted proposal); the learner still starts it. */
  initialInput?: Partial<GenerateInput>;
  onFileSeen?: (path: string) => void;
  onProjectGenerated?: (project: GeneratedProject, input: GenerateInput) => void;
  onExchange?: (event: ExchangeEvent) => void;
  /**
   * The annotation layer for this project, keyed by file path. A snapshot: the part renders what
   * it is given and never writes it back, because the record id is the project id and only the
   * flow knows that id.
   */
  annotations?: AnnotationSet;
  /**
   * Emitted once, right after generation, with the annotation layer just built for the project.
   * The part cannot store it: the record is keyed by project id and only the flow has that.
   */
  onAnnotations?: (set: AnnotationSet) => void;
}

export function mountCodeproj(container: HTMLElement, props: CodeprojProps): void {
  const { session, project, initialInput, onFileSeen, onProjectGenerated, onExchange } = props;
  // Reassigned once when a generation builds its own layer, so the first file opened after
  // generating shows notes without waiting for a remount.
  let annotations = props.annotations ?? { files: {} };
  container.innerHTML = "";
  container.classList.add("lh-codeproj");

  let currentProject: GeneratedProject | null = project ?? null;
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
      // Generation-class cost behind an explanation-class click, so it says so and keeps a live
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

  panes.appendChild(filePanel.root);
  panes.appendChild(codePanel.root);
  panes.appendChild(aiPanel.root);
  container.appendChild(panes);

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

  // ── generation (only starts on an explicit action) ───────────────────────────

  if (!currentProject && session) {
    container.insertBefore(buildGeneratePanel(), panes);
  } else if (!currentProject) {
    setSummary("표시할 프로젝트가 없습니다 (사전 생성 프로젝트 주입 또는 AI 설정 필요).");
  } else {
    loadProject(currentProject);
  }

  function buildGeneratePanel(): HTMLElement {
    const panel = el("div", "lh-cp-generate-panel");
    const topicInput = el("input", "lh-cp-topic-input");
    topicInput.type = "text";
    topicInput.placeholder = "예: 간단한 메모 앱";
    topicInput.value = initialInput?.topic ?? "";

    const scaleSelect = el("select", "lh-cp-scale-select");
    for (const [val, label] of [
      // These must match SCALE_GUIDE in prompts.ts: the form tells the learner what the
      // prompt tells the model, and the two drifting apart is a lie the screen tells.
      ["small", "소 (6-9 파일)"],
      ["medium", "중 (10-16 파일)"],
      ["large", "대 (18-30 파일)"],
    ] as const) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      scaleSelect.appendChild(o);
    }
    scaleSelect.value = initialInput?.scale ?? "medium";

    const seedInput = el("input", "lh-cp-seed-input");
    seedInput.type = "text";
    seedInput.placeholder = "예: Python, 외부 라이브러리 없이";
    seedInput.value = initialInput?.seed ?? "";

    const startBtn = el("button", "lh-cp-generate-btn", "프로젝트 생성");
    const status = el("div", "lh-cp-generate-status", "");
    const phaseEl = el("span", "lh-cp-generate-phase", "");
    // Counts, paths and the clock go in their own span: fixed width digits so the line does not
    // twitch every second, and an ellipsis so a long path cannot push the phase text around.
    const metaEl = el("span", "lh-cp-generate-meta", "");
    status.appendChild(phaseEl);
    status.appendChild(metaEl);

    let startedAt = 0;
    let ticker: number | null = null;

    function clock(): string {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    }

    /**
     * Phase 1 is one opaque call of several minutes with nothing to count, so it pulses and
     * shows the clock -- the docs call for elapsed time on a generation-class wait, and a line
     * that does not change for four minutes reads as a hang. Phase 2 counts real files, so it
     * already moves and does not need the animation on top.
     */
    function setPhase(text: string, meta: string, waiting: boolean): void {
      phaseEl.textContent = text;
      metaEl.textContent = meta ? `${meta} · ${clock()}` : clock();
      status.classList.toggle("lh-cp-generate-status--waiting", waiting);
    }

    let phase: () => void = () => undefined;
    function stopTicker(): void {
      if (ticker !== null) window.clearInterval(ticker);
      ticker = null;
    }

    startBtn.addEventListener("click", async () => {
      const topic = topicInput.value.trim();
      if (!topic) {
        status.textContent = "주제를 입력해 주세요.";
        return;
      }
      const input: GenerateInput = {
        topic,
        scale: scaleSelect.value as GenerateInput["scale"],
        seed: seedInput.value.trim() || undefined,
      };
      startBtn.disabled = true;
      startedAt = Date.now();
      phase = () => setPhase("프로젝트를 생성하는 중...", "", true);
      phase();
      // Every exit below clears this: leaving it running would keep writing into an element the
      // panel is about to remove.
      ticker = window.setInterval(() => phase(), 1000);

      const result = await generateProject(session!, input);
      if (!result) {
        stopTicker();
        status.classList.remove("lh-cp-generate-status--waiting");
        phaseEl.textContent = "프로젝트 생성에 실패했습니다. 다시 시도해 주세요.";
        metaEl.textContent = "";
        startBtn.disabled = false;
        return;
      }

      currentProject = result;
      // Announce before rendering: loading the project immediately emits its first file-seen
      // event, and the owner has to be able to set up storage for it first.
      onProjectGenerated?.(result, input);

      // The explanation layer is built here, while the learner is still on the waiting screen and
      // has nothing to click. Doing it after they enter would put their first question behind a
      // chunk of it, and the wait would look like the tool being slow (design 08 §3.2).
      annotations = await annotateProject(session!, result, (done, total, path) => {
        const at = path ? `(${done + 1}/${total}) ${path}` : `(${total}/${total})`;
        phase = () => setPhase("설명을 다는 중...", at, false);
        phase();
      });
      props.onAnnotations?.(annotations);

      stopTicker();
      panel.remove();
      loadProject(result);
    });

    panel.appendChild(el("label", "", "주제"));
    panel.appendChild(topicInput);
    panel.appendChild(el("label", "", "규모"));
    panel.appendChild(scaleSelect);
    panel.appendChild(el("label", "", "제약/스택 (선택)"));
    panel.appendChild(seedInput);
    panel.appendChild(startBtn);
    panel.appendChild(status);
    return panel;
  }

  // ── project + file selection ────────────────────────────────────────────────

  function loadProject(proj: GeneratedProject): void {
    titleEl.textContent = proj.title;
    setSummary(proj.summary);
    filePanel.render(proj, buildTree(proj.files));
    filePanel.markSeen(seenPaths);
    if (proj.files.length > 0) selectFile(proj.files[0].path);
  }


  /** Rebuild one file's notes on demand. The pass itself never retries; the learner does. */
  async function retryAnnotations(path: string, content: string): Promise<void> {
    if (!session) return;
    codePanel.offerAnnotationRetry(false, () => undefined);
    const built = await annotateFile(session, path, content);
    annotations = { files: { ...annotations.files, [path]: built } };
    props.onAnnotations?.(annotations);
    if (selectedPath === path) {
      codePanel.setAnnotations(built.status === "ok" ? parseAnnotations(built.items, content.split(String.fromCharCode(10)).length).items : []);
      codePanel.offerAnnotationRetry(built.status === "failed", () => {
        void retryAnnotations(path, content);
      });
    }
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
    // Parsed here rather than at storage time: the file's own length is what separates a real
    // line range from one the model invented, and only this side knows it.
    const forFile = annotations.files[path];
    codePanel.setAnnotations(
      forFile?.status === "ok" ? parseAnnotations(forFile.items, file.content.split(String.fromCharCode(10)).length).items : [],
    );
    // Only where a retry could actually run: no session means nothing to ask, and a file that
    // was never annotated at all is not a failure to recover from.
    codePanel.offerAnnotationRetry(!!session && forFile?.status === "failed", () => {
      void retryAnnotations(path, file.content);
    });
    // Not while a request is in flight: re-arming here is what let a file click cancel the
    // lock a running call had taken.
    if (session && !aiBusy && !sessionUnrecoverable) aiPanel.setEnabled(true);
    updateTargetHint(null);
  }

  function updateTargetHint(range: [number, number] | null): void {
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
}

// Public surface: the pure model, the prompt builders and the session calls are re-exported so
// callers and tests keep importing one module path.
export * from "./model";
export { LENS_LABELS, LENS_ORDER, QUALITY_CLAUSE } from "./prompts";
export { generateProject, explain, ask } from "./session";
export { AiSession };
export { createAiClient } from "../../src/ai/client";
