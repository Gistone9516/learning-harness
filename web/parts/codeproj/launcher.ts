// Launcher view: what a learner sees before a project is open. Two lists side by side — what the
// operator proposes studying next, and what has already been generated and archived.
//
// Nothing here starts generation on its own: every path out of this screen is an explicit click,
// which is the whole point of the propose-then-start rule.

import type { ArchivedProject, Proposal } from "../../src/flow/study";
import { el } from "./view";

export interface LauncherHandlers {
  onStartProposal(proposal: Proposal): void;
  onOpenArchived(project: ArchivedProject): void;
  onFreeStart(): void;
}

export interface LauncherData {
  proposals: Proposal[];
  archived: ArchivedProject[];
  offline?: boolean;
}

function proposalCard(proposal: Proposal, onStart: () => void): HTMLElement {
  const card = el("article", "lh-cp-proposal");
  card.appendChild(el("h3", "lh-cp-proposal-title", proposal.title));

  const meta = el("div", "lh-cp-proposal-meta");
  if (proposal.stack) meta.appendChild(el("span", "lh-cp-chip", proposal.stack));
  meta.appendChild(el("span", "lh-cp-chip", scaleLabel(proposal.scale)));
  card.appendChild(meta);

  if (proposal.data.briefing.why) {
    card.appendChild(el("p", "lh-cp-proposal-why", proposal.data.briefing.why));
  }

  const points = proposal.data.briefing.learning_points ?? [];
  if (points.length) {
    const ul = el("ul", "lh-cp-proposal-points");
    for (const point of points) ul.appendChild(el("li", "", point));
    card.appendChild(ul);
  }

  const prereqs = proposal.data.briefing.prerequisites ?? [];
  if (prereqs.length) {
    card.appendChild(el("p", "lh-cp-proposal-prereq", `선행: ${prereqs.join(", ")}`));
  }

  const startBtn = el("button", "lh-cp-start-btn", "이 주제로 시작");
  startBtn.addEventListener("click", onStart);
  card.appendChild(startBtn);
  return card;
}

function scaleLabel(scale: string): string {
  return { small: "소규모", medium: "중규모", large: "대규모" }[scale] ?? scale;
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

  // ── proposals ──
  const proposals = el("section", "lh-cp-launcher-section");
  const head = el("div", "lh-cp-launcher-head");
  head.appendChild(el("h2", "lh-cp-launcher-title", "추천 학습 주제"));
  // States the propose-then-start rule where the learner meets it, so nothing looks auto-started.
  head.appendChild(el("span", "lh-cp-launcher-note", "AI가 지난 이력을 보고 제안 · 시작은 직접 누를 때만"));
  proposals.appendChild(head);
  if (data.proposals.length === 0) {
    proposals.appendChild(
      el("p", "lh-cp-launcher-empty", "대기 중인 추천이 없습니다. 아래에서 직접 주제를 정해 시작할 수 있습니다."),
    );
  } else {
    const list = el("div", "lh-cp-proposal-list");
    for (const proposal of data.proposals) {
      list.appendChild(proposalCard(proposal, () => handlers.onStartProposal(proposal)));
    }
    proposals.appendChild(list);
  }
  const freeBtn = el("button", "lh-cp-free-start", "직접 주제 정하기");
  freeBtn.addEventListener("click", () => handlers.onFreeStart());
  proposals.appendChild(freeBtn);
  root.appendChild(proposals);

  // ── archive ──
  const archive = el("section", "lh-cp-launcher-section");
  archive.appendChild(el("h2", "lh-cp-launcher-title", "보관된 프로젝트"));
  if (data.archived.length === 0) {
    archive.appendChild(el("p", "lh-cp-launcher-empty", "아직 생성한 프로젝트가 없습니다."));
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
      list.appendChild(li);
    }
    archive.appendChild(list);
  }
  root.appendChild(archive);

  container.appendChild(root);
}
