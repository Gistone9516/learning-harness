// @vitest-environment jsdom
//
// Tests for the codeproj extensions: the concept lens shape, the
// free-form question path (including a line selection), and the three-pane layout wiring.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import {
  ask,
  explain,
  mountCodeproj,
  sliceLines,
  LENS_ORDER,
  type CodeProject,
} from "./codeproj";
import { buildAskPrompt, buildExplainPrompt } from "./prompts";
import { reseedSession } from "./session";

function stubClient(reply: Partial<AiResponse> = {}) {
  const sent: any[] = [];
  const client: AiClient = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "ANSWER", session_id: "s1", error: null, ...reply } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

const PROJECT: CodeProject = {
  title: "T",
  summary: "S",
  files: [
    { path: "src/app.ts", content: "line1\nline2\nline3\nline4" },
    { path: "README.md", content: "readme" },
  ],
};

describe("concept lens (FR-13)", () => {
  it("is offered alongside the original four lenses", () => {
    expect(LENS_ORDER).toEqual(["overview", "libs_methods", "flow", "modify_tip", "concepts"]);
  });

  it("asks for the four-part shape and guards against invented company specifics", () => {
    const prompt = buildExplainPrompt({ target: { path: "src/app.ts" }, lens: "concepts" });
    expect(prompt).toContain("1. 개념");
    expect(prompt).toContain("2. 일반 응용");
    expect(prompt).toContain("3. 실무 사례");
    expect(prompt).toContain("4. 이 프로젝트에서의 사용");
    expect(prompt).toMatch(/단정하지 마세요/);
  });

  it("leaves the other lenses on their plain wording", () => {
    const prompt = buildExplainPrompt({ target: { path: "src/app.ts" }, lens: "flow" });
    expect(prompt).not.toContain("1. 개념");
    expect(prompt).toContain("호출 흐름");
  });
});

describe("free-form question (FR-4, FR-5)", () => {
  it("passes the learner's wording through untouched", () => {
    const question = "왜 여기서 캐시를 안 쓰나요?";
    expect(buildAskPrompt({ target: { path: "src/app.ts" }, question, depth: "full" })).toContain(question);
  });

  it("quotes the selected lines so the model sees the exact target", () => {
    const prompt = buildAskPrompt(
      { target: { path: "src/app.ts", lines: [2, 3] }, question: "이 부분은?", depth: "full"  },
      sliceLines(PROJECT.files[0].content, [2, 3]),
    );
    expect(prompt).toContain("라인: 2-3");
    expect(prompt).toContain("line2\nline3");
    expect(prompt).not.toContain("line1");
  });

  it("resumes the existing session instead of re-sending the project", async () => {
    const { client, sent } = stubClient({ text: JSON.stringify(PROJECT) });
    const session = new AiSession(client);
    await reseedSession(session, PROJECT);
    await ask(session, { target: { path: "src/app.ts" }, question: "질문", depth: "full"  });

    expect(sent).toHaveLength(2);
    expect(sent[1].session_id).toBe("s1");
    expect(sent[1].prompt).not.toContain("[코드베이스 적재]");
  });

  it("reports a failure as readable text rather than throwing", async () => {
    const { client } = stubClient({ ok: false, error: "boom", text: "" });
    const out = await ask(new AiSession(client), { target: { path: "p" }, question: "q", depth: "full"  });
    expect(out).toContain("boom");
  });
});

describe("sliceLines", () => {
  it("returns the inclusive 1-based range and clamps out-of-range values", () => {
    expect(sliceLines("a\nb\nc", [2, 3])).toBe("b\nc");
    expect(sliceLines("a\nb\nc", [0, 99])).toBe("a\nb\nc");
    expect(sliceLines("a\nb\nc", [3, 1])).toBe("c");
  });
});

describe("three-pane layout (NFR-8)", () => {
  function mount(session: AiSession | null, props: any = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountCodeproj(host, { session, project: PROJECT, ...props });
    return host;
  }

  /**
   * The grid holds both views at once and swaps them with `display`, so the DOM has five panels
   * and the layout has three. What NFR-8 is about is the three the learner sees.
   */
  function visibleOrder(host: HTMLElement): string[] {
    const panes = host.querySelector(".lh-cp-panes")!;
    return Array.from(panes.children)
      .filter((c) => (c as HTMLElement).style.display !== "none")
      .map((c) => c.className);
  }

  it("renders files, code and AI panes in that order", () => {
    const host = mount(new AiSession(stubClient().client));
    const order = visibleOrder(host);
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("lh-cp-files");
    expect(order[1]).toContain("lh-cp-code-panel");
    expect(order[2]).toContain("lh-cp-ai");
  });

  it("keeps three panes and the same AI pane when the concepts view is shown", () => {
    // The AI panel belongs to neither view: one thread answers about a line and about a concept.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountCodeproj(host, {
      session: new AiSession(stubClient().client),
      project: PROJECT,
      concepts: { entries: [{ seed: { area: "a", concept_id: "c-one", title: "개념" }, status: "pending" }] },
    });
    const ai = host.querySelector(".lh-cp-ai");
    handle.setView("concepts");
    const order = visibleOrder(host);
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("lh-cp-concept-rail");
    expect(order[1]).toContain("lh-cp-concept-reading");
    expect(order[2]).toContain("lh-cp-ai");
    expect(host.querySelector(".lh-cp-ai")).toBe(ai);
  });

  it("offers no concepts view when there are none", () => {
    // A tab onto an empty page claims there is something there.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountCodeproj(host, { session: null, project: PROJECT });
    expect(handle.hasConcepts()).toBe(false);
  });

  it("hides the AI pane when there is no session, keeping reading usable", () => {
    const host = mount(null);
    const ai = host.querySelector(".lh-cp-ai") as HTMLElement;
    expect(ai.style.display).toBe("none");
    expect(host.querySelectorAll(".lh-cp-tree-file").length).toBe(2);
    expect(host.querySelector(".lh-cp-code")).toBeTruthy();
  });

  it("marks a file seen once when it is opened", () => {
    const onFileSeen = vi.fn();
    const host = mount(null, { onFileSeen });
    expect(onFileSeen).toHaveBeenCalledWith("src/app.ts");   // first file auto-opens
    const readme = Array.from(host.querySelectorAll(".lh-cp-tree-file")).find(
      (b) => (b as HTMLElement).dataset["path"] === "README.md",
    ) as HTMLElement;
    readme.click();
    readme.click();
    expect(onFileSeen).toHaveBeenCalledTimes(2);
  });

  it("selects a line range by click and extends it with shift-click", () => {
    const host = mount(new AiSession(stubClient().client));
    const lines = host.querySelectorAll(".lh-cp-code-line");
    (lines[1] as HTMLElement).click();
    expect(host.querySelector(".lh-cp-selection-label")!.textContent).toContain("2-2");
    lines[3].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(host.querySelector(".lh-cp-selection-label")!.textContent).toContain("2-4");
  });

  it("sends an explain request for the selected lines and records the exchange", async () => {
    const { client, sent } = stubClient();
    const onExchange = vi.fn();
    const host = mount(new AiSession(client), { onExchange });

    (host.querySelectorAll(".lh-cp-code-line")[1] as HTMLElement).click();
    (host.querySelector(".lh-cp-lens-select") as HTMLSelectElement).value = "concepts";
    (host.querySelector(".lh-cp-explain-btn") as HTMLButtonElement).click();
    // The exchange event lands after the answer, so wait on it rather than on the request.
    await vi.waitFor(() => expect(onExchange).toHaveBeenCalled());

    expect(sent[0].prompt).toContain("라인: 2-2");
    expect(sent[0].prompt).toContain("1. 개념");
    expect(onExchange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "explain", lens: "concepts", path: "src/app.ts", lines: [2, 2] }),
    );
    expect(host.querySelector(".lh-cp-entry-body")!.textContent).toBe("ANSWER");
  });

  it("submits a free-form question from the AI pane", async () => {
    const { client, sent } = stubClient();
    const onExchange = vi.fn();
    const host = mount(new AiSession(client), { onExchange });

    (host.querySelector(".lh-cp-ask-input") as HTMLTextAreaElement).value = "이 파일의 역할은?";
    (host.querySelector(".lh-cp-ask-bar") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(onExchange).toHaveBeenCalled());

    expect(sent[0].prompt).toContain("이 파일의 역할은?");
    expect(onExchange).toHaveBeenCalledWith(expect.objectContaining({ kind: "ask", path: "src/app.ts" }));
  });

});
