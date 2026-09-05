// The annotation model. Node environment on purpose: none of this touches the DOM, which is
// what makes the placement maths testable at all.
import { describe, it, expect } from "vitest";
import {
  buildLineIndex,
  fileNote,
  parseAnnotations,
  placePopup,
  POPUP_GAP,
  POPUP_MARGIN,
  POPUP_SIDE_GAP,
  type Annotation,
} from "./annotations";

const note = (lines: [number, number], over: Partial<Annotation> = {}): Annotation => ({
  target: { lines },
  kind: "statement",
  what: "무엇을 한다",
  ...over,
});

describe("parseAnnotations", () => {
  it("keeps a complete annotation and drops the optional fields that are blank", () => {
    const r = parseAnnotations(
      {
        items: [
          {
            target: { lines: [3, 5], symbol: "connect" },
            kind: "function",
            what: "커넥션을 연다",
            why: "요청마다 새로 연다",
            concept: "  ",
            watch: "",
          },
        ],
      },
      10,
    );
    expect(r.status).toBe("ok");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      target: { lines: [3, 5], symbol: "connect" },
      kind: "function",
      what: "커넥션을 연다",
      why: "요청마다 새로 연다",
      concept: undefined,
      watch: undefined,
      refs: undefined,
    });
  });

  it("accepts a bare array as well as an items wrapper", () => {
    expect(parseAnnotations([{ lines: [1, 1], what: "x" }], 5).items).toHaveLength(1);
  });

  it("drops an annotation with nothing to say", () => {
    const r = parseAnnotations({ items: [{ target: { lines: [1, 1] }, kind: "statement" }] }, 5);
    expect(r.items).toHaveLength(0);
    expect(r.status).toBe("failed");
  });

  it("drops an out-of-range target instead of clamping it", () => {
    // Clamping would still paint an underline, just on the wrong code. An annotation pointing
    // at the wrong lines is worse than no annotation.
    const r = parseAnnotations(
      { items: [note([1, 3]), note([9, 40]), note([0, 2])] },
      10,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].target.lines).toEqual([1, 3]);
  });

  it("normalises a reversed range", () => {
    expect(parseAnnotations([{ lines: [7, 4], what: "x" }], 10).items[0].target.lines).toEqual([4, 7]);
  });

  it("demotes an unknown kind rather than losing the text", () => {
    const r = parseAnnotations([{ lines: [1, 1], kind: "wharrgarbl", what: "설명" }], 5);
    expect(r.items[0].kind).toBe("statement");
    expect(r.items[0].what).toBe("설명");
  });

  it("fails the file when more than 30% had to be dropped", () => {
    // Two of five is 40%: a file quietly reduced to three notes reads as an uninteresting file,
    // and nobody goes back to it. Better to say it failed.
    const r = parseAnnotations(
      { items: [note([1, 1]), note([2, 2]), note([3, 3]), note([99, 99]), note([98, 98])] },
      10,
    );
    expect(r.dropped).toBe(2);
    expect(r.total).toBe(5);
    expect(r.status).toBe("failed");
  });

  it("stays ok when the drop rate is within the limit", () => {
    const r = parseAnnotations(
      { items: [note([1, 1]), note([2, 2]), note([3, 3]), note([4, 4]), note([99, 99])] },
      10,
    );
    expect(r.dropped).toBe(1);
    expect(r.status).toBe("ok");
  });

  it("reports failure for input that is not a list at all", () => {
    expect(parseAnnotations("설명을 만들지 못했습니다", 10).status).toBe("failed");
    expect(parseAnnotations(null, 10).status).toBe("failed");
  });

  it("keeps refs that name a path and drops the rest", () => {
    const r = parseAnnotations(
      [{ lines: [1, 1], what: "x", refs: [{ path: "app/db.py", line: 3, label: "실제 저장" }, { label: "빈 것" }] }],
      5,
    );
    expect(r.items[0].refs).toEqual([{ path: "app/db.py", line: 3, label: "실제 저장" }]);
  });
});

describe("buildLineIndex", () => {
  it("maps every covered line to its annotation and leaves the rest at -1", () => {
    const items = [note([2, 4])];
    const idx = buildLineIndex(items, 6);
    expect([...idx]).toEqual([-1, -1, 0, 0, 0, -1, -1]);
  });

  it("gives an overlapped line to the narrowest range", () => {
    // The narrowest range is the most specific thing said about that line.
    const items = [note([1, 10]), note([4, 5])];
    const idx = buildLineIndex(items, 10);
    expect(idx[4]).toBe(1);
    expect(idx[5]).toBe(1);
    expect(idx[3]).toBe(0);
  });

  it("excludes the file-level note", () => {
    // Its range is the whole file, so indexing it would light the affordance on every line and
    // destroy the only thing the affordance is for.
    const items = [note([1, 8], { kind: "file" }), note([3, 3])];
    const idx = buildLineIndex(items, 8);
    expect(idx[1]).toBe(-1);
    expect(idx[8]).toBe(-1);
    expect(idx[3]).toBe(1);
  });

  it("finds the file note separately", () => {
    const file = note([1, 8], { kind: "file", what: "이 파일의 역할" });
    expect(fileNote([note([3, 3]), file])).toBe(file);
    expect(fileNote([note([3, 3])])).toBeNull();
  });
});

/*
 * The popup goes BESIDE the code, not under it, and falls back to the old below-or-above rule
 * only when the line is too long to leave room.
 *
 * `anchor.width` is the width of the CODE on that line, not of the row: a row is as wide as the
 * panel, so anchoring to it would put every popup into the fallback. That is why the anchors
 * below are narrow.
 */
describe("placePopup", () => {
  const popup = { width: 320, height: 160 };
  const viewport = { width: 1200, height: 800 };

  it("sits beside the code, just past where the line ends", () => {
    const p = placePopup({ left: 400, top: 200, width: 60, height: 20 }, popup, viewport);
    expect(p.beside).toBe(true);
    expect(p.left).toBe(400 + 60 + POPUP_SIDE_GAP);
    // Top-aligned with the line, so the explanation starts level with what it explains.
    expect(p.top).toBe(200);
    expect(p.above).toBe(false);
  });

  it("does not flip above merely because the line is near the bottom", () => {
    // Vertical room stopped deciding anything once there is horizontal room: beside the code
    // nothing is covered, so there is nothing to flip away from.
    const p = placePopup({ left: 400, top: 700, width: 60, height: 20 }, popup, viewport);
    expect(p.beside).toBe(true);
    expect(p.above).toBe(false);
    // Still pulled up to stay on screen.
    expect(p.top).toBe(viewport.height - popup.height - POPUP_MARGIN);
  });

  it("falls back under the code when the line runs too far right", () => {
    // A long line leaves no room beside it. This is the old rule, kept for exactly this case
    // and for the single-column layout under 900px.
    const p = placePopup({ left: 100, top: 200, width: 900, height: 20 }, popup, viewport);
    expect(p.beside).toBe(false);
    expect(p.top).toBe(200 + 20 + POPUP_GAP);
    expect(p.left).toBe(100);
  });

  it("still flips above in the fallback when there is no room below", () => {
    const p = placePopup({ left: 100, top: 700, width: 900, height: 20 }, popup, viewport);
    expect(p.beside).toBe(false);
    expect(p.above).toBe(true);
    expect(p.top).toBe(700 - popup.height - POPUP_GAP);
  });

  it("keeps the popup inside the right edge", () => {
    const p = placePopup({ left: 1150, top: 100, width: 40, height: 20 }, popup, viewport);
    expect(p.beside).toBe(false);
    expect(p.left).toBe(viewport.width - popup.width - POPUP_MARGIN);
  });

  it("never goes past the left or top margin", () => {
    // A line scrolled partly out of view has a negative left. Beside it there is plenty of room,
    // so it takes the side path, and the clamp keeps the top on screen.
    const p = placePopup({ left: -50, top: 4, width: 40, height: 20 }, popup, viewport);
    expect(p.left).toBeGreaterThanOrEqual(POPUP_MARGIN);
    expect(p.top).toBeGreaterThanOrEqual(POPUP_MARGIN);
  });

  it("lands on screen even when neither beside nor below fits", () => {
    // A narrow, short viewport: nothing fits anywhere. The popup must still be reachable.
    const p = placePopup({ left: 10, top: 40, width: 300, height: 20 }, popup, { width: 400, height: 180 });
    expect(p.beside).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(POPUP_MARGIN);
    expect(p.left).toBeGreaterThanOrEqual(POPUP_MARGIN);
  });
});
