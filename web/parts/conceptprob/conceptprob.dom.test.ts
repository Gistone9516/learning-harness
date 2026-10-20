// @vitest-environment jsdom
//
// pre_baked gate (web-conceptprob.md §9): a pre-baked concept injected with NO AI session must mount,
// render its numbered-step reading + problem cards, and grade each mode — all with zero AI calls.
import { describe, it, expect, beforeEach } from "vitest";
import { mountConceptprob, parseBody, coerceMemorize, coerceFigures, type GeneratedConcept, type AreaDef, type ConceptSeed } from "./conceptprob";
import type { AiClient } from "../../src/ai/client";
import { optionOrder } from "../../src/grade/order";

const CONCEPT: GeneratedConcept = {
  area: "fundamentals",
  concept_id: "variables",
  title: "변수와 자료형",
  body: [
    "변수는 값을 담는 이름 붙은 저장 공간이다.",
    "",
    "## 자료형의 종류",
    "기본 자료형은 정수, 실수, 문자열로 나뉜다.",
    "",
    "- **정수형** — 소수점 없는 수",
    "- **문자열** — 따옴표로 감싼 문자",
    "",
    "| 타입 | 예시 |",
    "|---|---|",
    "| 정수 | 3 |",
    "| 문자열 | \"hi\" |",
    "",
    "## 형 변환",
    "다른 타입으로 바꾸는 것을 형 변환이라 한다.",
  ].join("\n"),
  problems: [
    {
      card_id: "v-exact",
      type: "func",
      grade_mode: "exact",
      front: { prompt: "다음 코드의 출력은?", code: "print(1 + 2)", lang: "python" },
      answer_spec: { normalize: ["nfkc", "trim", "collapse_space"], accepted: ["3"] },
      links: { concept_ref: "변수와-자료형" },
    },
    {
      card_id: "v-judge",
      type: "judge",
      grade_mode: "exact",
      front: { scenario: "정수형으로 옳은 것은?", options: ["A. 3.14", "B. 42", "C. \"hi\"", "D. true"] },
      answer_spec: { normalize: ["nfkc", "trim", "collapse_space", "lower"], accepted: ["b. 42"] },
    },
    {
      card_id: "v-cloze",
      type: "cloze",
      grade_mode: "cloze",
      front: { text: "정수는 {{0}}, 문자열은 {{1}}." },
      answer_spec: { normalize: ["nfkc", "trim", "collapse_space", "lower"], blanks: [["3", "정수"], ["hi", "문자열"]] },
    },
  ],
};
const AREAS: AreaDef[] = [{ key: "fundamentals", label: "기초", icon: "📘" }];
const OUTLINE: Record<string, ConceptSeed[]> = { fundamentals: [{ concept_id: "variables", title: "변수와 자료형" }] };

const throwingClient = { send() { throw new Error("AI must not be called offline"); } } as unknown as AiClient;
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

function gradeCard(container: HTMLElement, cardId: string, answer: { judge?: string; text?: string; cloze?: string[] }): string | null {
  const card = container.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`);
  if (!card) return null;
  if (answer.judge != null) {
    const ch = Array.from(card.querySelectorAll<HTMLButtonElement>(".lh-cp-choice"))
      .find((b) => norm(b.querySelector(".lh-cp-choice-text")!.textContent!) === norm(answer.judge!));
    ch!.click();
    card.querySelector<HTMLButtonElement>(".lh-cp-check2--block")!.click();
  } else if (answer.cloze) {
    const ins = card.querySelectorAll<HTMLInputElement>(".lh-cp-input--cloze");
    answer.cloze.forEach((v, i) => { ins[i]!.value = v; });
    card.querySelector<HTMLButtonElement>(".lh-cp-check2--block")!.click();
  } else {
    card.querySelector<HTMLInputElement>(".lh-cp-input")!.value = answer.text ?? "";
    card.querySelector<HTMLButtonElement>(".lh-cp-check2")!.click();
  }
  return card.querySelector(".lh-cp-verdict")?.getAttribute("data-verdict") ?? null;
}

describe("conceptprob (canonical design) offline mount", () => {
  let container: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    mountConceptprob(container, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
  });

  it("renders the floating index and course title (no AI)", () => {
    expect(container.querySelector(".lh-cp-ph-title")?.textContent).toBe("데모");
    expect(container.querySelector(".lh-cp-sec-link")?.textContent).toBe("변수와 자료형");
  });

  it("shows importance tier badges in the index and a tier chip on the concept", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const outline: Record<string, ConceptSeed[]> = { fundamentals: [{ concept_id: "variables", title: "변수와 자료형", tier: 1 }] };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: outline, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector(".lh-cp-tier--1")?.textContent).toBe("1");
    expect(el.querySelector(".lh-cp-tier-chip--1")?.textContent).toContain("1순위");
  });

  it("renders a tier-4 badge and a 필기 badge for written-only concepts", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const outline: Record<string, ConceptSeed[]> = {
      fundamentals: [
        { concept_id: "variables", title: "변수와 자료형", tier: 4 },
        { concept_id: "manual", title: "매뉴얼", written: true },
      ],
    };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: outline, concepts: { variables: CONCEPT, manual: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    // sidebar badges: tier-4 shows "4", 필기 shows "필기"
    expect(el.querySelector(".lh-cp-tier--4")?.textContent).toBe("4");
    expect(el.querySelector(".lh-cp-tier--w")?.textContent).toBe("필기");
    // the auto-selected first concept (tier 4) shows a "4순위" chip
    expect(el.querySelector(".lh-cp-tier-chip--4")?.textContent).toContain("4순위");
  });

  it("renders a syntax-highlighted fenced code block in the body and problem code", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const c: GeneratedConcept = {
      area: "fundamentals", concept_id: "codey", title: "코드 예제",
      body: "## 예제\n\n```python\ndef f():\n    return 42\n```\n",
      problems: [{
        card_id: "codey-01", type: "func", grade_mode: "exact",
        front: { prompt: "출력은?", code: 'printf("%d", 1);', lang: "c" },
        answer_spec: { normalize: ["nfkc", "trim"], accepted: ["1"] },
      }],
    };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: { fundamentals: [{ concept_id: "codey", title: "코드 예제" }] }, concepts: { codey: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const pre = el.querySelector(".lh-cp-codeblock");
    expect(pre).toBeTruthy();
    expect(pre?.querySelector(".tok-k")?.textContent).toBe("def");   // keyword colored
    expect(pre?.querySelector(".tok-n")?.textContent).toBe("42");    // number colored
    // problem code is also highlighted (printf = C builtin)
    expect(el.querySelector(".lh-cp-prob-code .tok-b")?.textContent).toBe("printf");
  });

  it("renders callout, quote, numbered steps, formula and inline highlight", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const body = [
      "## 예제",
      "",
      ":::주의",
      "이건 함정이다.",
      ":::",
      "",
      "> 인용 문장",
      "",
      "1. 첫째 단계",
      "2. 둘째 단계",
      "",
      "$$",
      "MM = LOC / P",
      "$$",
      "",
      "문장 안 ==형광== 강조.",
    ].join("\n");
    const c: GeneratedConcept = { area: "fundamentals", concept_id: "comp", title: "컴포넌트", body, problems: [] };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: { fundamentals: [{ concept_id: "comp", title: "컴포넌트" }] }, concepts: { comp: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector(".lh-cp-callout--warn")).toBeTruthy();
    expect(el.querySelector(".lh-cp-callout--warn .lh-cp-callout-title")?.textContent).toBe("주의");
    expect(el.querySelector(".lh-cp-callout--quote")).toBeTruthy();
    expect(el.querySelector(".lh-cp-steps .lh-cp-step-num")?.textContent).toBe("1");
    expect(el.querySelector(".lh-cp-formula")?.textContent).toContain("MM = LOC / P");
    expect(el.querySelector(".lh-cp-mark")?.textContent).toBe("형광");
  });

  it("renders inline SVG as a sanitized figure (script/handlers stripped, shapes kept)", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const body = [
      "## 도식",
      "",
      "```svg",
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" onclick="steal()"/><script>alert(1)</script></svg>',
      "```",
    ].join("\n");
    const c: GeneratedConcept = { area: "fundamentals", concept_id: "figc", title: "도식", body, problems: [] };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: { fundamentals: [{ concept_id: "figc", title: "도식" }] }, concepts: { figc: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const frame = el.querySelector(".lh-cp-fig-frame");
    expect(frame).toBeTruthy();
    expect(frame?.querySelector("rect")).toBeTruthy();          // shape kept
    expect(frame?.querySelector("script")).toBeNull();          // script stripped
    expect(frame?.querySelector("rect")?.getAttribute("onclick")).toBeNull(); // handler stripped
  });

  it("renders :::정답 and raw <details> as a collapsible spoiler without leaking tags", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    const body = [
      "## 문제",
      "",
      ":::정답",
      "핵심은 오버로딩 우선순위.",
      ":::",
      "",
      "<details> <summary>정답 보기</summary>",
      "고정 매개변수가 varargs보다 우선.",
      "</details>",
    ].join("\n");
    const c: GeneratedConcept = { area: "fundamentals", concept_id: "sp", title: "스포일러", body, problems: [] };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: { fundamentals: [{ concept_id: "sp", title: "스포일러" }] }, concepts: { sp: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelectorAll(".lh-cp-spoiler").length).toBe(2);          // :::정답 + <details>
    expect(el.querySelector("details.lh-cp-spoiler .lh-cp-spoiler-sum")?.textContent).toBe("정답 보기");
    expect(el.textContent).not.toContain("<details>");                     // no raw tag leak
    expect(el.textContent).not.toContain("<summary>");
  });

  it("persists AI chat across a refresh and clears it on 초기화", async () => {
    localStorage.clear();
    const stub = { ai: async () => ({ ok: true, text: "설명입니다" }), problems: async () => ({ ok: true, added: 0, dropped: 0 }), health: async () => true } as unknown as AiClient;
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, aiClient: stub, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    (el.querySelector(".lh-cp-ai .lh-cp-ai-input") as HTMLTextAreaElement).value = "질문1";
    (el.querySelector(".lh-cp-ai .lh-cp-ai-send") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("lh:demo:conceptprob:chat:variables")).toContain("질문1");
    // refresh = fresh mount; history is restored into the panel
    const el2 = document.createElement("div"); document.body.appendChild(el2);
    mountConceptprob(el2, { session: null, aiClient: stub, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const msgs2 = el2.querySelector(".lh-cp-ai .lh-cp-ai-msgs") as HTMLElement;
    expect(msgs2.textContent).toContain("질문1");
    expect(msgs2.textContent).toContain("설명입니다");
    // 초기화 wipes the stored history
    (el2.querySelector(".lh-cp-ai-reset") as HTMLElement).click();
    expect(localStorage.getItem("lh:demo:conceptprob:chat:variables")).toBeNull();
  });

  it("expands the AI panel (blur backdrop on) and collapses on close", async () => {
    localStorage.clear();
    const stub = { send: async () => ({ ok: true, text: "" }), problems: async () => ({ ok: true, added: 0, dropped: 0 }) } as unknown as AiClient;
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, aiClient: stub, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    (el.querySelector(".lh-cp-ai-tab") as HTMLElement).click();          // open panel
    const aiPanel = el.querySelector(".lh-cp-ai") as HTMLElement;
    (el.querySelector(".lh-cp-ai-expand") as HTMLElement).click();       // expand
    expect(aiPanel.classList.contains("lh-cp-ai--expanded")).toBe(true);
    expect((el.querySelector(".lh-cp-ai-backdrop") as HTMLElement).classList.contains("lh-cp-ai-backdrop--on")).toBe(true);
    (el.querySelector(".lh-cp-ai-close") as HTMLElement).click();        // close collapses expand
    expect(aiPanel.classList.contains("lh-cp-ai--expanded")).toBe(false);
    expect((el.querySelector(".lh-cp-ai-backdrop") as HTMLElement).classList.contains("lh-cp-ai-backdrop--on")).toBe(false);
  });

  it("opens the sub panel from an AI-panel selection, prefills it, minimizes and closes", async () => {
    localStorage.clear();
    const stub = { send: async () => ({ ok: true, text: "" }), problems: async () => ({ ok: true, added: 0, dropped: 0 }) } as unknown as AiClient;
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, aiClient: stub, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const aiPanel = el.querySelector(".lh-cp-ai") as HTMLElement;
    const orig = window.getSelection;
    (window as unknown as { getSelection: () => unknown }).getSelection = () => ({
      rangeCount: 1, anchorNode: aiPanel, toString: () => "가변인자 우선순위",
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 40, top: 30, width: 80, height: 14, bottom: 44, right: 120 }) }),
    });
    try {
      aiPanel.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      const subBtn = el.querySelector(".lh-cp-subaskbtn") as HTMLElement;
      expect(subBtn.style.display).not.toBe("none");
      subBtn.click();
      const sub = el.querySelector(".lh-cp-subai") as HTMLElement;
      expect(sub.classList.contains("lh-cp-subai--open")).toBe(true);
      expect((sub.querySelector(".lh-cp-ai-input") as HTMLTextAreaElement).value).toContain("가변인자 우선순위");
      (sub.querySelector(".lh-cp-subai-min") as HTMLElement).click();
      expect(sub.classList.contains("lh-cp-subai--min")).toBe(true);
      (sub.querySelector(".lh-cp-ai-close") as HTMLElement).click();   // X = end session
      expect(sub.classList.contains("lh-cp-subai--open")).toBe(false);
      expect((sub.querySelector(".lh-cp-ai-input") as HTMLTextAreaElement).value).toBe("");
    } finally {
      (window as unknown as { getSelection: typeof orig }).getSelection = orig;
    }
  });

  it("selection buttons share one group (CP-3)", async () => {
    localStorage.clear();
    const asked: string[] = [];
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모", askElsewhere: { label: "질문 노트에 묻기", onAsk: (t: string) => asked.push(t) } });
    await new Promise((r) => setTimeout(r, 0));
    const main = el.querySelector(".lh-cp-main:not(.lh-cp-probmain)") as HTMLElement;
    const orig = window.getSelection;
    (window as unknown as { getSelection: () => unknown }).getSelection = () => ({
      rangeCount: 1, anchorNode: main, toString: () => "형 변환",
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 200, top: 300, width: 60, height: 14, bottom: 314, right: 260 }) }),
    });
    try {
      main.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      const group = el.querySelector(".lh-cp-askgroup") as HTMLElement;
      expect(group.style.display).not.toBe("none");
      const btns = Array.from(group.querySelectorAll<HTMLElement>(".lh-cp-askbtn"));
      expect(btns.map((b) => b.textContent)).toEqual(["AI 질문", "질문 노트에 묻기"]);
      for (const b of btns) { expect(b.style.left).toBe(""); expect(b.style.top).toBe(""); }   // only the group is placed
      group.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));                       // the gap does not dismiss it
      expect(group.style.display).not.toBe("none");
      btns[1].click();
      expect(asked).toEqual(["형 변환"]);
      expect(group.style.display).toBe("none");
    } finally {
      (window as unknown as { getSelection: typeof orig }).getSelection = orig;
    }
  });

  it("judge options follow optionOrder, and grading still goes by text (CP-2)", async () => {
    localStorage.clear();
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const card = el.querySelector<HTMLElement>('[data-card-id="v-judge"]')!;
    const stored = CONCEPT.problems[1].front["options"] as string[];
    const shown = Array.from(card.querySelectorAll(".lh-cp-choice-text")).map((x) => x.textContent);
    expect(shown).toEqual(optionOrder("v-judge", 4).map((i) => stored[i]));
    expect(gradeCard(el, "v-judge", { judge: "B. 42" })).toBe("correct");
    expect(card.querySelector(".lh-cp-choice--correct .lh-cp-choice-text")?.textContent).toBe("B. 42");
  });

  it("restores the last concept after a refresh (fresh re-mount)", async () => {
    localStorage.clear();
    const outline: Record<string, ConceptSeed[]> = { fundamentals: [
      { concept_id: "variables", title: "변수와 자료형" },
      { concept_id: "loops", title: "반복문" },
    ] };
    const concepts = { variables: CONCEPT, loops: { ...CONCEPT, concept_id: "loops", title: "반복문" } };
    const el1 = document.createElement("div"); document.body.appendChild(el1);
    mountConceptprob(el1, { session: null, areas: AREAS, conceptOutline: outline, concepts, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    (el1.querySelectorAll(".lh-cp-sec-link")[1] as HTMLElement).click();  // pick 반복문
    await new Promise((r) => setTimeout(r, 0));
    expect(el1.querySelector(".lh-cp-h2")?.textContent).toBe("반복문");
    // refresh = fresh mount; should restore 반복문, not fall back to the first concept
    const el2 = document.createElement("div"); document.body.appendChild(el2);
    mountConceptprob(el2, { session: null, areas: AREAS, conceptOutline: outline, concepts, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el2.querySelector(".lh-cp-h2")?.textContent).toBe("반복문");
  });

  it("shows a 회차 badge and componentizes a markdown prompt on 기출 cards", async () => {
    localStorage.clear();
    const c: GeneratedConcept = {
      area: "fundamentals", concept_id: "variables", title: "변수와 자료형", body: "## 개요\n내용",
      problems: [{
        card_id: "kichul-540-3", type: "func", grade_mode: "exact",
        front: { prompt: "다음 표를 보고 답하시오.\n\n| 용어 | 뜻 |\n|---|---|\n| A | 가 |" },
        answer_spec: { normalize: [], accepted: ["가"] }, source: "기출", round: "2025년 1회",
      }],
    };
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector(".lh-cp-prob-round")?.textContent).toBe("2025년 1회 출제");
    expect(el.querySelector(".lh-cp-prob-q .lh-cp-ai-rich")).toBeTruthy();   // markdown table → components
  });

  it("shows the 기출 page with round chips and past-exam problems", async () => {
    localStorage.clear();
    const c: GeneratedConcept = {
      area: "fundamentals", concept_id: "variables", title: "변수와 자료형", body: "## 개요\n내용",
      problems: [{
        card_id: "kichul-540-1", type: "func", grade_mode: "exact",
        front: { prompt: "기출 발문 예시?" }, answer_spec: { normalize: [], accepted: ["답"] },
        source: "기출", round: "2025년 1회",
      }],
    };
    const el = document.createElement("div"); document.body.appendChild(el);
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const tabs = el.querySelectorAll(".lh-cp-vtab");
    expect(tabs.length).toBe(3);                       // 개념 학습 / 문제 풀이 / 기출
    (tabs[2] as HTMLElement).click();                  // 기출
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector(".lh-cp-kich-chip")?.textContent).toBe("2025년 1회");
    expect(el.textContent).toContain("기출 발문 예시?");
  });

  it("restores the problems view after a refresh", async () => {
    localStorage.clear();
    const el1 = document.createElement("div"); document.body.appendChild(el1);
    mountConceptprob(el1, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    (el1.querySelectorAll(".lh-cp-vtab")[1] as HTMLElement).click();  // 문제 풀이
    await new Promise((r) => setTimeout(r, 0));
    const el2 = document.createElement("div"); document.body.appendChild(el2);
    mountConceptprob(el2, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect((el2.querySelectorAll(".lh-cp-vtab")[1] as HTMLElement).classList.contains("lh-cp-vtab--on")).toBe(true);
  });

  it("auto-selects the first concept and renders its title + numbered steps", () => {
    expect(container.querySelector(".lh-cp-h2")?.textContent).toBe("변수와 자료형");
    const steps = container.querySelectorAll(".lh-cp-step");
    expect(steps.length).toBeGreaterThanOrEqual(2); // 자료형의 종류 / 형 변환
    expect(container.querySelector(".lh-cp-step-title")?.textContent).toBe("자료형의 종류");
    expect(container.querySelector(".lh-cp-point")).not.toBeNull(); // bullet points
  });

  it("renders a problem code block", () => {
    expect(container.querySelector('[data-card-id="v-exact"] .lh-cp-prob-code code')?.textContent).toBe("print(1 + 2)");
  });

  it("grades func / judge / cloze correctly with zero AI", () => {
    expect(gradeCard(container, "v-exact", { text: "3" })).toBe("correct");
    expect(gradeCard(container, "v-judge", { judge: "B. 42" })).toBe("correct");
    expect(gradeCard(container, "v-cloze", { cloze: ["3", "hi"] })).toBe("correct");
  });

  it("marks a wrong judge choice and reveals the answer", () => {
    expect(gradeCard(container, "v-judge", { judge: "A. 3.14" })).toBe("incorrect");
    const card = container.querySelector<HTMLElement>('[data-card-id="v-judge"]')!;
    expect(card.querySelector(".lh-cp-choice--wrong")).not.toBeNull();
    expect(card.querySelector(".lh-cp-choice--correct")).not.toBeNull();
    card.querySelector<HTMLButtonElement>(".lh-cp-reveal-btn")!.click();
    expect(card.querySelector(".lh-cp-reveal-ans")?.textContent).toBe("b. 42");
  });

  it("has a theme toggle that switches to dark mode and persists it", () => {
    document.documentElement.removeAttribute("data-theme");
    const btn = container.querySelector<HTMLButtonElement>(".lh-cp-theme")!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("lh:theme")).toBe("dark");
    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    document.documentElement.removeAttribute("data-theme");
  });

  it("toggles a concept done-checkbox and updates progress", () => {
    const checkBtn = container.querySelector<HTMLButtonElement>(".lh-cp-check-btn")!;
    checkBtn.click();
    expect(container.querySelector(".lh-cp-check--on")).not.toBeNull();
    expect(container.querySelector(".lh-cp-prog-val")?.textContent).toContain("100%");
  });

  it("parseBody splits headings into steps of ordered blocks (points + terms)", () => {
    const { summary, steps } = parseBody(CONCEPT.body);
    expect(summary).toContain("저장 공간");
    expect(steps.map((s) => s.title)).toContain("자료형의 종류");
    const first = steps.find((s) => s.title === "자료형의 종류")!;
    const pts = first.blocks.find((b) => b.kind === "points");
    expect(pts && pts.kind === "points" && pts.items.length).toBe(2);
    expect(first.blocks.some((b) => b.kind === "terms")).toBe(true);
  });

  it("absorbs a trailing-colon caption into the table it introduces", () => {
    const { steps } = parseBody("## 실천법\n**XP 주요 실천 방법**:\n\n| 실천법 | 설명 |\n|---|---|\n| 페어 | 둘이 |\n");
    const terms = steps[0].blocks.find((b) => b.kind === "terms");
    expect(terms && terms.kind === "terms" && terms.caption).toBe("XP 주요 실천 방법");
  });

  it("groups a whole-line-bold sub-heading + its content into a sub-section card", () => {
    const { steps } = parseBody("## 프로토타입\n리드 문장.\n\n**1. 함수 원형**\n\n설명 문장.\n\n- 항목 하나\n");
    const step = steps[0];
    expect(step.blocks.some((b) => b.kind === "p")).toBe(true); // 리드 문장은 카드 밖 문단
    const sub = step.blocks.find((b) => b.kind === "subsec");
    expect(sub && sub.kind === "subsec" && sub.head).toBe("1. 함수 원형");
    if (sub && sub.kind === "subsec") {
      expect(sub.blocks.some((b) => b.kind === "p")).toBe(true);       // 설명 문단이 카드 안으로
      expect(sub.blocks.some((b) => b.kind === "points")).toBe(true);  // 불릿도 카드 안으로
    }
    // "**…**:" (colon) stays a caption, NOT a sub-section
    const cap = parseBody("## S\n**용어 정리**:\n\n| a | b |\n|---|---|\n| x | y |\n").steps[0].blocks.find((b) => b.kind === "terms");
    expect(cap && cap.kind === "terms" && cap.caption).toBe("용어 정리");
  });

  it("nests ### sub-headings as sub-sections under their ## step", () => {
    const { steps } = parseBody("## 인터페이스 보안\n### IPSec\n- 3계층\n### SSL/TLS\n- 4계층\n");
    const step = steps.find((s) => s.title === "인터페이스 보안")!;
    const subs = step.blocks.filter((b) => b.kind === "subsec");
    expect(subs.length).toBe(2);
    expect(subs[0].kind === "subsec" && subs[0].head).toBe("IPSec");
    expect(subs[0].kind === "subsec" && subs[0].heading).toBe(true);
    expect(subs[0].kind === "subsec" && subs[0].blocks.some((b) => b.kind === "points")).toBe(true);
  });

  it("numbers ### sub-sections hierarchically as X.Y", async () => {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const c: GeneratedConcept = { ...CONCEPT, body: "개요 문장.\n\n## 인터페이스 보안\n### IPSec\n- 3계층 프로토콜\n### SSL/TLS\n- 4계층\n" };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const nums = Array.from(el.querySelectorAll(".lh-cp-subsec-num")).map((n) => n.textContent);
    expect(nums).toEqual(["1.1", "1.2"]); // step 1 → 1.1 IPSec, 1.2 SSL/TLS
  });

  it("never calls AI on the offline path", () => {
    void throwingClient;
    expect(() => mountConceptprob(container, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT } })).not.toThrow();
  });
});

// ── "반드시 외워야 할 것" memorize card ─────────────────────────────────────────
describe("conceptprob memorize card", () => {
  it("coerceMemorize tolerates partial input and drops empty", () => {
    expect(coerceMemorize(null)).toBeUndefined();
    expect(coerceMemorize({ items: [] })).toBeUndefined();
    const m = coerceMemorize({ mnemonic: { code: "기대후슈", expand: "기본·대체키 ⊂ 후보키" }, items: [{ term: "후보키", def: "유일성 O", tag: "기출" }], traps: ["최소성 함정"] });
    expect(m?.mnemonic?.code).toBe("기대후슈");
    expect(m?.items[0].tag).toBe("기출");
    expect(m?.traps?.length).toBe(1);
  });

  it("renders the memorize card at the top of a concept when present", async () => {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const c: GeneratedConcept = {
      ...CONCEPT,
      memorize: { mnemonic: { code: "기대후슈", expand: "기본·대체키 ⊂ 후보키" }, items: [{ term: "후보키", def: "유일성 O, 최소성 O", tag: "기출" }], traps: ["기본키는 최소성까지 만족"] },
    };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    const card = el.querySelector(".lh-cp-must");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".lh-cp-must-mncode")?.textContent).toBe("기대후슈");
    expect(card!.querySelector(".lh-cp-must-term")?.textContent).toBe("후보키");
    expect(card!.querySelector(".lh-cp-must-tag--hot")?.textContent).toBe("기출");
    expect(card!.querySelector(".lh-cp-must-traplist li")?.textContent).toContain("최소성");
  });

  it("renders 그림 자료 figures (inline svg) with caption when present", async () => {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const c: GeneratedConcept = {
      ...CONCEPT,
      figures: [{ caption: "UML 관계 6종", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect x="1" y="1" width="98" height="38"/></svg>' }],
    };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector(".lh-cp-figs")).not.toBeNull();
    expect(el.querySelector(".lh-cp-fig-frame svg")).not.toBeNull();
    expect(el.querySelector(".lh-cp-fig-cap")?.textContent).toBe("UML 관계 6종");
    expect(coerceFigures([{ svg: "not svg" }, { svg: "<svg></svg>", caption: "x" }])?.length).toBe(1);
  });

  it("interleaves an anchored figure inside its sub-concept step (개념 → 이미지)", async () => {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const c: GeneratedConcept = {
      ...CONCEPT,
      figures: [{ caption: "자료형 그림", anchor: "자료형의 종류", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>' }],
    };
    mountConceptprob(el, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: c }, courseTitle: "데모" });
    await new Promise((r) => setTimeout(r, 0));
    // figure sits inside a step's content, not in the trailing 그림 자료 block
    const stepFig = el.querySelector(".lh-cp-step-main .lh-cp-fig svg");
    expect(stepFig).not.toBeNull();
    expect(el.querySelector(".lh-cp-figs")).toBeNull(); // no leftover end block when all figures anchored
  });
});

// ── Problem-practice view, attempt history, delete/feedback, generation ─────────
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("conceptprob problem-practice features", () => {
  let container: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  const mount = (client?: AiClient) =>
    mountConceptprob(container, { session: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { variables: CONCEPT }, aiClient: client ?? null });

  it("switches to the problem-practice view with subject checkboxes, count and select-all", () => {
    mount();
    const tabs = container.querySelectorAll<HTMLButtonElement>(".lh-cp-vtab");
    tabs[1].click(); // 문제 풀이
    expect(getComputedStyle(container.querySelector<HTMLElement>(".lh-cp-probmain")!).display).not.toBe("none");
    const subj = container.querySelector<HTMLElement>(".lh-cp-subj");
    expect(subj).not.toBeNull();
    expect(container.querySelector(".lh-cp-subj-cb")).toHaveProperty("checked", true);
    expect(container.querySelector(".lh-cp-subj-count")?.textContent).toContain("문제");
    expect(container.querySelector(".lh-cp-btn-ghost")?.textContent).toBe("전체 해제"); // all checked by default
  });

  it("random exam caps each concept at 3 problems (single concept -> <=3 cards)", () => {
    mount();
    container.querySelectorAll<HTMLButtonElement>(".lh-cp-vtab")[1].click();
    container.querySelector<HTMLButtonElement>(".lh-cp-btn-primary")!.click(); // 출제
    const sec = container.querySelector<HTMLElement>(".lh-cp-exam-sec")!;
    expect(sec).not.toBeNull();
    expect(sec.querySelectorAll(".lh-cp-prob").length).toBeLessThanOrEqual(3);
  });

  it("records attempt history as marks after grading", async () => {
    mount(); await tick();
    expect(gradeCard(container, "v-exact", { text: "3" })).toBe("correct");
    const card = container.querySelector<HTMLElement>('[data-card-id="v-exact"]')!;
    expect(card.querySelectorAll(".lh-cp-hist-dot--o").length).toBe(1);
    expect(JSON.parse(localStorage.getItem("lh:demo:conceptprob:hist:v-exact")!)).toEqual(["correct"]);
  });

  it("deletes a problem and stores the deletion + feedback for future generation", async () => {
    mount(); await tick();
    const card = container.querySelector<HTMLElement>('[data-card-id="v-exact"]')!;
    card.querySelector<HTMLButtonElement>(".lh-cp-prob-del")!.click();
    card.querySelector<HTMLTextAreaElement>(".lh-cp-del-ta")!.value = "너무 쉬움";
    card.querySelector<HTMLButtonElement>(".lh-cp-del-ok")!.click();
    expect(container.querySelector('[data-card-id="v-exact"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem("lh:demo:conceptprob:deleted")!)).toContain("v-exact");
    expect(JSON.parse(localStorage.getItem("lh:demo:conceptprob:fb:variables")!)).toContain("너무 쉬움");
  });

  it("generates and appends new problems from the server (execution-verified upstream)", async () => {
    const genned = {
      card_id: "variables-gen-1", type: "func", grade_mode: "exact",
      front: { prompt: "생성 문제", code: "print(9)", lang: "python" },
      answer_spec: { normalize: ["nfkc", "trim", "collapse_space"], accepted: ["9"] },
    };
    const client: AiClient = {
      ai: async () => ({ ok: true, text: "", session_id: null, error: null }),
      health: async () => true,
      problems: async () => ({ ok: true, problems: [genned], error: null, dropped: 0 }),
      repos: async () => ({ ok: false, reason: "call", error: "unused" }),
    };
    mount(client); await tick();
    const before = container.querySelectorAll('.lh-cp-prob-list .lh-cp-prob').length;
    container.querySelector<HTMLButtonElement>(".lh-cp-genbtn")!.click();
    await tick();
    const after = container.querySelectorAll('.lh-cp-prob-list .lh-cp-prob').length;
    expect(after).toBe(before + 1);
    expect(container.querySelector('[data-card-id="variables-gen-1"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("lh:demo:conceptprob:gen:variables")!).length).toBe(1);
  });

  it("'개념 다시 보기' reveals a working button and shows the floating back-to-problem button", async () => {
    mount(); await tick();
    const card = container.querySelector<HTMLElement>('[data-card-id="v-exact"]')!;
    card.querySelector<HTMLButtonElement>(".lh-cp-reveal-btn")!.click();
    const review = card.querySelector<HTMLButtonElement>(".lh-cp-reveal-link")!;
    expect(review.tagName).toBe("BUTTON");
    expect(review.textContent).toBe("개념 다시 보기");
    const back = container.querySelector<HTMLElement>(".lh-cp-backprob")!;
    expect(back.style.display).toBe("none");
    review.click();
    expect(back.style.display).not.toBe("none");
  });
});
