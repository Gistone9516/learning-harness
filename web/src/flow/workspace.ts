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

  // Record writes go through one chain because several of them are read-modify-write
  // (recordFileSeen, recordExchange): two overlapping cycles both read the same record and the
  // second write drops the first one's change. Clicking two files quickly is enough to do it.
  // The server's per-collection lock does not help -- it orders the writes, but both of them
  // already carry a stale read. Lost updates are silent, so nothing surfaces them later.
  let writeChain: Promise<unknown> = Promise.resolve();
  function serialize<T>(job: () => Promise<T>): Promise<T> {
    const next = writeChain.then(job, job);
    writeChain = next.catch(() => undefined);
    return next;
  }

  async function showLauncher(): Promise<void> {
    await sessionReady;                   // a project started moments ago still gets its record closed
    await writeChain;                     // and its queued writes land before the record is closed
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

  /**
   * A proposal only pre-fills the form; the learner still presses generate (FR-14).
   *
   * Precedence is proposal > tuning > kit fallback. A proposal always carries a scale (the flow
   * defaults it when reading the index), so tuning only ever supplies the stack hint here.
   */
  async function startFromProposal(proposal: Proposal): Promise<void> {
    const tuning = await flow.readTuning();
    mountStudy({
      initialInput: {
        topic: proposal.data.topic,
        scale: proposal.scale,
        seed: proposal.data.seed ?? tuning.stack_hint,
      },
      proposalId: proposal.id,
      stack: proposal.stack,
    });
  }

  /** No proposal, so the operator's tuning defaults are what pre-fills the form. */
  async function startFree(): Promise<void> {
    const tuning = await flow.readTuning();
    mountStudy({ initialInput: { scale: tuning.scale, seed: tuning.stack_hint } });
  }

  async function openArchived(project: ArchivedProject): Promise<void> {
    const record = await flow.loadArchived(project.id);
    if (!record) return;
    projectId = project.id;

    // Take over the session that already holds this codebase. Nothing is sent here: whether the
    // server still has it is unknowable without spending a call, so the check happens on the
    // learner's first question and the reseed only runs if that one actually fails.
    const session = cfg.newSession();
    if (session) session.adopt(await flow.recallSession(project.id));

    // A revisit where questions are possible is a study session too. Without its own history
    // record every exchange in this visit would be written to nothing.
    historyId = session
      ? await flow.beginSession({ projectId: project.id, topic: project.topic, stack: project.stack })
      : null;

    // Files read in THIS visit, not the accumulated total on disk. endSession stamps this number
    // as the session's files_seen, and seeding it from disk would report "15 of 10 files read".
    seenCount = 0;

    renderStudyShell();
    mountCodeproj(container.querySelector(".lh-cp-host") as HTMLElement, {
      session,                              // null on an offline instance; the AI pane hides itself
      project: record.data.project as GeneratedProject,
      onFileSeen: (path) => void onFileSeen(path),
      onExchange: (event: ExchangeEvent) => recordExchange(event),
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
          .then(async (started) => {
            projectId = started.projectId;
            historyId = started.historyId;
            // The id the codebase now lives under, so a later visit can resume instead of re-sending it.
            const sid = session?.sessionId;
            if (sid) await flow.rememberSession(started.projectId, sid);
          });
      },
      onFileSeen: (path) => void onFileSeen(path),
      onExchange: (event: ExchangeEvent) => recordExchange(event),
    });
  }

  function recordExchange(event: ExchangeEvent): void {
    void serialize(async () => {
      await sessionReady;
      if (historyId) await flow.recordExchange(historyId, event);
    });
  }

  async function onFileSeen(path: string): Promise<void> {
    await serialize(async () => {
      await sessionReady;
      if (!projectId) return;
      seenCount += 1;
      await flow.recordFileSeen(projectId, path);
    });
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
