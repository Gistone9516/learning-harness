// WHAT: AI-generated project, IDE-shaped read-only comprehension with session-based explanations and questions.
// DEPS: web/src/ai (ai_server client). No npm UI libs; tree, code panel and AI panel are hand-rolled DOM.
// INPUT: a pre-baked `project` (GeneratedProject), or { topic, scale, seed? } generated live — injected, no subject literal.
// EVENTS: file-seen flags via onFileSeen; generated projects via onProjectGenerated; AI exchanges via onExchange.
// AI: optional — with a session: generation (/ai new session, force_json) + explain/ask (/ai resume). With session:null: read a pre-baked project offline (AI panel hidden).
// CONSTRAINTS: subject-agnostic, secrets-gated, session-resume (load-once->resume cost model).
// DEMO: mountCodeproj(el, { session:null, project }) reads a canned GeneratedProject fully offline (no live AI).
//
// Layout is the three-pane IDE shape: files left, code centre, AI right. This file only assembles
// the panels and routes events; the pure model, the prompts, the AI calls and the DOM panels each
// live in their own module beside it.

import { AiSession } from "../../src/ai/client";
import type { GeneratedProject, GenerateInput, Lens, Scrap } from "./model";
import { buildTree, canAddScrap, fileByPath, sliceLines, SCRAP_MAX_COUNT, SCRAP_MAX_LINES } from "./model";
import { generateProject, explain, explainScraps, ask, reseedSession, type Reseed } from "./session";
import { LENS_LABELS } from "./prompts";
import { createAiPanel, createCodePanel, createFilePanel, el } from "./view";
import { parseComposed } from "./components/parse";
import { renderComposed, type RenderContext } from "./components/render";

export interface ExchangeEvent {
  kind: "explain" | "ask";
  lens?: Lens;
  path: string;
  lines?: [number, number];
  question?: string;
  /** Number of collected regions, when the exchange was about a basket rather than one place. */
  scrapCount?: number;
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
}

export function mountCodeproj(container: HTMLElement, props: CodeprojProps): void {
  const { session, project, initialInput, onFileSeen, onProjectGenerated, onExchange } = props;
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
  const titleEl = el("h2", "lh-cp-title", "코드 프로젝트 탐색");
  const summaryEl = el("p", "lh-cp-summary", "");
  header.appendChild(titleEl);
  header.appendChild(summaryEl);
  container.appendChild(header);

  const panes = el("div", "lh-cp-panes");
  const filePanel = createFilePanel((path) => selectFile(path));
  const codePanel = createCodePanel();
  const aiPanel = createAiPanel({
    onExplain: (lens) => void runExplain(lens),
    onAsk: (question) => void runAsk(question),
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
  function showAnswer(entry: { setBody(t: string): void; setContent(n: HTMLElement): void }, text: string): void {
    const composed = parseComposed(text);
    if (!composed) {
      entry.setBody(text);
      return;
    }
    entry.setContent(renderComposed(composed, renderContext()));
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
    summaryEl.textContent = "표시할 프로젝트가 없습니다 (사전 생성 프로젝트 주입 또는 AI 설정 필요).";
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
      ["small", "소 (3-6 파일)"],
      ["medium", "중 (7-15 파일)"],
      ["large", "대 (16-30 파일)"],
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
      status.textContent = "프로젝트를 생성하는 중...";

      const result = await generateProject(session!, input);
      if (!result) {
        status.textContent = "프로젝트 생성에 실패했습니다. 다시 시도해 주세요.";
        startBtn.disabled = false;
        return;
      }

      currentProject = result;
      panel.remove();
      // Announce before rendering: loading the project immediately emits its first file-seen
      // event, and the owner has to be able to set up storage for it first.
      onProjectGenerated?.(result, input);
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
    summaryEl.textContent = proj.summary;
    filePanel.render(proj, buildTree(proj.files));
    filePanel.markSeen(seenPaths);
    if (proj.files.length > 0) selectFile(proj.files[0].path);
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
      onExchange?.({ kind: "explain", lens, path: scraps[0].path, scrapCount: scraps.length });
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
    onExchange?.({ kind: "explain", lens, path: ctx.target.path, lines: ctx.target.lines });
  }

  async function runAsk(question: string): Promise<void> {
    if (!session) return;

    if (scraps.length) {
      const entry = aiPanel.startEntry(`질문 · ${question}`);
      beginCall();
      const text = await ask(
        session,
        { target: { path: scraps[0].path }, question, scraps },
        undefined,
        reseedFor(entry),
      );
      showAnswer(entry, text);
      endCall(entry);
      onExchange?.({ kind: "ask", path: scraps[0].path, question, scrapCount: scraps.length });
      return;
    }

    const ctx = currentTarget();
    if (!ctx) return;
    const entry = aiPanel.startEntry(`질문 · ${question}`);
    beginCall();
    const text = await ask(session, { target: ctx.target, question }, ctx.content, reseedFor(entry));
    showAnswer(entry, text);
    endCall(entry);
    onExchange?.({
      kind: "ask",
      path: ctx.target.path,
      lines: ctx.target.lines,
      question,
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
