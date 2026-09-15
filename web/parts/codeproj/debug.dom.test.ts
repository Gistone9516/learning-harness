// @vitest-environment jsdom
//
// FR-24: the debug run as the learner meets it.
//
// Two things are pinned here that nothing else can pin. First the cost shape: opening a project
// must send nothing, and a walkthrough already paid for must never be paid for twice. Second the
// state machine across a file switch, because `show()` rebuilds every line and the run has to
// survive the switch it caused itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { mountCodeproj } from "./codeproj";
import type { CodeProject } from "./model";
import type { TraceRun, TraceSet } from "./trace";

const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag}_${i + 1}()`).join("\n");

const PROJECT: CodeProject = {
  title: "도서 대출",
  summary: "요약",
  files: [
    { path: "app.py", content: lines(12, "app") },
    { path: "service.py", content: lines(12, "svc") },
  ],
};

function scripted(reply: (n: number) => Partial<AiResponse>) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "", session_id: "s1", error: null, ...reply(sent.length) } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

/** A finished run over two files, as it would come back from storage. */
const CACHED: TraceRun = {
  status: "ok",
  entry: { path: "app.py", line: 3 },
  steps: [
    { index: 1, path: "app.py", line: 3, explain: "요청이 들어온다", vars: [{ name: "book_id", value: "7" }] },
    { index: 2, path: "app.py", line: 4, explain: "서비스를 부른다", vars: [{ name: "book_id", value: "7" }] },
    {
      index: 3,
      path: "service.py",
      line: 2,
      explain: "대출 가능 여부를 본다",
      vars: [
        { name: "book_id", value: "7" },
        { name: "available", value: "True" },
      ],
    },
  ],
};

const cachedSet = (): TraceSet => ({ runs: { "app.py:3": structuredClone(CACHED) } });

function mount(over: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const { client, sent } = scripted(() => ({}));
  const handle = mountCodeproj(host, { session: new AiSession(client), project: PROJECT, ...over });
  return { host, sent, handle };
}

const q = (host: HTMLElement, sel: string) => host.querySelector(sel) as HTMLElement | null;
const debugBtn = (host: HTMLElement) => q(host, ".lh-cp-debug-btn") as HTMLButtonElement;
const lineEl = (host: HTMLElement, n: number) =>
  host.querySelector(`.lh-cp-code-line[data-line="${n}"]`) as HTMLElement;
const marked = (host: HTMLElement, cls: string) =>
  [...host.querySelectorAll(`.lh-cp-code-line.${cls}`)].map((e) => Number((e as HTMLElement).dataset["line"]));

function pressSpace(shift = false): boolean {
  const ev = new KeyboardEvent("keydown", { code: "Space", key: " ", shiftKey: shift, cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the control", () => {
  it("is not offered until a line is chosen, because the line is the whole input", () => {
    const { host } = mount();
    expect(debugBtn(host).hidden).toBe(true);
    lineEl(host, 3).click();
    expect(debugBtn(host).hidden).toBe(false);
    expect(debugBtn(host).textContent).toBe("디버그 실행");
  });

  it("is not offered at all without a session, rather than offered and dead", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountCodeproj(host, { session: null, project: PROJECT });
    lineEl(host, 3).click();
    expect(debugBtn(host).hidden).toBe(true);
  });

  it("becomes the way out once a run is going, so the header never carries both", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    expect(debugBtn(host).textContent).toBe("디버그 중단");
    expect(debugBtn(host).classList.contains("lh-cp-debug-btn--on")).toBe(true);
  });
});

describe("cost", () => {
  it("sends nothing when a project is opened and nothing is pressed", async () => {
    // The whole design rests on this: a walkthrough is the learner's to ask for.
    const { sent } = mount({ traces: cachedSet() });
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it("replays a stored walkthrough without a call", () => {
    // A run costs a real call to build. Paying for the same entry point twice is the one thing
    // storing it was for.
    const { host, sent } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    expect(sent).toEqual([]);
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("1/3단계");
  });
});

describe("markers", () => {
  it("marks the start and the current line in the gutter, and they can share a line", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    expect(marked(host, "lh-cp-debug-start")).toEqual([3]);
    expect(marked(host, "lh-cp-debug-current")).toEqual([3]);
  });

  it("moves the current marker and leaves the start where it was", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace();
    expect(marked(host, "lh-cp-debug-start")).toEqual([3]);
    expect(marked(host, "lh-cp-debug-current")).toEqual([4]);
  });

  it("clears both when the run is stopped", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    debugBtn(host).click();
    expect(marked(host, "lh-cp-debug-start")).toEqual([]);
    expect(marked(host, "lh-cp-debug-current")).toEqual([]);
    expect(q(host, ".lh-cp-note-popup")!.hidden).toBe(true);
  });
});

describe("crossing a file", () => {
  it("opens the called file and carries on there", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace();
    pressSpace();
    expect(q(host, ".lh-cp-path-label")!.textContent).toBe("service.py");
    expect(marked(host, "lh-cp-debug-current")).toEqual([2]);
    // The start marker belongs to the other file and must not follow the pointer across.
    expect(marked(host, "lh-cp-debug-start")).toEqual([]);
  });

  it("puts the markers back when the learner wanders off and returns", () => {
    // `show()` rebuilds every line, so nothing painted on them survives a switch on its own.
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    const other = [...host.querySelectorAll(".lh-cp-tree-file")].find(
      (b) => (b as HTMLElement).dataset["path"] === "service.py",
    ) as HTMLElement;
    other.click();
    expect(marked(host, "lh-cp-debug-current")).toEqual([]);   // the run is in the other file
    const back = [...host.querySelectorAll(".lh-cp-tree-file")].find(
      (b) => (b as HTMLElement).dataset["path"] === "app.py",
    ) as HTMLElement;
    back.click();
    expect(marked(host, "lh-cp-debug-current")).toEqual([3]);
    expect(marked(host, "lh-cp-debug-start")).toEqual([3]);
  });
});

describe("the space key", () => {
  it("steps forward, and back with shift", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace();
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("2/3단계");
    pressSpace(true);
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("1/3단계");
  });

  it("stops at both ends rather than wrapping", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace(true);
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("1/3단계");
    pressSpace();
    pressSpace();
    pressSpace();
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("3/3단계");
  });

  it("takes the key away from the page, which is what stops the button re-firing", () => {
    // A native <button> activates on the Space KEYUP after this keydown, and the button that
    // started the run is the one holding focus. preventDefault here suppresses that and the
    // page scroll at once.
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    expect(pressSpace()).toBe(true);
  });

  it("leaves the key alone when there is no run", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    expect(pressSpace()).toBe(false);
  });

  it("leaves the key alone while the caret is in the question box", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    (q(host, ".lh-cp-ask-input") as HTMLTextAreaElement).focus();
    expect(pressSpace()).toBe(false);
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("1/3단계");
  });
});

describe("the popup", () => {
  it("says which step this is and that the walkthrough is a prediction", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("1/3단계");
    expect(q(host, ".lh-cp-debug-predicted")!.textContent).toBe("예측");
    expect(q(host, ".lh-cp-debug-what")!.textContent).toBe("요청이 들어온다");
  });

  it("shows the whole live set, marking only what this step moved", () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    // Nothing is marked on the first step: everything is new there, which the counter says.
    expect(host.querySelectorAll(".lh-cp-debug-var--changed")).toHaveLength(0);
    pressSpace();
    pressSpace();
    const names = [...host.querySelectorAll(".lh-cp-debug-var-name")].map((e) => e.textContent);
    expect(names).toEqual(["book_id", "available"]);
    // book_id was already 7; available is new at this step.
    const changed = [...host.querySelectorAll(".lh-cp-debug-var-name.lh-cp-debug-var--changed")];
    expect(changed.map((e) => e.textContent)).toEqual(["available"]);
  });

  it("says the walkthrough ended, and says it differently when it was cut short", () => {
    const cut = cachedSet();
    cut.runs["app.py:3"].truncated = true;
    const { host } = mount({ traces: cut });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace();
    pressSpace();
    expect(q(host, ".lh-cp-debug-note")!.textContent).toContain("프로그램이 끝난 지점은 아닙니다");
  });
});

describe("who owns the popup", () => {
  // Both of these were live defects on 2026-09-05, and neither was visible in this file until it
  // was looked for: jsdom has no layout and no real scrolling, so the suite was green while the
  // popup was being shut a frame after it opened.
  const start = () => {
    const { host } = mount({ traces: cachedSet() });
    lineEl(host, 3).click();
    debugBtn(host).click();
    return host;
  };
  const shown = (host: HTMLElement) => !(q(host, ".lh-cp-note-popup") as HTMLElement).hidden;

  it("survives a scroll, because stepping is what caused the scroll", () => {
    // `markDebug` scrolls the new line into view; the scroll event arrives after the popup was
    // opened. Closing on it means every step that has to scroll closes its own popup -- which is
    // every step that crosses into another file.
    const host = start();
    expect(shown(host)).toBe(true);
    q(host, ".lh-cp-code-scroll")!.dispatchEvent(new Event("scroll"));
    expect(shown(host)).toBe(true);
  });

  it("survives the mouse moving over the code", () => {
    // The hover path closes on any pointer movement without Ctrl. A debug popup was not opened
    // by a pointer, so a pointer moving on is not a reason to take it down.
    const host = start();
    q(host, ".lh-cp-code-scroll")!.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, ctrlKey: false }),
    );
    expect(shown(host)).toBe(true);
  });

  it("survives a close the hover path queued before the run existed", () => {
    // Moving the pointer from the code up to the debug button fires the code area's mouseleave
    // while there is still no run, arming a 120ms close. By the time it fires the run has opened
    // its popup. Measured 2026-09-05: the popup rendered and vanished a tenth of a second later,
    // every single time, and nothing in this file saw it because jsdom has no pointer.
    vi.useFakeTimers();
    try {
      const { host } = mount({ traces: cachedSet() });
      lineEl(host, 3).click();
      q(host, ".lh-cp-code-scroll")!.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      debugBtn(host).click();
      expect(shown(host)).toBe(true);
      vi.advanceTimersByTime(500);
      expect(shown(host)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still yields to an explicit request for a line's note", () => {
    // Two things fighting over one popup would not be recoverable; one explicit gesture wins and
    // Space brings the step back.
    const host = start();
    lineEl(host, 5).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", altKey: true, cancelable: true }));
    // Nothing on line 5 has a note in this fixture, so the popup simply stays on the step.
    expect(shown(host)).toBe(true);
    // Escape is the way out, and it leaves the run alone.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(shown(host)).toBe(false);
    expect(marked(host, "lh-cp-debug-current")).toEqual([3]);
    pressSpace();
    expect(shown(host)).toBe(true);
  });
});

describe("the concepts tab", () => {
  it("pauses a run rather than ending it", () => {
    // The panels are only hidden, so position and markers survive; Space is released so the
    // concepts view keeps ordinary page scrolling.
    const { host, handle } = mount({
      traces: cachedSet(),
      concepts: { entries: [{ seed: { area: "a", concept_id: "c-one", title: "개념" }, status: "pending" }] },
    });
    lineEl(host, 3).click();
    debugBtn(host).click();
    pressSpace();

    handle.setView("concepts");
    expect(pressSpace()).toBe(false);
    expect(q(host, ".lh-cp-note-popup")!.hidden).toBe(true);

    handle.setView("code");
    expect(pressSpace()).toBe(true);
    expect(q(host, ".lh-cp-debug-counter")!.textContent).toBe("3/3단계");
    expect(marked(host, "lh-cp-debug-current")).toEqual([2]);
  });
});

describe("building a new one", () => {
  const legReply = (startLine: number, count: number, over: Record<string, unknown> = {}) =>
    JSON.stringify({
      steps: Array.from({ length: count }, (_, i) => ({
        line: startLine + i,
        explain: `${startLine + i}행`,
        vars: [{ name: "n", value: String(i) }],
      })),
      leaves_to: null,
      done: true,
      ...over,
    });

  it("stores the run as its legs land, so walking away keeps what arrived", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { client } = scripted(() => ({ text: legReply(3, 4) }));
    const onTraces = vi.fn();
    mountCodeproj(host, { session: new AiSession(client), project: PROJECT, onTraces });

    lineEl(host, 3).click();
    debugBtn(host).click();
    await vi.waitFor(() => expect(onTraces).toHaveBeenCalled());
    const set = onTraces.mock.calls.at(-1)![0] as TraceSet;
    expect(Object.keys(set.runs)).toEqual(["app.py:3"]);
    expect(set.runs["app.py:3"].steps).toHaveLength(4);
  });

  it("says so and stops rather than leaving a dead run on screen when it fails", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { client } = scripted(() => ({ ok: false, error: "timeout" }));
    mountCodeproj(host, { session: new AiSession(client), project: PROJECT });

    lineEl(host, 3).click();
    debugBtn(host).click();
    await vi.waitFor(() => expect(debugBtn(host).textContent).toBe("디버그 실행"));
    expect(marked(host, "lh-cp-debug-current")).toEqual([]);
    expect(host.querySelector(".lh-cp-notice")?.textContent ?? "").toContain("실행 흐름");
  });
});
