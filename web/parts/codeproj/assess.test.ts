// @vitest-environment jsdom
//
// FR-25: judging a topic before spending the expensive call on it.
//
// The property under test everywhere below is that this gate FAILS OPEN. A pre-check that can
// refuse on its own malfunction is a worse failure than the one it prevents: the learner would be
// locked out of generating at all, by a component that exists only to save them time.
//
// The measured problem it answers: a learner lost two or three attempts of tens of minutes each
// (2026-09-10). Generation is `xhigh` and the only measured full run is 279s (2026-09-02), so a
// topic that cannot be built costs that whole wait before anything is said about it.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { assessTopic } from "./session";
import { parseAssessment } from "./model";
import { buildAssessPrompt, buildAssessSystem } from "./prompts";
import { mountCodeproj } from "./codeproj";

function scripted(reply: (n: number, req: any) => Partial<AiResponse>) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "", session_id: "s1", error: null, ...reply(sent.length, req) } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

const REWORD = JSON.stringify({
  verdict: "reword",
  scale: "small",
  scale_reason: "",
  why: "배포 절차라서 도메인 로직이 설 자리가 없습니다.",
  suggestions: ["요청을 무중단으로 넘기는 리버스 프록시", "커넥션을 유지한 채 교체되는 게이트웨이"],
});

describe("parseAssessment fails open", () => {
  it("passes a clean verdict through", () => {
    const a = parseAssessment(REWORD, "large");
    expect(a.verdict).toBe("reword");
    expect(a.scale).toBe("small");
    expect(a.suggestions).toHaveLength(2);
  });

  it("does not block on an unreadable reply", () => {
    expect(parseAssessment("판정할 수 없습니다", "medium").verdict).toBe("go");
    expect(parseAssessment("", "medium").verdict).toBe("go");
    expect(parseAssessment("null", "medium").verdict).toBe("go");
  });

  it("does not block on a refusal that says nothing", () => {
    // Being stopped and told only that you were stopped is the dead end this whole feature
    // exists to remove. Rebuilding it one layer earlier would be worse, not better.
    const a = parseAssessment(JSON.stringify({ verdict: "reword", why: "" }), "small");
    expect(a.verdict).toBe("go");
  });

  it("keeps the learner's scale when the model does not name a usable one", () => {
    expect(parseAssessment(JSON.stringify({ verdict: "go", scale: "enormous" }), "medium").scale).toBe("medium");
    expect(parseAssessment("{}", "large").scale).toBe("large");
  });

  it("caps and trims the suggestions, and drops empty ones", () => {
    const a = parseAssessment(
      JSON.stringify({ verdict: "reword", why: "이유", suggestions: ["  하나  ", "", "둘", "셋", "넷"] }),
      "small",
    );
    expect(a.suggestions).toEqual(["하나", "둘", "셋"]);
  });
});

describe("assessTopic", () => {
  it("sends the topic and the learner's scale, at the medium default", async () => {
    const { client, sent } = scripted(() => ({ text: JSON.stringify({ verdict: "go", scale: "medium" }) }));
    await assessTopic(new AiSession(client), { topic: "메모 앱", scale: "medium", seed: "Python" });
    expect(sent).toHaveLength(1);
    expect(sent[0].prompt).toContain("메모 앱");
    expect(sent[0].prompt).toContain("medium");
    expect(sent[0].prompt).toContain("Python");
    expect(sent[0].effort).toBe("medium");
  });

  it("says so when no stack was given, rather than leaving the field out", () => {
    expect(buildAssessPrompt({ topic: "t", scale: "small" })).toContain("(지정 없음)");
  });

  it("does not block when the call itself fails", async () => {
    const { client } = scripted(() => ({ ok: false, error: "HTTP 502" }));
    const a = await assessTopic(new AiSession(client), { topic: "t", scale: "large" });
    expect(a.verdict).toBe("go");
    expect(a.scale).toBe("large");
  });

  it("asks for a paste-ready sentence, not advice", () => {
    // A suggestion the learner has to rewrite themselves is a second puzzle, not a fix.
    expect(buildAssessSystem()).toMatch(/그대로 입력하면 바로 생성되는 완성된 문장/);
  });

  it("treats the learner's scale as a recommendation it may move", () => {
    expect(buildAssessSystem()).toMatch(/학습자가 고른 규모는 권장일 뿐이다/);
  });

  it("errs toward allowing, so only a clear refusal stops anyone", () => {
    expect(buildAssessSystem()).toMatch(/판정이 애매하면 만들 수 있다고 본다/);
  });
});

describe("the screen, when a topic is refused", () => {
  const PROJECT_JSON = JSON.stringify({
    title: "T",
    summary: "S",
    files: [{ path: "a.py", content: "x" }],
  });

  function mount(reply: (n: number, req: any) => Partial<AiResponse>) {
    const host = document.createElement("div");
    host.id = "app";
    document.body.appendChild(host);
    const { client, sent } = scripted(reply);
    mountCodeproj(host, { session: new AiSession(client), initialInput: { topic: "무중단 배포 실습", scale: "small" } });
    return { host, sent };
  }

  const q = (h: HTMLElement, s: string) => h.querySelector(s) as HTMLElement | null;

  it("stops before the expensive call and says why", async () => {
    const { host, sent } = mount(() => ({ text: REWORD }));
    (q(host, ".lh-cp-generate-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q(host, ".lh-cp-generate-warning")).toBeTruthy());

    // The whole point: exactly one call was made, and it was the cheap one.
    expect(sent).toHaveLength(1);
    expect(sent[0].effort).toBe("medium");
    expect(q(host, ".lh-cp-generate-warning")!.textContent).toContain("도메인 로직");
  });

  it("offers the suggestions as controls that fill the box", async () => {
    const { host } = mount(() => ({ text: REWORD }));
    (q(host, ".lh-cp-generate-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(q(host, ".lh-cp-generate-suggestion")).toBeTruthy());

    const picks = [...host.querySelectorAll(".lh-cp-generate-suggestion")];
    expect(picks).toHaveLength(2);
    (picks[0] as HTMLButtonElement).click();
    expect((q(host, ".lh-cp-topic-input") as HTMLInputElement).value).toBe("요청을 무중단으로 넘기는 리버스 프록시");
    // Taking the suggestion clears the warning: it is answered, not still standing.
    expect(q(host, ".lh-cp-generate-advice")!.hidden).toBe(true);
  });

  it("leaves the button usable, because the learner has to be able to try again", async () => {
    const { host } = mount(() => ({ text: REWORD }));
    const btn = q(host, ".lh-cp-generate-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(q(host, ".lh-cp-generate-warning")).toBeTruthy());
    expect(btn.disabled).toBe(false);
  });

  it("goes on to generate when the topic passes, using the scale the model settled on", async () => {
    // The generation is failed deliberately: on success the panel removes itself, and the note
    // about the moved scale is on that panel. Failing keeps the screen up to be read.
    const { host, sent } = mount((n) =>
      n === 1
        ? { text: JSON.stringify({ verdict: "go", scale: "large", scale_reason: "계층이 여럿 필요합니다." }) }
        : { ok: false, error: "HTTP 502" },
    );
    const btn = q(host, ".lh-cp-generate-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(btn.disabled).toBe(false));

    // The learner picked `small`; the model moved it and generation is bound to the new value.
    expect(sent).toHaveLength(2);
    expect(sent[1].effort).toBe("xhigh");
    expect(sent[1].prompt).toContain("scale=large");
    expect(sent[1].prompt).toContain("18-30 files");
    // And the screen says it moved, rather than silently overriding the control they set.
    expect(q(host, ".lh-cp-generate-meta")!.textContent).toContain("계층이 여럿 필요합니다.");
  });

  it("generates with the learner's own scale when the model leaves it alone", async () => {
    const { host, sent } = mount((n) =>
      n === 1 ? { text: JSON.stringify({ verdict: "go", scale: "small" }) } : { ok: false, error: "HTTP 502" },
    );
    const btn = q(host, ".lh-cp-generate-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(btn.disabled).toBe(false));
    expect(sent[1].prompt).toContain("scale=small");
    // No note, because nothing moved. A line saying "scale small" every time is noise.
    expect(q(host, ".lh-cp-generate-meta")!.textContent).toMatch(/^\d+:\d\d$/);
  });
});

describe("the screen, when a generation fails", () => {
  function mount(reply: (n: number, req: any) => Partial<AiResponse>) {
    const host = document.createElement("div");
    host.id = "app";
    document.body.appendChild(host);
    const { client, sent } = scripted(reply);
    mountCodeproj(host, { session: new AiSession(client), initialInput: { topic: "메모 앱", scale: "small" } });
    return { host, sent };
  }
  const phase = (h: HTMLElement) => (h.querySelector(".lh-cp-generate-phase") as HTMLElement).textContent ?? "";
  const meta = (h: HTMLElement) => (h.querySelector(".lh-cp-generate-meta") as HTMLElement).textContent ?? "";
  const go = JSON.stringify({ verdict: "go", scale: "small" });

  async function run(second: Partial<AiResponse>) {
    const { host } = mount((n) => (n === 1 ? { text: go } : second));
    const btn = host.querySelector(".lh-cp-generate-btn") as HTMLButtonElement;
    btn.click();
    // The button coming back is the flow finishing, and does not depend on the wording.
    await vi.waitFor(() => expect(btn.disabled).toBe(false));
    return host;
  }

  it("names the timeout, which is the one the learner can act on", async () => {
    const host = await run({ ok: false, error: "Timeout after 1800s" });
    expect(phase(host)).toContain("규모를 한 단계 낮추거나");
  });

  it("names a transport failure and points at the server", async () => {
    const host = await run({ ok: false, error: "HTTP 502" });
    expect(phase(host)).toContain("서버가 켜져 있는지");
    expect(phase(host)).toContain("HTTP 502");
  });

  it("separates prose from a wrong-shaped reply", async () => {
    expect(phase(await run({ text: "죄송하지만 어렵습니다." }))).toContain("다른 형식으로 답했습니다");
    expect(phase(await run({ text: JSON.stringify({ answer: "no" }) }))).toContain("형식에 맞지 않는");
  });

  it("refuses a project with no files instead of opening an empty one", async () => {
    const host = await run({ text: JSON.stringify({ title: "T", summary: "S", files: [] }) });
    expect(phase(host)).toContain("파일이 하나도 없는");
  });

  it("keeps the elapsed time on screen", async () => {
    // It used to be wiped, so a failure arrived without even the one fact the learner already
    // had: how long it had been running before it gave up.
    const host = await run({ ok: false, error: "Timeout after 1800s" });
    expect(meta(host)).toMatch(/^\d+:\d\d$/);
  });
});
