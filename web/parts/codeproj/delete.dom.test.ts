// @vitest-environment jsdom
//
// The delete affordance and its confirmation.
//
// What is pinned here is the safety, not the styling: the control must not be reachable when the
// dialog is not open, nothing may be deleted without a second act, and the safe exit must be the
// one that happens if the learner does nothing thoughtful.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderLauncher } from "./launcher";
import type { ArchivedProject } from "../../src/flow/study";

const archived = (over: Partial<ArchivedProject> = {}): ArchivedProject => ({
  id: "prj-one",
  title: "도서 대출 관리 REST API",
  topic: "도서 대출",
  stack: "FastAPI + SQLite",
  scale: "small",
  file_count: 10,
  updated_at: 100,
  ...over,
});

function mount(opts: { onDelete?: (p: ArchivedProject) => void } = {}) {
  const host = document.createElement("div");
  host.id = "app";
  document.body.appendChild(host);
  const handlers = {
    onStartProposal: vi.fn(),
    onOpenArchived: vi.fn(),
    onFreeStart: vi.fn(),
    ...(opts.onDelete ? { onDeleteArchived: opts.onDelete } : {}),
  };
  renderLauncher(host, { proposals: [], archived: [archived(), archived({ id: "prj-two", title: "두 번째" })] }, handlers);
  return { host, handlers };
}

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom does not implement the top layer; the calls still have to be observable.
  (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  (HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("the delete control", () => {
  it("is not drawn at all when the owner cannot delete", () => {
    // A control that looks like it deletes and does nothing is worse than no control.
    const { host } = mount();
    expect(host.querySelector(".lh-cp-archive-del")).toBeNull();
    expect(host.querySelector(".lh-cp-confirm-dialog")).toBeNull();
  });

  it("is a sibling of the open button, never inside it", () => {
    // A button inside a button is invalid, and the click would have two owners.
    const { host } = mount({ onDelete: vi.fn() });
    const row = host.querySelector(".lh-cp-archive-item")!;
    const open = row.querySelector(".lh-cp-archive-btn")!;
    const del = row.querySelector(".lh-cp-archive-del")!;
    expect(del.parentElement).toBe(row);
    expect(open.contains(del)).toBe(false);
  });

  it("names the project it would delete", () => {
    // Several rows are on screen; "삭제" five times tells a screen reader nothing.
    const { host } = mount({ onDelete: vi.fn() });
    const dels = [...host.querySelectorAll(".lh-cp-archive-del")];
    expect(dels.map((d) => d.getAttribute("aria-label"))).toEqual([
      "도서 대출 관리 REST API 삭제",
      "두 번째 삭제",
    ]);
  });
});

describe("the confirmation", () => {
  function open(host: HTMLElement, n = 0) {
    const del = [...host.querySelectorAll(".lh-cp-archive-del")][n] as HTMLButtonElement;
    del.click();
    return { del, dialog: host.querySelector(".lh-cp-confirm-dialog") as HTMLDialogElement };
  }

  it("deletes nothing on its own", () => {
    const onDelete = vi.fn();
    const { host } = mount({ onDelete });
    const { dialog } = open(host);
    expect(dialog.open).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("names the project in the body, and says what survives", () => {
    const { host } = mount({ onDelete: vi.fn() });
    const { dialog } = open(host);
    const body = dialog.querySelector(".lh-cp-confirm-body")!;
    expect(body.querySelector("strong")!.textContent).toBe('"도서 대출 관리 REST API"');
    expect(body.textContent).toContain("되돌릴 수 없습니다");
    expect(body.textContent).toContain("공부한 기록은 남습니다");
  });

  it("puts focus on the safe button, not the destructive one", () => {
    // Doing nothing more should be safe: an unthinking Enter must cancel.
    const { host } = mount({ onDelete: vi.fn() });
    const { dialog } = open(host);
    expect(document.activeElement).toBe(dialog.querySelector(".lh-cp-confirm-cancel"));
  });

  it("deletes the project the row belongs to, once, on confirm", () => {
    const onDelete = vi.fn();
    const { host } = mount({ onDelete });
    const { dialog } = open(host, 1);
    (dialog.querySelector(".lh-cp-confirm-delete") as HTMLButtonElement).click();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe("prj-two");
    expect(dialog.open).toBe(false);
  });

  it("does nothing on cancel and gives focus back to the row it came from", () => {
    const onDelete = vi.fn();
    const { host } = mount({ onDelete });
    const { del, dialog } = open(host);
    (dialog.querySelector(".lh-cp-confirm-cancel") as HTMLButtonElement).click();
    expect(onDelete).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(del);
  });

  it("treats Escape exactly like cancel, because it is the same close path", () => {
    // Escape is the dialog element's own behaviour; the cleanup hangs off `close` so the two
    // exits cannot drift apart.
    const onDelete = vi.fn();
    const { host } = mount({ onDelete });
    const { del, dialog } = open(host);
    dialog.close();
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(del);
  });

  it("forgets the project it was asked about after closing", () => {
    // Otherwise a later confirm could act on a row the learner is no longer looking at.
    const onDelete = vi.fn();
    const { host } = mount({ onDelete });
    const { dialog } = open(host);
    dialog.close();
    (dialog.querySelector(".lh-cp-confirm-delete") as HTMLButtonElement).click();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does not reuse conceptprob's delete-box class names", () => {
    // Those already dress the inline problem-delete box; restyling them for a modal would rebuild
    // that feature by accident in every instance shipping this stylesheet.
    const { host } = mount({ onDelete: vi.fn() });
    for (const c of ["lh-cp-del-box", "lh-cp-del-ok", "lh-cp-del-cancel", "lh-cp-del-ta"]) {
      expect(host.querySelector(`.${c}`)).toBeNull();
    }
  });
});
