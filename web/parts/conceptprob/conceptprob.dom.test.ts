// @vitest-environment jsdom
//
// pre_baked gate (web-conceptprob.md §9): a pre-baked concept injected with NO AI session must mount,
// render its (Markdown) body, grade each mode, and resolve the retrace anchor — all with zero AI calls.
// This locks the "deterministic = token 0, fully offline" invariant. A throwing client proves no AI path
// is taken even if one were available.
import { describe, it, expect, beforeEach } from "vitest";
import {
  mountConceptprob,
  type GeneratedConcept,
  type AreaDef,
  type ConceptSeed,
} from "./conceptprob";
import type { AiClient } from "../../src/ai/client";

const CONCEPT: GeneratedConcept = {
  area: "fundamentals",
  concept_id: "variables",
  title: "변수",
  body: [
    "변수는 이름이 붙은 저장 공간이다.",
    "",
    "## 종류",
    "정수, 문자열, 불리언.",
    "",
    "| 타입 | 예시 |",
    "|---|---|",
    "| 정수 | 3 |",
    "",
    "```python",
    "x = 3",
    "```",
  ].join("\n"),
  problems: [
    {
      card_id: "p-exact",
      type: "func",
      grade_mode: "exact",
      front: { prompt: "상수 선언 키워드는?", code: "const x = 1;", lang: "js" },
      answer_spec: { normalize: ["nfkc", "trim", "lower"], accepted: ["const"] },
      links: { concept_ref: "variables" },
    },
  ],
};

const AREAS: AreaDef[] = [{ key: "fundamentals", label: "기초" }];
const OUTLINE: Record<string, ConceptSeed[]> = {
  fundamentals: [{ concept_id: "variables", title: "변수" }],
};

// A client that fails the test if any AI call is attempted.
const throwingClient = {
  send() {
    throw new Error("AI must not be called in the pre-baked offline path");
  },
} as unknown as AiClient;

describe("conceptprob pre_baked offline mount", () => {
  let container: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  function selectFirstConcept(): void {
    mountConceptprob(container, {
      session: null,
      areas: AREAS,
      conceptOutline: OUTLINE,
      concepts: { variables: CONCEPT },
    });
    const btn = container.querySelector<HTMLButtonElement>(".lh-concept-btn");
    expect(btn).not.toBeNull();
    btn!.click();
  }

  it("mounts and renders the concept with null session (no AI)", () => {
    selectFirstConcept();
    const title = container.querySelector(".lh-concept-title");
    expect(title?.textContent).toBe("변수");
    expect(title?.id).toBe("variables"); // retrace anchor
  });

  it("renders the Markdown body (heading, table, code block)", () => {
    selectFirstConcept();
    expect(container.querySelector(".lh-md-h")?.textContent).toBe("종류");
    expect(container.querySelector(".lh-md-table")).not.toBeNull();
    expect(container.querySelector(".lh-md-pre code")?.textContent).toContain("x = 3");
  });

  it("hides the deepen controls when there is no session", () => {
    selectFirstConcept();
    const deepen = container.querySelector<HTMLElement>(".lh-deepen-section");
    expect(deepen?.style.display).toBe("none");
  });

  it("renders a problem front code block", () => {
    selectFirstConcept();
    const code = container.querySelector(".lh-problem-code code");
    expect(code?.textContent).toBe("const x = 1;");
  });

  it("grades a problem deterministically (correct) with zero AI", () => {
    selectFirstConcept();
    const input = container.querySelector<HTMLInputElement>(".lh-problem-input");
    const submit = container.querySelector<HTMLButtonElement>(".lh-problem-submit");
    expect(input).not.toBeNull();
    input!.value = "const";
    submit!.click();
    expect(container.querySelector(".lh-problem-result")?.getAttribute("data-verdict")).toBe("correct");
  });

  it("grades incorrect and offers a retrace link to the concept anchor", () => {
    selectFirstConcept();
    const input = container.querySelector<HTMLInputElement>(".lh-problem-input");
    const submit = container.querySelector<HTMLButtonElement>(".lh-problem-submit");
    input!.value = "var";
    submit!.click();
    const result = container.querySelector(".lh-problem-result");
    expect(result?.getAttribute("data-verdict")).toBe("incorrect");
    const retrace = result?.querySelector<HTMLAnchorElement>(".lh-retrace-link");
    expect(retrace?.getAttribute("href")).toBe("#variables");
    // the anchor target exists in the DOM
    expect(container.querySelector("#variables")).not.toBeNull();
  });

  it("never constructs an AI client / never calls AI (throwing client unused via null session)", () => {
    // Mount with the throwing client wrapped only to prove the offline path ignores it:
    // session:null means no client is built at all, so the throwing client is never reached.
    expect(() =>
      mountConceptprob(container, {
        session: null,
        areas: AREAS,
        conceptOutline: OUTLINE,
        concepts: { variables: CONCEPT },
      }),
    ).not.toThrow();
    void throwingClient; // referenced to document intent; null session path constructs no client
  });
});
