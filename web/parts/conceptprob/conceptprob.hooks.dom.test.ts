// @vitest-environment jsdom
//
// Optional instance hooks on conceptprob (specs/web-notebook.md N-12, N-13): a stored concept is read
// back instead of regenerated, a generated one is saved with the outline's id, labels replace the
// defaults, and a problem's explanation shows under its answer.
import { describe, it, expect, beforeEach } from "vitest";
import { makeAbbrCollapser, mountConceptprob, type ConceptStore, type GeneratedConcept } from "./conceptprob";
import type { AiClient, AiRequest } from "../../src/ai/client";

const AREAS = [{ key: "p04", label: "Storage" }];
const OUTLINE = { p04: [{ concept_id: "p04-ebs", title: "EBS" }] };
const STORED: GeneratedConcept = {
  area: "p04", concept_id: "p04-ebs", title: "EBS",
  body: "Block storage.\n\n## Scope\nOne AZ.",
  problems: [{
    card_id: "saa-p04-ebs-01", type: "judge", grade_mode: "exact",
    front: { scenario: "Which is block storage?", options: ["EBS", "EFS"] },
    answer_spec: { normalize: ["lower"], accepted: ["EBS"] },
    explain: "EFS is a **file** system.",
  }],
};
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 15) { for (let i = 0; i < n; i++) await tick(); }

function client(onAi: (r: AiRequest) => string): AiClient & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  return {
    calls,
    async ai(r) { calls.push(r); return { ok: true, text: onAi(r), session_id: "s", error: null }; },
    async problems() { return { ok: false, problems: [], error: "n/a" }; },
    async repos() { return { ok: false, reason: "call", error: "n/a" }; },
    async health() { return true; },
  } as AiClient & { calls: AiRequest[] };
}

describe("conceptprob instance hooks", () => {
  let root: HTMLElement;
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ""; root = document.createElement("div"); document.body.appendChild(root); });

  it("reads a stored concept instead of calling the AI (N-12) and shows the explanation", async () => {
    const ai = client(() => { throw new Error("must not generate"); });
    const store: ConceptStore = { load: async (id) => (id === "p04-ebs" ? STORED : null), save: async () => undefined };
    mountConceptprob(root, { session: ai, aiClient: ai, areas: AREAS, conceptOutline: OUTLINE, conceptStore: store, author: { system: "AUTHOR" }, labels: { pageTitle: "Core concepts", pastTab: "" } });
    await settle();
    expect(ai.calls).toHaveLength(0);
    expect(root.querySelector(".lh-cp-h1")!.textContent).toBe("Core concepts");
    const tabs = Array.from(root.querySelectorAll<HTMLElement>(".lh-cp-vtab"));
    expect(tabs[2].style.display).toBe("none");
    root.querySelector<HTMLButtonElement>(".lh-cp-reveal-btn")!.click();
    expect(root.querySelector(".lh-cp-reveal-explain")!.textContent).toContain("file");
  });

  it("generates with the author prompt, keeps the outline id, and saves the result", async () => {
    const saved: GeneratedConcept[] = [];
    const ai = client(() => JSON.stringify({ ...STORED, concept_id: "renamed-by-model", area: "x" }));
    const store: ConceptStore = { load: async () => null, save: async (c) => { saved.push(c); } };
    mountConceptprob(root, { session: ai, aiClient: ai, areas: AREAS, conceptOutline: OUTLINE, conceptStore: store, author: { system: "AUTHOR", model: "m1" } });
    await settle();
    expect(ai.calls[0].system!.startsWith("AUTHOR\n\n")).toBe(true);
    expect(ai.calls[0].system).toContain("[Response contract]");
    expect(ai.calls[0].model).toBe("m1");
    expect(saved[0].concept_id).toBe("p04-ebs");
    expect(saved[0].area).toBe("p04");
  });

  it("collapses spelled-out abbreviations in problem fronts and keeps judge grading intact (N-17)", async () => {
    const collapse = makeAbbrCollapser([
      { abbr: "MFA", expansion: "multi-factor authentication" },
      { abbr: "EBS", expansion: "Amazon Elastic Block Store" },
    ]);
    expect(collapse("Enable multi-factor authentication (MFA) on the root user")).toBe("Enable MFA on the root user");
    expect(collapse("Use Elastic Block Store or Amazon Elastic Block Store (EBS)")).toBe("Use EBS or EBS");
    expect(collapse("Nothing to change")).toBe("Nothing to change");
    const leaky: GeneratedConcept = { ...STORED, problems: [{
      card_id: "leak-01", type: "judge", grade_mode: "exact",
      front: { scenario: "Protect the root user.", options: ["Enable multi-factor authentication", "Share keys"] },
      answer_spec: { normalize: ["lower"], accepted: ["Enable multi-factor authentication"] },
    }] };
    mountConceptprob(root, { session: null, aiClient: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { "p04-ebs": leaky }, rewriteFront: collapse });
    await settle();
    const texts = Array.from(root.querySelectorAll(".lh-cp-choice-text")).map((e) => e.textContent);
    expect(texts).toEqual(["Enable MFA", "Share keys"]);
    (root.querySelectorAll<HTMLButtonElement>(".lh-cp-choice"))[0].click();
    root.querySelector<HTMLButtonElement>(".lh-cp-check2--block")!.click();
    expect(root.querySelector(".lh-cp-verdict")!.textContent).toBe("정답입니다");
  });

  it("keeps the default labels when none are passed (N-13)", async () => {
    const ai = client(() => JSON.stringify(STORED));
    mountConceptprob(root, { session: null, aiClient: null, areas: AREAS, conceptOutline: OUTLINE, concepts: { "p04-ebs": STORED } });
    await settle();
    expect(root.querySelector(".lh-cp-h1")!.textContent).toBe("필기 핵심 이론");
    const tabs = Array.from(root.querySelectorAll<HTMLElement>(".lh-cp-vtab"));
    expect(tabs[2].style.display).toBe("");
    void ai;
  });
});
