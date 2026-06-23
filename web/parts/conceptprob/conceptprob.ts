// WHAT: area->concept->problem study: AI concept reading + deterministically graded linked problems.
// DEPS: web/src/ai/client (AiSession, AiClient, AiResponse), web/src/grade/grade (score, AnswerSpec).
// INPUT: injected areas [{key,label,icon?,aliases?}] + concept outline [{concept_id,title}] per area.
// EVENTS: concept-read flag and per-problem verdicts {module:"conceptprob",item_id,read?|verdict?,ts}.
// AI: yes -- concept+problem generation (POST /ai new session) + click-to-deepen (POST /ai resume). Grading is token 0.
// CONSTRAINTS: subject-agnostic, secrets-gated, token0-grading, binary.
// DEMO: mountConceptprob(el, {session, areas, conceptOutline}) with a canned GeneratedConcept (no live AI).

import { AiSession, type AiClient, type AiResponse } from "../../src/ai/client";
import { score, type AnswerSpec, type ScoreInput } from "../../src/grade/grade";

// ── Types ────────────────────────────────────────────────────────────────────

export type GradeMode = "exact" | "keyword" | "cloze";

export interface ProblemDef {
  card_id: string;
  type: "func" | "proc" | "cloze" | "judge";
  grade_mode: GradeMode;
  front: Record<string, unknown>;
  answer_spec: AnswerSpec;
  links?: { concept_ref?: string };
}

export interface GeneratedConcept {
  area: string;
  concept_id: string;
  title: string;
  body: string;
  problems: ProblemDef[];
}

export interface AreaDef {
  key: string;
  label: string;
  icon?: string;
  aliases?: string[];
}

export interface ConceptSeed {
  concept_id: string;
  title: string;
}

export interface IndexNode {
  area: AreaDef;
  concepts: ConceptSeed[];
}

export interface GradeResult {
  verdict: "correct" | "incorrect";
  matched: string[];
  missed: string[];
  concept_ref?: string;
}

export interface ProgressRecord {
  module: string;
  item_id: string;
  verdict?: "correct" | "incorrect";
  read?: boolean;
  ts: number;
}

// ── Pure core (no DOM, no live AI) ──────────────────────────────────────────

/**
 * Strip markdown/JSON code fences and parse JSON tolerantly.
 * Returns null if parsing fails.
 */
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Parse a GeneratedConcept from AI-returned text (tolerant: strips code fences). */
export function parseConcept(text: string): GeneratedConcept | null {
  try {
    const cleaned = stripFences(text);
    const raw = JSON.parse(cleaned) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj["area"] !== "string" ||
      typeof obj["concept_id"] !== "string" ||
      typeof obj["title"] !== "string" ||
      typeof obj["body"] !== "string" ||
      !Array.isArray(obj["problems"])
    ) {
      return null;
    }
    const problems: ProblemDef[] = (obj["problems"] as unknown[]).map((p) => {
      const pd = p as Record<string, unknown>;
      return {
        card_id: String(pd["card_id"] ?? ""),
        type: (pd["type"] ?? "func") as ProblemDef["type"],
        grade_mode: (pd["grade_mode"] ?? "exact") as GradeMode,
        front: (pd["front"] ?? {}) as Record<string, unknown>,
        answer_spec: (pd["answer_spec"] ?? { normalize: [] }) as AnswerSpec,
        links: pd["links"] as ProblemDef["links"] | undefined,
      };
    });
    return {
      area: obj["area"] as string,
      concept_id: obj["concept_id"] as string,
      title: obj["title"] as string,
      body: obj["body"] as string,
      problems,
    };
  } catch {
    return null;
  }
}

/**
 * Build the left-panel accordion model from injected areas and concept outline.
 * conceptOutline maps area key to its list of concept seeds.
 */
export function buildIndex(
  areas: AreaDef[],
  conceptOutline: Record<string, ConceptSeed[]>,
): IndexNode[] {
  return areas.map((area) => ({
    area,
    concepts: conceptOutline[area.key] ?? [],
  }));
}

/**
 * Grade a single problem against the user's answer (token 0, binary).
 * user_answer is string for exact/keyword; string[] for cloze.
 */
export function gradeProblem(
  problem: ProblemDef,
  userAnswer: string | string[],
): GradeResult {
  let inp: ScoreInput;
  switch (problem.grade_mode) {
    case "exact":
      inp = {
        mode: "exact",
        user_answer: userAnswer as string,
        answer_spec: problem.answer_spec,
      };
      break;
    case "keyword":
      inp = {
        mode: "keyword",
        user_answer: userAnswer as string,
        answer_spec: problem.answer_spec,
      };
      break;
    case "cloze":
      inp = {
        mode: "cloze",
        user_answer: userAnswer as string[],
        answer_spec: problem.answer_spec,
      };
      break;
    default: {
      const _: never = problem.grade_mode;
      void _;
      inp = {
        mode: "exact",
        user_answer: userAnswer as string,
        answer_spec: problem.answer_spec,
      };
    }
  }
  const result = score(inp);
  return {
    verdict: result.verdict,
    matched: result.matched,
    missed: result.missed,
    concept_ref: problem.links?.concept_ref,
  };
}

// ── AI calls ─────────────────────────────────────────────────────────────────

/**
 * Generate a concept + problems via AI (new session).
 * Returns GeneratedConcept on success, null on AI/parse failure.
 */
export async function generateConcept(
  session: AiSession,
  params: { area: string; concept_id: string; title: string; scope?: string },
): Promise<{ concept: GeneratedConcept | null; response: AiResponse }> {
  const prompt = JSON.stringify(params);
  const res = await session.send({
    prompt,
    effort: "medium",
  });
  if (!res.ok) return { concept: null, response: res };
  const concept = parseConcept(res.text);
  return { concept, response: res };
}

/**
 * Deepen a concept section/term by resuming the same session (small call).
 * Returns the explanation text.
 */
export async function deepen(
  session: AiSession,
  params: { target: string; lens: "explain" | "example" | "simpler" },
): Promise<AiResponse> {
  const prompt = JSON.stringify(params);
  return session.send({ prompt, effort: "low" });
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function saveProgress(subjectKey: string, record: ProgressRecord): void {
  const key = `lh:${subjectKey}:conceptprob:${record.item_id}`;
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // localStorage unavailable (test env): silently skip
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/** Minimal read-only markdown-ish renderer: renders body text into a <div> with basic formatting. */
function renderBody(container: HTMLElement, body: string): void {
  container.innerHTML = "";
  const pre = document.createElement("pre");
  pre.className = "lh-concept-body";
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.textContent = body;
  container.appendChild(pre);
}

/** Render a single problem block and return the answer submission handler. */
function renderProblem(
  container: HTMLElement,
  problem: ProblemDef,
  onGraded: (result: GradeResult) => void,
): void {
  const wrapper = document.createElement("div");
  wrapper.className = "lh-problem";
  wrapper.dataset["cardId"] = problem.card_id;

  const frontEl = document.createElement("div");
  frontEl.className = "lh-problem-front";

  // Render front: for cloze, show text with blank placeholders; otherwise show prompt/text.
  const frontText =
    typeof problem.front["text"] === "string"
      ? problem.front["text"]
      : typeof problem.front["prompt"] === "string"
        ? problem.front["prompt"]
        : JSON.stringify(problem.front);
  frontEl.textContent = frontText as string;
  wrapper.appendChild(frontEl);

  // Build answer inputs
  const isCloze = problem.grade_mode === "cloze";
  const blanks: string[][] = problem.answer_spec.blanks ?? [];
  const inputEls: HTMLInputElement[] = [];

  if (isCloze && blanks.length > 0) {
    const clozeWrap = document.createElement("div");
    clozeWrap.className = "lh-problem-cloze";
    blanks.forEach((_candidates, idx) => {
      const label = document.createElement("label");
      label.textContent = `빈칸 ${idx + 1}: `;
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "lh-cloze-input";
      inp.setAttribute("aria-label", `빈칸 ${idx + 1}`);
      inputEls.push(inp);
      label.appendChild(inp);
      clozeWrap.appendChild(label);
    });
    wrapper.appendChild(clozeWrap);
  } else {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "lh-problem-input";
    inp.placeholder = "답 입력...";
    inp.setAttribute("aria-label", "답변 입력");
    inputEls.push(inp);
    wrapper.appendChild(inp);
  }

  const submitBtn = document.createElement("button");
  submitBtn.className = "lh-problem-submit";
  submitBtn.textContent = "채점";
  wrapper.appendChild(submitBtn);

  const resultEl = document.createElement("div");
  resultEl.className = "lh-problem-result";
  wrapper.appendChild(resultEl);

  submitBtn.addEventListener("click", () => {
    const userAnswer: string | string[] = isCloze
      ? inputEls.map((el) => el.value)
      : (inputEls[0]?.value ?? "");

    const result = gradeProblem(problem, userAnswer);
    resultEl.textContent = result.verdict === "correct" ? "정답" : "오답";
    resultEl.dataset["verdict"] = result.verdict;

    if (result.missed.length > 0) {
      const feedbackEl = document.createElement("div");
      feedbackEl.className = "lh-problem-feedback";
      feedbackEl.textContent = `놓친 키워드: ${result.missed.join(", ")}`;
      resultEl.appendChild(feedbackEl);
    }

    if (result.verdict === "incorrect" && result.concept_ref) {
      const retrace = document.createElement("a");
      retrace.className = "lh-retrace-link";
      retrace.href = `#${result.concept_ref}`;
      retrace.textContent = "개념 다시 보기";
      resultEl.appendChild(retrace);
    }

    onGraded(result);
  });

  container.appendChild(wrapper);
}

// ── DOM mount ─────────────────────────────────────────────────────────────────

export interface ConceptprobProps {
  session: AiSession | AiClient;
  areas: AreaDef[];
  conceptOutline: Record<string, ConceptSeed[]>;
  subjectKey?: string;
  onProgress?: (record: ProgressRecord) => void;
}

/**
 * Mount the concept-problem module.
 * LEFT: area->concept accordion. MAIN top: concept body. MAIN bottom: problem block.
 */
export function mountConceptprob(
  container: HTMLElement,
  props: ConceptprobProps,
): void {
  const { areas, conceptOutline, subjectKey = "demo", onProgress } = props;

  // Normalize session: if given a plain AiClient, wrap it in an AiSession
  const session =
    props.session instanceof AiSession
      ? props.session
      : new AiSession(props.session as AiClient);

  container.innerHTML = "";
  container.className = "lh-conceptprob";

  // ── Root layout ─────────────────────────────────────────────────────────────
  const layout = document.createElement("div");
  layout.className = "lh-conceptprob-layout";
  container.appendChild(layout);

  // ── Left panel ──────────────────────────────────────────────────────────────
  const leftPanel = document.createElement("nav");
  leftPanel.className = "lh-concept-nav";
  leftPanel.setAttribute("aria-label", "개념 목록");

  const index = buildIndex(areas, conceptOutline);

  // Per-area accordion
  for (const node of index) {
    const areaEl = document.createElement("details");
    areaEl.className = "lh-area-accordion";
    areaEl.open = true;

    const summary = document.createElement("summary");
    summary.className = "lh-area-label";
    const icon = node.area.icon ? `${node.area.icon} ` : "";
    summary.textContent = `${icon}${node.area.label}`;
    areaEl.appendChild(summary);

    const conceptList = document.createElement("ul");
    conceptList.className = "lh-concept-list";

    for (const seed of node.concepts) {
      const li = document.createElement("li");
      li.className = "lh-concept-item";

      const btn = document.createElement("button");
      btn.className = "lh-concept-btn";
      btn.textContent = seed.title;
      btn.dataset["conceptId"] = seed.concept_id;
      btn.dataset["areaKey"] = node.area.key;

      btn.addEventListener("click", () => {
        // Deselect all, select this
        leftPanel.querySelectorAll(".lh-concept-btn").forEach((b) => {
          (b as HTMLElement).classList.remove("lh-concept-btn--active");
        });
        btn.classList.add("lh-concept-btn--active");
        void loadConcept(node.area.key, seed.concept_id, seed.title);
      });

      li.appendChild(btn);
      conceptList.appendChild(li);
    }

    areaEl.appendChild(conceptList);
    leftPanel.appendChild(areaEl);
  }

  layout.appendChild(leftPanel);

  // ── Main panel ──────────────────────────────────────────────────────────────
  const mainPanel = document.createElement("div");
  mainPanel.className = "lh-concept-main";
  layout.appendChild(mainPanel);

  // Concept body (top)
  const bodySection = document.createElement("section");
  bodySection.className = "lh-concept-body-section";
  mainPanel.appendChild(bodySection);

  // Deepen controls
  const deepenSection = document.createElement("div");
  deepenSection.className = "lh-deepen-section";
  deepenSection.style.display = "none";
  mainPanel.appendChild(deepenSection);

  // Problems (bottom)
  const problemsSection = document.createElement("section");
  problemsSection.className = "lh-problems-section";
  mainPanel.appendChild(problemsSection);

  // Status banner
  const statusEl = document.createElement("div");
  statusEl.className = "lh-status";
  mainPanel.appendChild(statusEl);

  // Cache: concept_id -> GeneratedConcept (session lifetime)
  const cache = new Map<string, GeneratedConcept>();

  // ── Load / generate a concept ─────────────────────────────────────────────
  async function loadConcept(
    areaKey: string,
    conceptId: string,
    title: string,
  ): Promise<void> {
    bodySection.innerHTML = "";
    problemsSection.innerHTML = "";
    deepenSection.style.display = "none";
    statusEl.textContent = "개념 불러오는 중...";

    let concept = cache.get(conceptId);

    if (!concept) {
      const { concept: generated } = await generateConcept(session, {
        area: areaKey,
        concept_id: conceptId,
        title,
      });

      if (!generated) {
        statusEl.textContent = "생성 실패. 다시 시도해 주세요.";
        const retryBtn = document.createElement("button");
        retryBtn.textContent = "다시 생성";
        retryBtn.addEventListener("click", () => {
          void loadConcept(areaKey, conceptId, title);
        });
        statusEl.appendChild(retryBtn);
        return;
      }

      cache.set(conceptId, generated);
      concept = generated;
    }

    statusEl.textContent = "";

    // Render body
    const bodyHeader = document.createElement("h2");
    bodyHeader.className = "lh-concept-title";
    bodyHeader.textContent = concept.title;
    bodySection.appendChild(bodyHeader);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "lh-concept-body-content";
    renderBody(bodyDiv, concept.body);
    bodySection.appendChild(bodyDiv);

    // Record concept-read flag
    const readRecord: ProgressRecord = {
      module: "conceptprob",
      item_id: conceptId,
      read: true,
      ts: Date.now(),
    };
    saveProgress(subjectKey, readRecord);
    onProgress?.(readRecord);

    // Deepen controls
    deepenSection.style.display = "";
    deepenSection.innerHTML = "";

    const deepenLabel = document.createElement("div");
    deepenLabel.className = "lh-deepen-label";
    deepenLabel.textContent = "선택한 내용 심화 설명:";
    deepenSection.appendChild(deepenLabel);

    const targetInput = document.createElement("input");
    targetInput.type = "text";
    targetInput.className = "lh-deepen-target";
    targetInput.placeholder = "용어나 섹션 이름 입력...";
    deepenSection.appendChild(targetInput);

    const lensSelect = document.createElement("select");
    lensSelect.className = "lh-deepen-lens";
    const lenses: Array<{ value: "explain" | "example" | "simpler"; label: string }> = [
      { value: "explain", label: "상세 설명" },
      { value: "example", label: "예시" },
      { value: "simpler", label: "쉽게 설명" },
    ];
    for (const l of lenses) {
      const opt = document.createElement("option");
      opt.value = l.value;
      opt.textContent = l.label;
      lensSelect.appendChild(opt);
    }
    deepenSection.appendChild(lensSelect);

    const deepenBtn = document.createElement("button");
    deepenBtn.className = "lh-deepen-btn";
    deepenBtn.textContent = "심화";
    deepenSection.appendChild(deepenBtn);

    const deepenOut = document.createElement("div");
    deepenOut.className = "lh-deepen-output";
    deepenSection.appendChild(deepenOut);

    deepenBtn.addEventListener("click", () => {
      const target = targetInput.value.trim();
      if (!target) return;
      const lens = lensSelect.value as "explain" | "example" | "simpler";
      deepenBtn.disabled = true;
      deepenOut.textContent = "불러오는 중...";
      void deepen(session, { target, lens }).then((res) => {
        deepenBtn.disabled = false;
        deepenOut.textContent = res.ok ? res.text : `오류: ${res.error ?? "알 수 없음"}`;
      });
    });

    // Render problems
    if (concept.problems.length > 0) {
      const problemsHeader = document.createElement("h3");
      problemsHeader.className = "lh-problems-header";
      problemsHeader.textContent = "연습 문제";
      problemsSection.appendChild(problemsHeader);

      for (const problem of concept.problems) {
        renderProblem(problemsSection, problem, (result) => {
          const rec: ProgressRecord = {
            module: "conceptprob",
            item_id: problem.card_id,
            verdict: result.verdict,
            ts: Date.now(),
          };
          saveProgress(subjectKey, rec);
          onProgress?.(rec);
        });
      }
    } else {
      const noProblems = document.createElement("p");
      noProblems.textContent = "연습 문제가 없습니다.";
      problemsSection.appendChild(noProblems);
    }
  }
}
