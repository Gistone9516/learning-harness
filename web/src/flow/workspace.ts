// Workspace: drives one learner through launcher -> study -> back, wiring the codeproj part to the
// study flow. The part stays presentational (it renders and emits), the flow stays persistence-only
// (it moves records), and the sequencing lives here.

import { mountCodeproj, type ExchangeEvent, type GeneratedProject } from "../../parts/codeproj/codeproj";
import { renderLauncher } from "../../parts/codeproj/launcher";
import type { AiSession } from "../ai/client";
import type { ArchivedProject, Proposal, StudyFlow } from "./study";

export interface WorkspaceConfig {
  container: HTMLElement;
  flow: StudyFlow;
  /** Live session factory; a fresh session per generated project (load-once then resume). */
  newSession: () => AiSession | null;
}

export function createWorkspace(cfg: WorkspaceConfig) {
  const { container, flow } = cfg;

  // Session-scoped ids: set when a project is started or reopened, cleared back at the launcher.
  let projectId: string | null = null;
  let historyId: string | null = null;
  let seenCount = 0;

  // The part emits its first events (the opening file, an early explain) synchronously as soon as
  // a project loads, while archiving it is still in flight. Handlers await this gate so those
  // events attach to the right records instead of being dropped for arriving too early.
  let sessionReady: Promise<void> = Promise.resolve();

  async function showLauncher(): Promise<void> {
    await sessionReady;                   // a project started moments ago still gets its record closed
    if (historyId) {
      await flow.endSession(historyId, seenCount);
      historyId = null;
    }
    sessionReady = Promise.resolve();
    projectId = null;
    seenCount = 0;

    const [proposals, archived] = await Promise.all([flow.openProposals(), flow.listArchived()]);
    renderLauncher(
      container,
      { proposals, archived },
      {
        onStartProposal: (proposal) => void startFromProposal(proposal),
        onOpenArchived: (project) => void openArchived(project),
        onFreeStart: () => void startFree(),
      },
    );
  }

  /** A proposal only pre-fills the form; the learner still presses generate (FR-14). */
  async function startFromProposal(proposal: Proposal): Promise<void> {
    mountStudy({
      initialInput: { topic: proposal.data.topic, scale: proposal.scale, seed: proposal.data.seed },
      proposalId: proposal.id,
      stack: proposal.stack,
    });
  }

  async function startFree(): Promise<void> {
    mountStudy({});
  }

  async function openArchived(project: ArchivedProject): Promise<void> {
    const record = await flow.loadArchived(project.id);
    if (!record) return;
    projectId = project.id;
    historyId = null;                       // reopening is reading only; no new AI session yet
    const seen = await flow.seenPaths(project.id);
    seenCount = seen.length;

    renderStudyShell();
    mountCodeproj(container.querySelector(".lh-cp-host") as HTMLElement, {
      session: null,                        // offline reading; the AI pane hides itself
      project: record.data.project as GeneratedProject,
      onFileSeen: (path) => void onFileSeen(path),
    });
  }

  function mountStudy(opts: {
    initialInput?: { topic?: string; scale?: "small" | "medium" | "large"; seed?: string };
    proposalId?: string;
    stack?: string;
  }): void {
    const session = cfg.newSession();
    renderStudyShell();

    mountCodeproj(container.querySelector(".lh-cp-host") as HTMLElement, {
      session,
      initialInput: opts.initialInput,
      onProjectGenerated: (project, input) => {
        sessionReady = flow
          .startProject({
            project,
            topic: input.topic,
            stack: opts.stack ?? input.seed ?? "",
            scale: input.scale,
            proposalId: opts.proposalId ?? null,
          })
          .then((started) => {
            projectId = started.projectId;
            historyId = started.historyId;
          });
      },
      onFileSeen: (path) => void onFileSeen(path),
      onExchange: (event: ExchangeEvent) => {
        void (async () => {
          await sessionReady;
          if (historyId) await flow.recordExchange(historyId, event);
        })();
      },
    });
  }

  async function onFileSeen(path: string): Promise<void> {
    await sessionReady;
    if (!projectId) return;
    seenCount += 1;
    await flow.recordFileSeen(projectId, path);
  }

  function renderStudyShell(): void {
    container.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "lh-cp-topbar";
    const back = document.createElement("button");
    back.className = "lh-cp-back";
    back.textContent = "목록으로";
    back.addEventListener("click", () => void showLauncher());
    bar.appendChild(back);
    const host = document.createElement("div");
    host.className = "lh-cp-host";
    container.appendChild(bar);
    container.appendChild(host);
  }

  return { showLauncher };
}
