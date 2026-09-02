// @vitest-environment jsdom
//
// FR-22: the short answer as the learner meets it. What matters here is that depth is a visible,
// deliberate choice and that the way up is always offered — not the prompt text, which is
// covered in components.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { mountCodeproj } from "./codeproj";
import type { AnnotationSet } from "./annotations";

const PROJECT = {
  title: "도서 관리 API",
  summary: "요약",
  files: [{ path: "app/db.py", content: "one\ntwo\nthree\nfour\nfive" }],
};

const ANNOTATIONS: AnnotationSet = {
  files: {
    "app/db.py": {
      status: "ok",
      items: [
        {
          target: { lines: [2, 3], symbol: "connect" },
          kind: "function",
          what: "커넥션을 연다",
          why: "요청마다 새로 연다",
        },
      ],
    },
  },
};

const ANSWER = JSON.stringify({
  blocks: [
    { t: "text", text: "배경 설명" },
    { t: "answer", text: "핵심 답" },
    { t: "why", decision: "a", reason: "b" },
    { t: "caution", text: "함정" },
    { t: "ref", path: "app/db.py", lines: [1, 2], note: "참조" },
  ],
});

function mount(opts: { session?: boolean } = {}) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: ANSWER, session_id: "s1", error: null } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;

  const host = document.createElement("div");
  document.body.appendChild(host);
  mountCodeproj(host, {
    session: opts.session === false ? null : new AiSession(client),
    project: PROJECT,
    annotations: ANNOTATIONS,
  });
  return { host, sent };
}

async function askSomething(host: HTMLElement) {
  const input = host.querySelector(".lh-cp-ask-input") as HTMLTextAreaElement | HTMLInputElement;
  input.value = "왜 이렇게 했나요?";
  (host.querySelector(".lh-cp-ask-bar") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("answer depth", () => {
  it("starts short, because most questions while reading are small", async () => {
    const { host } = mount();
    const [short, long] = [...host.querySelectorAll(".lh-cp-depth-btn")] as HTMLElement[];
    expect(short.textContent).toBe("짧게");
    expect(short.classList.contains("lh-cp-depth--on")).toBe(true);
    expect(long.classList.contains("lh-cp-depth--on")).toBe(false);
  });

  it("sends the chosen depth, and the state on screen matches what was sent", async () => {
    const { host, sent } = mount();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].prompt).toContain("부품 3개 이내");

    const [, long] = [...host.querySelectorAll(".lh-cp-depth-btn")] as HTMLElement[];
    long.click();
    expect(long.classList.contains("lh-cp-depth--on")).toBe(true);
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].prompt).not.toContain("부품 3개 이내");
  });

  it("sends the annotation covering the lines as prior knowledge, and says the code wins", async () => {
    // The annotation is a generated artifact too. Handing it over without an order of precedence
    // would let one wrong note quietly poison every later answer about that code.
    const { host, sent } = mount();
    (host.querySelector('.lh-cp-code-line[data-line="2"]') as HTMLElement).click();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].prompt).toContain("커넥션을 연다");
    expect(sent[0].prompt).toContain("코드와 어긋나면 코드를 따르세요");
  });

  it("does not send grounds for a full answer", async () => {
    const { host, sent } = mount();
    (host.querySelector('.lh-cp-code-line[data-line="2"]') as HTMLElement).click();
    ([...host.querySelectorAll(".lh-cp-depth-btn")][1] as HTMLElement).click();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].prompt).not.toContain("이미 알려진 것");
  });
});

describe("a short answer on screen", () => {
  it("is labelled, shortened, and led by the answer", async () => {
    const { host, sent } = mount();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const entry = await vi.waitFor(() => {
      const e = host.querySelector(".lh-cp-entry--semi") as HTMLElement;
      expect(e).toBeTruthy();
      return e;
    });
    expect(entry.querySelector(".lh-cp-ai-badge")!.textContent).toBe("짧은 답");
    // Five blocks came back for a three-block budget, and the answer arrived third. What is kept
    // is answer + the first two others; the caution and the ref are past the cap.
    const body = await vi.waitFor(() => {
      const b = entry.querySelector(".lh-cp-entry-body") as HTMLElement;
      expect(b.textContent).toContain("핵심 답");
      return b;
    });
    expect(body.textContent).not.toContain("함정");
    expect(body.textContent).not.toContain("참조");
  });

  it("always offers the way up, and stacks rather than replaces", async () => {
    // The thread is a log of what was asked, not a view of the latest answer.
    const { host, sent } = mount();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const promote = await vi.waitFor(() => {
      const b = host.querySelector(".lh-cp-entry-promote") as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });
    expect(promote.textContent).toBe("전체 해설로 보기");
    promote.click();

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await vi.waitFor(() => expect(host.querySelectorAll(".lh-cp-entry").length).toBe(2));
    // The short one is still there; the full one is not labelled short.
    expect(host.querySelectorAll(".lh-cp-entry--semi")).toHaveLength(1);
  });

  it("gives a full answer no badge and no promotion", async () => {
    const { host, sent } = mount();
    ([...host.querySelectorAll(".lh-cp-depth-btn")][1] as HTMLElement).click();
    await askSomething(host);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() => expect(host.querySelector(".lh-cp-entry")).toBeTruthy());
    expect(host.querySelector(".lh-cp-ai-badge")).toBeNull();
    expect(host.querySelector(".lh-cp-entry-promote")).toBeNull();
  });
});

describe("promotion out of the annotation popup", () => {
  it("offers it only where a session can answer", () => {
    const { host } = mount();
    (host.querySelector('.lh-cp-code-line[data-line="2"]') as HTMLElement).dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, ctrlKey: true }),
    );
    expect(host.querySelector(".lh-cp-note-expand")).toBeTruthy();

    document.body.innerHTML = "";
    const offline = mount({ session: false });
    (offline.host.querySelector('.lh-cp-code-line[data-line="2"]') as HTMLElement).dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, ctrlKey: true }),
    );
    // A control that cannot work must not be drawn at all.
    expect(offline.host.querySelector(".lh-cp-note-expand")).toBeNull();
  });

  it("asks a short question about the note instead of inventing a second request kind", async () => {
    const { host, sent } = mount();
    (host.querySelector('.lh-cp-code-line[data-line="2"]') as HTMLElement).dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, ctrlKey: true }),
    );
    (host.querySelector(".lh-cp-note-expand") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].prompt).toContain("커넥션을 연다");
    expect(sent[0].prompt).toContain("부품 3개 이내");
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });
});
