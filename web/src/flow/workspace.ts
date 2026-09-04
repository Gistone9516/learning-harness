// Workspace: drives one learner through launcher -> study -> back, wiring the codeproj part to the
// study flow. The part stays presentational (it renders and emits), the flow stays persistence-only
// (it moves records), and the sequencing lives here.

import { mountCodeproj, type ExchangeEvent, type GeneratedProject } from "../../parts/codeproj/codeproj";
import type { CodeprojHandle, CodeprojView, ConceptSet } from "../../parts/codeproj/codeproj";
import type { AnnotationSet } from "../../parts/codeproj/annotations";
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

  // Which visit is on screen. The annotation pass runs for minutes and the topbar's [목록으로]
  // stays live throughout, so a part can still be emitting long after the learner walked away.
  // Progress from an abandoned visit must not be recorded, and its writes must never land on
  // whatever project happens to be current by then.
  let visit = 0;
  let historyId: string | null = null;
  let seenCount = 0;
  // Chrome the flow owns: the tab strip and which view it currently shows.
  let tabs: HTMLElement | null = null;
  let activeView: CodeprojView = "code";

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
    visit += 1;                           // everything the previous mount still emits is now stale
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
        onDeleteArchived: (project) => void removeArchived(project),
      },
    );
  }

  /**
   * Delete a project the learner has already confirmed, then redraw the launcher.
   *
   * The redraw is a full `showLauncher`, not a spliced-out row: a delete also reopens whichever
   * proposal had been started on that project, and that list is on the same screen.
   *
   * A failure is reported rather than swallowed. The offline buffer has no tombstone for a delete,
   * so with the server unreachable the record outlives the call and would simply reappear -- a row
   * that silently comes back is worse than being told it did not go.
   */
  async function removeArchived(project: ArchivedProject): Promise<void> {
    const done = await serialize(() => flow.deleteProject(project.id));
    if (!done) {
      window.alert("삭제하지 못했습니다. 기록 서버에 연결되어 있는지 확인해 주세요.");
      return;
    }
    await showLauncher();
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
    const mine = ++visit;
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

    // The explanation layer is a plain read: it works with no session at all, which is why the
    // popup keeps working on an instance that has no ai_server.
    const annotations = (await flow.readAnnotations(project.id)) as AnnotationSet | null;
    // Same plain read, same reason: the concepts written for this project belong to it, and
    // reopening one must not spend a call to see them again.
    const concepts = (await flow.readConcepts(project.id)) as ConceptSet | null;

    renderStudyShell();
    activeView = "code";
    const handle = mountCodeproj(container.querySelector(".lh-cp-host") as HTMLElement, {
      session,                              // null on an offline instance; the AI pane hides itself
      project: record.data.project as GeneratedProject,
      annotations: annotations ?? undefined,
      concepts: concepts ?? undefined,
      onFileSeen: (path) => void onFileSeen(mine, path),
      onExchange: (event: ExchangeEvent) => recordExchange(mine, event),
      onConcepts: (set) => writeConceptSet(project.id, set),
      onConceptProgress: (done, total) => renderTabs(handle, done, total),
    });
    const n = concepts?.entries.length ?? 0;
    renderTabs(handle, concepts?.entries.filter((e: { status: string }) => e.status === "ok").length ?? 0, n);
  }

  /**
   * Store the concept layer. Not gated on the visit still being current, for the same reason the
   * annotation write is not: these documents were paid for and belong to the project they describe.
   */
  function writeConceptSet(id: string, set: ConceptSet): void {
    void serialize(async () => {
      await sessionReady;
      await flow.writeConcepts(id, set);
    });
  }

  function mountStudy(opts: {
    initialInput?: { topic?: string; scale?: "small" | "medium" | "large"; seed?: string };
    proposalId?: string;
    stack?: string;
  }): void {
    const session = cfg.newSession();
    const mine = ++visit;
    // Captured for this visit alone. The annotation pass finishes minutes later, and by then the
    // shared projectId may belong to a different project entirely.
    let myProjectId: string | null = null;
    renderStudyShell();

    const handle: CodeprojHandle = mountCodeproj(container.querySelector(".lh-cp-host") as HTMLElement, {
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
            myProjectId = started.projectId;
            projectId = started.projectId;
            historyId = started.historyId;
            // The id the codebase now lives under, so a later visit can resume instead of re-sending it.
            const sid = session?.sessionId;
            if (sid) await flow.rememberSession(started.projectId, sid);
          });
      },
      onFileSeen: (path) => void onFileSeen(mine, path),
      onExchange: (event: ExchangeEvent) => recordExchange(mine, event),
      onAnnotations: (set) => {
        // Deliberately NOT gated on the visit still being current. The learner may have walked
        // away, but these annotations were paid for and belong to the project they describe --
        // throwing them out would waste minutes of calls and leave that project blank forever.
        // They go to the captured id, never the shared one.
        void serialize(async () => {
          await sessionReady;
          if (myProjectId) await flow.writeAnnotations(myProjectId, set);
        });
      },
      onConcepts: (set) => {
        // Same rule as the annotations above, and it matters more here: this pass runs while the
        // learner is on the screen, so "they walked away mid-pass" is the ordinary case.
        void serialize(async () => {
          await sessionReady;
          if (myProjectId) await flow.writeConcepts(myProjectId, set);
        });
      },
      onConceptProgress: (done, total) => renderTabs(handle, done, total),
    });
  }

  function recordExchange(mine: number, event: ExchangeEvent): void {
    void serialize(async () => {
      await sessionReady;
      if (mine !== visit || !historyId || !projectId) return;
      // Two records, one exchange: the session's counters, and the words themselves. The counters
      // answer "how much studying happened"; only the transcript can answer "what about".
      await flow.recordExchange(historyId, event);
      await flow.appendConversation({
        at: Date.now(),
        kind: event.kind,
        lens: event.lens,
        depth: event.depth,
        project_id: projectId,
        history_id: historyId,
        path: event.path,
        lines: event.lines,
        scrap_count: event.scrapCount,
        question: event.question ?? "",
        answer: event.answer,
      });
    });
  }

  async function onFileSeen(mine: number, path: string): Promise<void> {
    await serialize(async () => {
      await sessionReady;
      // A part the learner has left still opens its first file when its project finally loads.
      // That is not reading, and counting it would inflate a session the learner never had.
      if (mine !== visit || !projectId) return;
      seenCount += 1;
      await flow.recordFileSeen(projectId, path);
    });
  }

  /**
   * The study shell: a top bar the flow owns, and a host the part mounts into.
   *
   * The tab strip goes in this bar rather than inside the part because the bar is already there
   * and holds one small button -- the collapsed view costs no vertical space at all, and this
   * screen's height is rationed enough that a new row would be the most expensive thing on it.
   * The part is driven through the handle it returns; the flow never reaches into its DOM.
   */
  function renderStudyShell(): void {
    container.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "lh-cp-topbar";
    const back = document.createElement("button");
    back.className = "lh-cp-back";
    back.textContent = "목록으로";
    back.addEventListener("click", () => void showLauncher());
    bar.appendChild(back);
    tabs = document.createElement("div");
    tabs.className = "cg-cp-tabs";
    tabs.hidden = true;
    bar.appendChild(tabs);
    const host = document.createElement("div");
    host.className = "lh-cp-host";
    container.appendChild(bar);
    container.appendChild(host);
  }

  /**
   * Draw the code/concept tabs, or nothing at all when there are no concepts to read.
   *
   * A tab onto an empty page is worse than no tab: it says there is something there. So the strip
   * stays hidden until the outline lands, and on an archived project with no stored concepts it
   * never appears.
   */
  function renderTabs(handle: CodeprojHandle, done: number, total: number): void {
    if (!tabs) return;
    if (!total) {
      tabs.hidden = true;
      return;
    }
    tabs.hidden = false;
    tabs.innerHTML = "";
    for (const [id, label] of [["code", "코드"], ["concepts", "개념"]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cg-cp-tab";
      b.setAttribute("aria-selected", String(id === activeView));
      b.textContent = label;
      if (id === "concepts" && done < total) {
        // The same count track the file panel uses. A real 0/8 is shown, not hidden.
        const n = document.createElement("span");
        n.className = "lh-cp-progress";
        n.textContent = `${done}/${total}`;
        b.appendChild(n);
      }
      b.addEventListener("click", () => {
        activeView = id;
        handle.setView(id);
        renderTabs(handle, done, total);
      });
      tabs.appendChild(b);
    }
  }

  return { showLauncher };
}
