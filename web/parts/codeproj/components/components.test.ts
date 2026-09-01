// @vitest-environment jsdom
//
// Component harness: what survives a sloppy answer, and what a rendered answer lets you do.
import { describe, it, expect, vi } from "vitest";
import { parseComposed } from "./parse";
import { renderComposed, renderBlock } from "./render";
import { buildComponentDirective } from "./catalog";
import { KNOWN_BLOCKS, type Block } from "./types";

const ctx = { navigate: vi.fn(), currentPath: "app/service.py", exists: () => true };

describe("parseComposed", () => {
  it("reads the documented shape", () => {
    const out = parseComposed('{"blocks":[{"t":"answer","text":"이 함수는 대출을 만든다"}]}');
    expect(out?.blocks).toEqual([{ t: "answer", text: "이 함수는 대출을 만든다" }]);
  });

  it("accepts a bare array, fences and surrounding prose", () => {
    expect(parseComposed('[{"t":"text","text":"a"}]')?.blocks).toHaveLength(1);
    expect(parseComposed('```json\n{"blocks":[{"t":"text","text":"a"}]}\n```')?.blocks).toHaveLength(1);
    expect(parseComposed('설명드리면 {"blocks":[{"t":"text","text":"a"}]} 입니다')?.blocks).toHaveLength(1);
  });

  it("keeps an unknown component as text instead of dropping it", () => {
    const out = parseComposed('{"blocks":[{"t":"hologram","text":"미래 부품"},{"t":"text","text":"b"}]}');
    expect(out?.blocks).toEqual([
      { t: "text", text: "미래 부품" },
      { t: "text", text: "b" },
    ]);
  });

  it("skips blocks that carry nothing renderable", () => {
    const out = parseComposed('{"blocks":[{"t":"list","items":[]},{"t":"text","text":"살아남음"}]}');
    expect(out?.blocks).toEqual([{ t: "text", text: "살아남음" }]);
  });

  it("returns null when the answer is prose, so the caller shows it as prose", () => {
    expect(parseComposed("그냥 설명 문장입니다.")).toBeNull();
    expect(parseComposed('{"blocks": "이건 배열이 아님"}')).toBeNull();
    expect(parseComposed("{깨진 JSON")).toBeNull();
  });

  it("normalises a reversed line range and tolerates string numbers", () => {
    const out = parseComposed('{"blocks":[{"t":"ref","path":"a.py","lines":["9","3"]}]}');
    expect(out?.blocks[0]).toMatchObject({ t: "ref", lines: [3, 9] });
  });

  it("accepts `type` as well as `t`, which models mix up", () => {
    expect(parseComposed('{"blocks":[{"type":"caution","text":"조심"}]}')?.blocks[0]).toEqual({
      t: "caution",
      text: "조심",
    });
  });

  it("reads a full concept card", () => {
    const raw = JSON.stringify({
      blocks: [{ t: "concept", name: "의존성 주입", definition: "d", general: "g", industry: "i", here: "h" }],
    });
    expect(parseComposed(raw)?.blocks[0]).toMatchObject({ t: "concept", name: "의존성 주입", here: "h" });
  });
});

describe("rendering", () => {
  it("renders every catalogued component without throwing", () => {
    const samples: Block[] = [
      { t: "lead", text: "요약" },
      { t: "answer", text: "핵심" },
      { t: "text", text: "단락" },
      { t: "list", items: ["a", "b"] },
      { t: "steps", items: [{ title: "1단계", text: "설명" }] },
      { t: "ref", path: "app/service.py", lines: [1, 2] },
      { t: "focus", lines: [3, 4] },
      { t: "signature", sig: "def f()", params: [{ name: "x", desc: "설명" }], returns: "Loan" },
      { t: "io", input: "in", output: "out" },
      { t: "calls", callers: [{ path: "a.py" }], callees: [{ path: "b.py" }] },
      { t: "flow", items: [{ title: "요청", path: "app/router.py", lines: [1, 1] }] },
      { t: "alt", current: { title: "c", text: "t" }, other: { title: "o", text: "t" } },
      { t: "concept", name: "n", definition: "d", general: "g", industry: "i", here: "h" },
      { t: "tag", names: ["DI"] },
      { t: "terms", items: [{ term: "t", def: "d" }] },
      { t: "compare", headers: ["A", "B"], rows: [["1", "2"]] },
      { t: "caution", text: "함정" },
      { t: "why", decision: "d", reason: "r" },
      { t: "quiz", items: [{ q: "q", a: "a" }] },
      { t: "findit", q: "어디?", answer: { path: "app/service.py", lines: [5, 5] } },
      { t: "next", items: [{ label: "다음", path: "a.py" }] },
      { t: "related", items: [{ path: "a.py" }] },
      { t: "evidence", text: "코드 근거", path: "a.py", lines: [1, 1] },
      { t: "uncertain", text: "확인 못 함" },
    ];
    expect(samples.map((s) => s.t).sort()).toEqual([...KNOWN_BLOCKS].sort());
    for (const block of samples) {
      expect(renderBlock(block, ctx)).toBeInstanceOf(HTMLElement);
    }
  });

  it("makes a code reference navigate to its location", () => {
    const node = renderComposed({ blocks: [{ t: "ref", path: "app/repo.py", lines: [4, 8] }] }, ctx);
    const btn = node.querySelector(".lh-cb-ref") as HTMLButtonElement;
    expect(btn.textContent).toContain("app/repo.py 4-8행");
    btn.click();
    expect(ctx.navigate).toHaveBeenCalledWith("app/repo.py", [4, 8]);
  });

  it("degrades a reference to plain text when the file is not in the project", () => {
    const node = renderComposed(
      { blocks: [{ t: "ref", path: "ghost.py", lines: [1, 2] }] },
      { ...ctx, exists: () => false },
    );
    expect(node.querySelector(".lh-cb-ref")).toBeNull();
    expect(node.querySelector(".lh-cb-ref-flat")?.textContent).toContain("ghost.py");
  });

  it("keeps a quiz answer hidden until it is opened", () => {
    const node = renderComposed({ blocks: [{ t: "quiz", items: [{ q: "왜?", a: "때문에" }] }] }, ctx);
    const details = node.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("왜?");
  });

  it("lays a wide comparison out as a list, since the panel is narrow", () => {
    const wide = renderComposed(
      { blocks: [{ t: "compare", headers: ["A", "B", "C"], rows: [["1", "2", "3"]] }] },
      ctx,
    );
    expect(wide.querySelector("table")).toBeNull();
    expect(wide.querySelectorAll(".lh-cb-compare-line")).toHaveLength(3);

    const narrow = renderComposed(
      { blocks: [{ t: "compare", headers: ["A", "B"], rows: [["1", "2"]] }] },
      ctx,
    );
    expect(narrow.querySelector("table")).not.toBeNull();
  });

  it("escapes answer text rather than interpreting it as markup", () => {
    const node = renderComposed({ blocks: [{ t: "text", text: "<img src=x onerror=alert(1)>" }] }, ctx);
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toContain("<img");
  });
});

describe("prompt directive", () => {
  it("names every component it expects back", () => {
    const full = buildComponentDirective("full");
    for (const t of KNOWN_BLOCKS) expect(full).toContain(`"${t}"`);
  });

  it("gives a semi answer a shorter menu and a tighter budget", () => {
    const semi = buildComponentDirective("semi");
    expect(semi).toContain("부품 3개 이내");
    expect(semi).toContain('"answer"');
    expect(semi).not.toContain('"quiz"');
    expect(semi.length).toBeLessThan(buildComponentDirective("full").length);
  });
});
