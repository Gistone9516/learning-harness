// Launcher view: what a learner sees before a project is open. A way to load a repository, and
// what has already been loaded and archived.
//
// Nothing here loads or annotates anything on its own: every path out of this screen is an
// explicit click, and loading itself waits for the form's own button.

import type { ArchivedProject } from "../../src/flow/study";
import { el } from "./view";

export interface LauncherHandlers {
  /**
   * Open the load form. Absent means the launcher offers no load at all -- an instance with no
   * ai_server cannot read a repository, and must not be given a control that looks like it can.
   */
  onLoadRepo?(): void;
  onOpenArchived(project: ArchivedProject): void;
  /**
   * Delete an archived project, already confirmed. Absent means the launcher offers no delete at
   * all -- a consumer that cannot delete must not be given a control that looks like it can.
   */
  onDeleteArchived?(project: ArchivedProject): void;
}

export interface LauncherData {
  archived: ArchivedProject[];
  offline?: boolean;
}

export function renderLauncher(
  container: HTMLElement,
  data: LauncherData,
  handlers: LauncherHandlers,
): void {
  container.innerHTML = "";
  const root = el("div", "lh-cp-launcher");

  if (data.offline) {
    root.appendChild(
      el("div", "lh-cp-notice", "상태 서버에 연결할 수 없습니다. 보관된 프로젝트 읽기와 진도 기록은 계속 동작합니다."),
    );
  }

  // ── load ──
  if (handlers.onLoadRepo) {
    const load = el("section", "lh-cp-launcher-section lh-cp-launcher-load");
    const loadBtn = el("button", "lh-cp-launcher-load-btn", "저장소 불러오기");
    loadBtn.type = "button";
    loadBtn.addEventListener("click", () => handlers.onLoadRepo?.());
    load.appendChild(loadBtn);
    root.appendChild(load);
  }

  // ── archive ──
  const confirm = createConfirmDialog((project) => handlers.onDeleteArchived?.(project));

  const archive = el("section", "lh-cp-launcher-section");
  archive.appendChild(el("h2", "lh-cp-launcher-title", "보관된 프로젝트"));
  if (data.archived.length === 0) {
    archive.appendChild(el("p", "lh-cp-launcher-empty", "아직 불러온 저장소가 없습니다."));
  } else {
    const list = el("ul", "lh-cp-archive-list");
    for (const project of data.archived) {
      const li = el("li", "lh-cp-archive-item");
      const btn = el("button", "lh-cp-archive-btn");
      btn.dataset["projectId"] = project.id;
      btn.appendChild(el("span", "lh-cp-archive-title", project.title));
      const meta = [project.stack, `${project.file_count}개 파일`].filter(Boolean).join(" · ");
      btn.appendChild(el("span", "lh-cp-archive-meta", meta));
      btn.addEventListener("click", () => handlers.onOpenArchived(project));
      li.appendChild(btn);
      // A sibling, never a child: an interactive element inside a button is invalid, and a click
      // would have two owners. The scrap list next door already has this shape.
      if (handlers.onDeleteArchived) li.appendChild(deleteButton(project));
      list.appendChild(li);
    }
    archive.appendChild(list);
  }
  root.appendChild(archive);

  container.appendChild(root);
  if (handlers.onDeleteArchived) container.appendChild(confirm.root);

  /**
   * The row's delete control. Hidden until the row is hovered or holds focus: this is the first
   * screen, the action is rare and irreversible, and a permanent row of destructive icons is the
   * opposite of a quiet reference list.
   *
   * `pointer-events` is gated on the same rule as `opacity` in the stylesheet, so while it is
   * invisible it cannot be clicked -- an invisible-but-live button sitting over the meta text
   * would swallow clicks meant for the project.
   */
  function deleteButton(project: ArchivedProject): HTMLElement {
    const del = el("button", "lh-cp-archive-del");
    del.type = "button";
    // Named with the project, not just "삭제": several rows are on screen and a screen reader
    // reading "삭제" five times says nothing about which one.
    del.setAttribute("aria-label", `${project.title} 삭제`);
    del.title = `${project.title} 삭제`;
    del.innerHTML = TRASH_ICON;
    del.addEventListener("click", () => confirm.open(project, del));
    return del;
  }
}

/** Stroke-only, currentColor, matching the theme toggle: 원칙 §7 rules out emoji glyphs. */
const TRASH_ICON =
  '<svg class="lh-cp-archive-del-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M4 7h16" /><path d="M9 7V4h6v3" />' +
  '<path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />' +
  '<path d="M10 11v6M14 11v6" /></svg>';

interface ConfirmDialog {
  root: HTMLDialogElement;
  open(project: ArchivedProject, returnTo: HTMLElement): void;
}

/**
 * The confirmation, as a native `<dialog>` opened with `showModal()`.
 *
 * Native rather than hand-rolled because the two things a modal must get right -- trapping focus
 * and closing on Escape -- come free and correct, and nothing in this kit has ever done either, so
 * a hand-rolled version would be the first attempt at a problem with well-known sharp edges.
 *
 * One dialog for the whole list, not one per row: its text is set when it opens.
 */
function createConfirmDialog(onDelete: (project: ArchivedProject) => void): ConfirmDialog {
  const root = document.createElement("dialog");
  root.className = "lh-cp-confirm-dialog";
  const title = el("h2", "lh-cp-confirm-title", "프로젝트를 삭제하시겠습니까?");
  const body = el("p", "lh-cp-confirm-body");
  const actions = el("div", "lh-cp-confirm-actions");
  const del = el("button", "lh-cp-confirm-delete", "삭제");
  const cancel = el("button", "lh-cp-confirm-cancel", "취소");
  del.type = "button";
  cancel.type = "button";
  actions.appendChild(del);
  actions.appendChild(cancel);
  root.appendChild(title);
  root.appendChild(body);
  root.appendChild(actions);

  let pending: ArchivedProject | null = null;
  let returnTo: HTMLElement | null = null;

  cancel.addEventListener("click", () => root.close());
  del.addEventListener("click", () => {
    const project = pending;
    root.close();
    if (project) onDelete(project);
  });
  // Escape closes by itself; this is the one place to put back what was focused, so the two exits
  // cannot drift apart.
  root.addEventListener("close", () => {
    pending = null;
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
  });

  return {
    root,
    open(project, from) {
      pending = project;
      returnTo = from;
      body.innerHTML = "";
      // The name goes in with 의, which does not alternate on the final consonant the way 을/를
      // does -- the title is AI-written and may end in Hangul or in "API".
      const name = el("strong", "", `"${project.title}"`);
      body.appendChild(name);
      body.appendChild(
        document.createTextNode("의 설명과 개념 문서가 모두 삭제되고 되돌릴 수 없습니다. 그동안 공부한 기록은 남습니다."),
      );
      root.showModal();
      // The safe one takes focus: for something irreversible, doing nothing more should be safe.
      cancel.focus();
    },
  };
}
