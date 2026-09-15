// @vitest-environment jsdom
//
// Scrap basket: collecting several regions, possibly across files, as one subject for a question.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { mountCodeproj, canAddScrap, scrapLineCount, SCRAP_MAX_COUNT, type CodeProject } from "./codeproj";
import { buildAskPrompt, buildScrapExplainPrompt } from "./prompts";

const PROJECT: CodeProject = {
  title: "T",
  summary: "S",
  files: [
    { path: "app/service.py", content: "one\ntwo\nthree\nfour\nfive" },
    { path: "app/repo.py", content: "alpha\nbeta\ngamma" },
  ],
};

function stubClient() {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "ANSWER", session_id: "s1", error: null } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const { client, sent } = stubClient();
  mountCodeproj(host, { session: new AiSession(client), project: PROJECT });
  return { host, sent };
}

const q = (host: HTMLElement, sel: string) => host.querySelector(sel) as HTMLElement;
const all = (host: HTMLElement, sel: string) => Array.from(host.querySelectorAll(sel)) as HTMLElement[];

/** Select a line (optionally extending) and press the collect button. */
function collect(host: HTMLElement, line: number, extendTo?: number) {
  const rows = all(host, ".lh-cp-code-line");
  rows[line - 1].click();
  if (extendTo) {
    rows[extendTo - 1].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
  }
  q(host, ".lh-cp-scrap-btn").click();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("limits", () => {
  it("counts lines across regions and refuses past the caps", () => {
    const scraps = [
      { id: "a", path: "p", lines: [1, 10] as [number, number], code: "" },
      { id: "b", path: "p", lines: [20, 29] as [number, number], code: "" },
    ];
    expect(scrapLineCount(scraps)).toBe(20);
    expect(canAddScrap(scraps, [1, 5])).toBe(true);
    expect(canAddScrap(scraps, [1, 300])).toBe(false);

    const full = Array.from({ length: SCRAP_MAX_COUNT }, (_, i) => ({
      id: `s${i}`, path: "p", lines: [i + 1, i + 1] as [number, number], code: "",
    }));
    expect(canAddScrap(full, [1, 1])).toBe(false);
  });
});

describe("collecting", () => {
  it("shows the collect button only while lines are selected", () => {
    const { host } = mount();
    expect(q(host, ".lh-cp-scrap-btn").hidden).toBe(true);
    all(host, ".lh-cp-code-line")[0].click();
    expect(q(host, ".lh-cp-scrap-btn").hidden).toBe(false);
  });

  it("lists a collected region and marks it in the code", () => {
    const { host } = mount();
    collect(host, 2, 3);

    expect(q(host, ".lh-cp-scrap-count").textContent).toContain("1개 구간");
    expect(q(host, ".lh-cp-scrap-lines").textContent).toBe("2-3행");
    expect(all(host, ".lh-cp-line-scrapped")).toHaveLength(2);
  });

  it("collects across files and keeps both entries", () => {
    const { host } = mount();
    collect(host, 1);
    all(host, ".lh-cp-tree-file").find((b) => b.dataset["path"] === "app/repo.py")!.click();
    collect(host, 2);

    const paths = all(host, ".lh-cp-scrap-path").map((e) => e.textContent);
    expect(paths).toEqual(["app/service.py", "app/repo.py"]);
    // Only the regions belonging to the file on screen are marked in the code.
    expect(all(host, ".lh-cp-line-scrapped")).toHaveLength(1);
  });

  it("ignores collecting the very same region twice", () => {
    const { host } = mount();
    collect(host, 2);
    collect(host, 2);
    expect(all(host, ".lh-cp-scrap-item")).toHaveLength(1);
  });

  it("removes one region and clears them all", () => {
    const { host } = mount();
    collect(host, 1);
    collect(host, 3);
    expect(all(host, ".lh-cp-scrap-item")).toHaveLength(2);

    q(host, ".lh-cp-scrap-drop").click();
    expect(all(host, ".lh-cp-scrap-item")).toHaveLength(1);

    q(host, ".lh-cp-scrap-clear").click();
    expect(all(host, ".lh-cp-scrap-item")).toHaveLength(0);
    expect(q(host, ".lh-cp-scrap-box").hidden).toBe(true);
  });

  it("jumps back to a collected region, switching files when needed", () => {
    const { host } = mount();
    collect(host, 2);
    all(host, ".lh-cp-tree-file").find((b) => b.dataset["path"] === "app/repo.py")!.click();
    expect(q(host, ".lh-cp-path-label").textContent).toBe("app/repo.py");

    q(host, ".lh-cp-scrap-go").click();
    expect(q(host, ".lh-cp-path-label").textContent).toBe("app/service.py");
    expect(q(host, ".lh-cp-selection-label").textContent).toContain("2-2");
  });
});

describe("asking about the basket", () => {
  it("sends every collected region with its own location", async () => {
    const { host, sent } = mount();
    collect(host, 1, 2);
    all(host, ".lh-cp-tree-file").find((b) => b.dataset["path"] === "app/repo.py")!.click();
    collect(host, 3);

    (q(host, ".lh-cp-ask-input") as HTMLTextAreaElement).value = "이 둘은 어떻게 이어지나요?";
    q(host, ".lh-cp-ask-bar").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const prompt = sent[0].prompt as string;
    expect(prompt).toContain("선택한 2개 구간");
    expect(prompt).toContain("[구간 1] app/service.py 1-2행");
    expect(prompt).toContain("one\ntwo");
    expect(prompt).toContain("[구간 2] app/repo.py 3행");
    expect(prompt).toContain("gamma");
    expect(prompt).toContain("이 둘은 어떻게 이어지나요?");
  });

  it("sends a lens request over the basket and titles it by count", async () => {
    const { host, sent } = mount();
    collect(host, 1);
    collect(host, 3);

    (q(host, ".lh-cp-lens-select") as HTMLSelectElement).value = "flow";
    q(host, ".lh-cp-explain-btn").click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0].prompt).toContain("선택한 2개 구간");
    expect(sent[0].prompt).toContain("구간 사이의 관계");
    expect(q(host, ".lh-cp-entry-title").textContent).toContain("2개 구간");
  });
});

describe("prompt builders", () => {
  it("keeps single-target behaviour when no region is collected", () => {
    const prompt = buildAskPrompt({ target: { path: "a.py", lines: [2, 4] }, question: "왜?", depth: "full" }, "code");
    expect(prompt).toContain("파일: a.py");
    expect(prompt).not.toContain("구간 1");
  });

  it("asks the concept lens for its four-part shape even over a basket", () => {
    const prompt = buildScrapExplainPrompt(
      [{ id: "a", path: "a.py", lines: [1, 2], code: "x" }],
      "concepts",
    );
    expect(prompt).toContain("1. 개념");
  });
});
