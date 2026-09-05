// Study flow: the rules connecting a study session to stored state, kept out of both the parts
// (which only render and emit events) and the storage adapters (which only move records).
//
// Collections, all one-record-per-file behind a derived index:
//   proposals  what the operator suggests studying next; a learner starts one, never the AI
//   projects   generated projects, archived so they can be reopened offline
//   progress   one record per project holding which files have been read
//   history    one record per study session: what was read, asked and explained
//   ai-sessions one record per project: which AI session already holds its codebase
//   annotations one record per project: the explanation layer over its code, keyed by file path
//   concepts   one record per project: what its codebase teaches, written out as documents
//   traces     one record per project: predicted execution walkthroughs, keyed by entry point
//   conversations one record per day: every question and answer, kept verbatim on this machine

import type { IndexEntry, StoragePort, StorageRecord } from "../storage/port";
import { makeRecord } from "../storage/port";

export const COLLECTIONS = {
  proposals: "proposals",
  projects: "projects",
  progress: "progress",
  history: "history",
  aiSessions: "ai-sessions",
  annotations: "annotations",
  concepts: "concepts",
  traces: "traces",
  conversations: "conversations",
} as const;

export type ProposalStatus = "open" | "started" | "archived";

export interface ProposalBriefing {
  why: string;
  learning_points: string[];
  prerequisites?: string[];
}

export interface ProposalData {
  topic: string;
  seed?: string;
  briefing: ProposalBriefing;
  started_project_id?: string | null;
}

export interface Proposal {
  id: string;
  title: string;
  stack: string;
  scale: "small" | "medium" | "large";
  status: ProposalStatus;
  order: number;
  data: ProposalData;
}

export interface ArchivedProject {
  id: string;
  title: string;
  topic: string;
  stack: string;
  scale: string;
  file_count: number;
  updated_at: number;
}

/** Anything the flow stores about a project's generated content. Structural, not a kit type. */
export interface ProjectPayload {
  project: { title: string; summary: string; files: { path: string; content: string }[] };
  origin: { proposal_id: string | null; generated_at: number; model?: string };
}

/**
 * Which AI session already holds a project's codebase. The id lives here and nowhere else:
 * putting a copy in the record summary would let the launcher read it from the index and paint
 * a "resumable" badge, and that badge would lie -- whether the server still holds the session
 * is not knowable without spending a call.
 */
export interface AiSessionData {
  session_id: string;
}

/**
 * The annotation layer for one project, keyed by file path.
 *
 * Kept as one record per project rather than per file because the id would otherwise have to be
 * derived from a path, and record ids may not contain slashes, dots, uppercase or underscores.
 * A project-sized record is also what the popup needs: opening a file wants the whole set.
 */
export interface AnnotationSetData {
  files: Record<string, { status: "pending" | "ok" | "failed"; items: unknown[] }>;
}

/**
 * The concept layer for one project: what the generated codebase teaches, written out.
 *
 * Same record shape as the annotation layer and for the same reason -- one project, one record,
 * replaced whole. Unlike annotations it is written more than once per project: the documents
 * arrive one at a time in the background, and each arrival replaces the set, so a learner who
 * closes the tab mid-pass keeps everything written so far.
 */
export interface ConceptSetData {
  entries: unknown[];
}

/**
 * The debug traces for one project, keyed by entry point.
 *
 * One record per project again, for the annotation layer's reason and one more: a run is keyed by
 * a file path and a line, and neither half of that can be a record id. The key is a plain field
 * inside the payload, which has no such constraint.
 *
 * Written more than once per project, and unlike the other two layers it is written while the
 * learner is reading rather than before they arrive: a run is theirs to start, from any line, at
 * any time, including on a project reopened months later.
 */
export interface TraceSetData {
  runs: Record<string, { status: string; steps: unknown[] }>;
}

/**
 * One question and its answer, kept whole.
 *
 * This is the layer the learner's own words live in, and it never leaves the machine. Nothing
 * reads it yet -- the point of writing it now is that a summary can only ever be made from
 * records that were kept, and a day not recorded is a day that can never be looked back on.
 *
 * There is deliberately no `ok` field. By the time an exchange reaches here the transport has
 * already flattened a failed call into a Korean sentence, so the bit is gone before this layer
 * sees it. Anything that later summarises these must skip entries whose answer begins with that
 * sentence, or it will summarise "설명을 불러오지 못했습니다" as something the learner studied.
 */
export interface ConversationEntry {
  at: number;
  kind: "explain" | "ask";
  lens?: string;
  depth?: string;
  project_id: string;
  history_id: string;
  path: string;
  lines?: [number, number];
  /** How many regions were in the basket, when the question was about one. */
  scrap_count?: number;
  question: string;
  answer: string;
}

export interface ConversationDay {
  entries: ConversationEntry[];
}

/**
 * Per-entry size caps. The offline buffer is browser storage with a hard quota, and the write
 * path discards the boolean that would have reported the overflow -- so without a cap the day a
 * record grows too large is the day writing silently stops.
 */
export const CONVERSATION_MAX_QUESTION = 1000;
export const CONVERSATION_MAX_ANSWER = 4000;

/** `YYYY-MM-DD`, which is both a legal record id and sorts the same as time. */
export function conversationDayId(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The subset of `tuning.json` that actually reaches a prompt. */
export interface TuningDefaults {
  scale?: "small" | "medium" | "large";
  stack_hint?: string;
}

export interface HistoryCounters {
  explains: number;
  questions: number;
  lens_counts: Record<string, number>;
  /**
   * `depth` is optional because records written before short answers existed do not have it.
   * Without it a promotion and a fresh question are the same row, and the operator reading this
   * back cannot tell one costly call from two cheap ones.
   */
  asked: { at: number; path: string; lines?: [number, number]; text: string; depth?: string }[];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

/** Ids are generated from a caller-supplied clock and counter, so they stay sortable and testable. */
export function makeId(prefix: string, now: number, suffix: string): string {
  return `${prefix}-${now.toString(36)}-${suffix}`.toLowerCase();
}

export interface StudyFlowConfig {
  storage: StoragePort;
  now?: () => number;
  /** Short random-ish token for id uniqueness; injectable so tests get stable ids. */
  token?: () => string;
}

export function createStudyFlow(cfg: StudyFlowConfig) {
  const { storage } = cfg;
  const now = cfg.now ?? (() => Date.now());
  const token = cfg.token ?? (() => Math.random().toString(36).slice(2, 8));

  return {
    /** Open proposals, in the operator's stated order. */
    async listProposals(): Promise<Proposal[]> {
      const entries = await storage.list(COLLECTIONS.proposals);
      const proposals: Proposal[] = [];
      for (const entry of entries) {
        const record = await storage.get<ProposalData>(COLLECTIONS.proposals, entry.id);
        if (!record) continue;
        proposals.push({
          id: entry.id,
          title: str(entry.summary["title"], entry.id),
          stack: str(entry.summary["stack"]),
          scale: (str(entry.summary["scale"], "medium") as Proposal["scale"]),
          status: (str(entry.summary["status"], "open") as ProposalStatus),
          order: num(entry.summary["order"], 0),
          data: {
            topic: str(record.data?.topic),
            seed: record.data?.seed,
            briefing: record.data?.briefing ?? { why: "", learning_points: [] },
            started_project_id: record.data?.started_project_id ?? null,
          },
        });
      }
      return proposals.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    },

    async openProposals(): Promise<Proposal[]> {
      return (await this.listProposals()).filter((p) => p.status === "open");
    },

    /**
     * Archive a freshly generated project and open a session for it.
     * Called only after the learner started generation, never on its own.
     */
    async startProject(input: {
      project: ProjectPayload["project"];
      topic: string;
      stack: string;
      scale: string;
      proposalId?: string | null;
    }): Promise<{ projectId: string; historyId: string }> {
      const stamp = now();
      const projectId = makeId("prj", stamp, token());

      await storage.put(
        COLLECTIONS.projects,
        makeRecord<ProjectPayload>(
          "project",
          projectId,
          {
            title: input.project.title,
            topic: input.topic,
            stack: input.stack,
            scale: input.scale,
            file_count: input.project.files.length,
          },
          {
            project: input.project,
            origin: { proposal_id: input.proposalId ?? null, generated_at: stamp },
          },
        ),
      );

      await storage.put(
        COLLECTIONS.progress,
        makeRecord(
          "progress",
          projectId,
          { project_id: projectId, seen_count: 0, file_count: input.project.files.length, last_seen_at: stamp },
          { seen_paths: [] as string[] },
        ),
      );

      // Same stamp as the two records above: one generation produces one moment, not three.
      const historyId = await this.beginSession({
        projectId,
        topic: input.topic,
        stack: input.stack,
        at: stamp,
      });

      if (input.proposalId) await this.markProposalStarted(input.proposalId, projectId);
      return { projectId, historyId };
    },

    /**
     * Open a study session record for a project that already exists.
     *
     * Generation calls this as part of startProject; reopening an archived project calls it
     * directly. A revisit where questions are possible is a study session too, and without its
     * own record every exchange in that visit is written to nothing.
     */
    async beginSession(input: {
      projectId: string;
      topic: string;
      stack: string;
      at?: number;
    }): Promise<string> {
      const stamp = input.at ?? now();
      const historyId = makeId("hist", stamp, token());
      await storage.put(
        COLLECTIONS.history,
        makeRecord<HistoryCounters>(
          "history",
          historyId,
          {
            project_id: input.projectId,
            topic: input.topic,
            stack: input.stack,
            started_at: stamp,
            ended_at: 0,
            questions: 0,
            explains: 0,
            files_seen: 0,
          },
          { explains: 0, questions: 0, lens_counts: {}, asked: [] },
        ),
      );
      return historyId;
    },

    /**
     * Remember which AI session holds this project's codebase, so a later visit can resume it
     * instead of paying to send the whole codebase again.
     *
     * Kept out of the project record on purpose: `listArchived` sorts by `updated_at`, so writing
     * to the project record here would push an old project to the top of the archive list every
     * time its session changed.
     */
    async rememberSession(projectId: string, sessionId: string): Promise<void> {
      await storage.put(
        COLLECTIONS.aiSessions,
        makeRecord<AiSessionData>(
          "ai-session",
          projectId,
          { project_id: projectId },
          { session_id: sessionId },
        ),
      );
    },

    /**
     * The session id recorded for this project, or null when there is none. Whether the server
     * still holds that session is not knowable from here; it surfaces on the next call, which is
     * why nothing may claim in advance that a reopened project can resume.
     */
    async recallSession(projectId: string): Promise<string | null> {
      const record = await storage.get<AiSessionData>(COLLECTIONS.aiSessions, projectId);
      return record?.data?.session_id ?? null;
    },

    /**
     * The annotation layer for a project, or null when none was ever built.
     *
     * Items come back unparsed: the flow moves records, and deciding which of them survive is
     * the part's job, which is the only place that knows how long each file actually is.
     */
    async readAnnotations(projectId: string): Promise<AnnotationSetData | null> {
      const record = await storage.get<AnnotationSetData>(COLLECTIONS.annotations, projectId);
      return record?.data ?? null;
    },

    /**
     * Replace a project's annotation layer. Whole-set writes only: there is no append here, so
     * the record never grows without bound and the file stays the unit it is generated in.
     *
     * The summary carries coverage counts so an operator can see how well a project is annotated
     * from the index alone, without opening any record.
     */
    async writeAnnotations(projectId: string, set: AnnotationSetData): Promise<void> {
      const statuses = Object.values(set.files).map((f) => f.status);
      await storage.put(
        COLLECTIONS.annotations,
        makeRecord<AnnotationSetData>(
          "annotations",
          projectId,
          {
            project_id: projectId,
            files_ok: statuses.filter((v) => v === "ok").length,
            files_failed: statuses.filter((v) => v === "failed").length,
            items: Object.values(set.files).reduce((n, f) => n + f.items.length, 0),
          },
          set,
        ),
      );
    },

    async readConcepts(projectId: string): Promise<ConceptSetData | null> {
      const record = await storage.get<ConceptSetData>(COLLECTIONS.concepts, projectId);
      return record?.data ?? null;
    },

    /**
     * Replace a project's concept layer.
     *
     * Called once per document as the background pass lands them, not once at the end. The write
     * is a whole-set replace either way; what changes is that an interrupted pass leaves a usable
     * partial set on disk instead of nothing.
     */
    async writeConcepts(projectId: string, set: ConceptSetData): Promise<void> {
      const status = (e: unknown): string =>
        (e as { status?: string } | null)?.status ?? "pending";
      await storage.put(
        COLLECTIONS.concepts,
        makeRecord<ConceptSetData>(
          "concepts",
          projectId,
          {
            project_id: projectId,
            concepts: set.entries.length,
            written: set.entries.filter((e) => status(e) === "ok").length,
            failed: set.entries.filter((e) => status(e) === "failed").length,
          },
          set,
        ),
      );
    },

    async readTraces(projectId: string): Promise<TraceSetData | null> {
      const record = await storage.get<TraceSetData>(COLLECTIONS.traces, projectId);
      return record?.data ?? null;
    },

    /**
     * Replace a project's trace layer.
     *
     * Called after every leg lands, not once when a run finishes, so a learner who walks away
     * mid-run keeps the part that already arrived. Whole-set replace, like the other two layers:
     * a run is added by writing the set that contains it.
     */
    async writeTraces(projectId: string, set: TraceSetData): Promise<void> {
      const runs = Object.values(set.runs);
      await storage.put(
        COLLECTIONS.traces,
        makeRecord<TraceSetData>(
          "traces",
          projectId,
          {
            project_id: projectId,
            runs: runs.length,
            steps: runs.reduce((n, r) => n + r.steps.length, 0),
            failed: runs.filter((r) => r.status === "failed").length,
          },
          set,
        ),
      );
    },

    /**
     * Append one exchange to today's conversation record.
     *
     * A day is the file boundary, which keeps the record bounded without an append-only log and
     * makes a date directly addressable. Read-modify-write, so callers must serialise it with
     * their other record writes.
     */
    async appendConversation(entry: ConversationEntry): Promise<void> {
      const id = conversationDayId(entry.at);
      const record = await storage.get<ConversationDay>(COLLECTIONS.conversations, id);
      const entries = [
        ...(record?.data?.entries ?? []),
        {
          ...entry,
          question: entry.question.slice(0, CONVERSATION_MAX_QUESTION),
          answer: entry.answer.slice(0, CONVERSATION_MAX_ANSWER),
        },
      ];
      await storage.put(
        COLLECTIONS.conversations,
        makeRecord<ConversationDay>(
          "conversations",
          id,
          {
            date: id,
            entries: entries.length,
            questions: entries.filter((e) => e.kind === "ask").length,
            explains: entries.filter((e) => e.kind === "explain").length,
          },
          { entries },
        ),
      );
    },

    /**
     * Operator-set defaults for the generation form.
     *
     * Only the two fields that actually reach a prompt are read. `tuning.json` documents more
     * (output_lang, plan.focus, plan.note, quality_profile), but nothing consumes them, and
     * reading a field that changes nothing would suggest editing it has an effect.
     */
    async readTuning(): Promise<TuningDefaults> {
      const doc = await storage.getDoc<{ defaults?: Record<string, unknown> }>("tuning");
      const defaults = doc?.defaults ?? {};
      const scale = defaults["scale"];
      const hint = defaults["stack_hint"];
      return {
        scale: scale === "small" || scale === "medium" || scale === "large" ? scale : undefined,
        // An empty hint is the same as no hint; forwarding "" would put a stray clause in the prompt.
        stack_hint: typeof hint === "string" && hint.trim() ? hint : undefined,
      };
    },

    async markProposalStarted(proposalId: string, projectId: string): Promise<void> {
      const record = await storage.get<ProposalData>(COLLECTIONS.proposals, proposalId);
      if (!record) return;
      await storage.put(COLLECTIONS.proposals, {
        ...record,
        summary: { ...record.summary, status: "started" },
        data: { ...record.data, started_project_id: projectId },
      });
    },

    /** Read flags are per project, so this record stays bounded by the project's file count. */
    async recordFileSeen(projectId: string, path: string): Promise<void> {
      const record = await storage.get<{ seen_paths: string[] }>(COLLECTIONS.progress, projectId);
      if (!record) return;
      const seen = new Set(record.data?.seen_paths ?? []);
      if (seen.has(path)) return;
      seen.add(path);
      await storage.put(COLLECTIONS.progress, {
        ...record,
        summary: { ...record.summary, seen_count: seen.size, last_seen_at: now() },
        data: { seen_paths: [...seen] },
      });
    },

    async seenPaths(projectId: string): Promise<string[]> {
      const record = await storage.get<{ seen_paths: string[] }>(COLLECTIONS.progress, projectId);
      return record?.data?.seen_paths ?? [];
    },

    /**
     * Append one exchange to the *current session's* history record. Sessions are the file
     * boundary, so this is bounded per record rather than an ever-growing log.
     */
    async recordExchange(
      historyId: string,
      event: {
        kind: "explain" | "ask";
        lens?: string;
        path: string;
        lines?: [number, number];
        question?: string;
        depth?: string;
      },
    ): Promise<void> {
      const record = await storage.get<HistoryCounters>(COLLECTIONS.history, historyId);
      if (!record) return;
      const counters: HistoryCounters = {
        explains: record.data?.explains ?? 0,
        questions: record.data?.questions ?? 0,
        lens_counts: { ...(record.data?.lens_counts ?? {}) },
        asked: [...(record.data?.asked ?? [])],
      };

      if (event.kind === "explain") {
        counters.explains += 1;
        if (event.lens) counters.lens_counts[event.lens] = (counters.lens_counts[event.lens] ?? 0) + 1;
      } else {
        counters.questions += 1;
        counters.asked.push({
          at: now(),
          path: event.path,
          lines: event.lines,
          text: event.question ?? "",
          depth: event.depth,
        });
      }

      await storage.put(COLLECTIONS.history, {
        ...record,
        summary: { ...record.summary, explains: counters.explains, questions: counters.questions },
        data: counters,
      });
    },

    /** Stamp the reading count and close the session record. */
    async endSession(historyId: string, filesSeen: number): Promise<void> {
      const record = await storage.get<HistoryCounters>(COLLECTIONS.history, historyId);
      if (!record) return;
      await storage.put(COLLECTIONS.history, {
        ...record,
        summary: { ...record.summary, files_seen: filesSeen, ended_at: now() },
      });
    },

    /** Archived projects, newest first. Reads the index only; payloads stay on disk. */
    async listArchived(): Promise<ArchivedProject[]> {
      const entries = await storage.list(COLLECTIONS.projects);
      return entries
        .map((e: IndexEntry) => ({
          id: e.id,
          title: str(e.summary["title"], e.id),
          topic: str(e.summary["topic"]),
          stack: str(e.summary["stack"]),
          scale: str(e.summary["scale"]),
          file_count: num(e.summary["file_count"]),
          updated_at: e.updated_at,
        }))
        .sort((a, b) => b.updated_at - a.updated_at);
    },

    async loadArchived(projectId: string): Promise<StorageRecord<ProjectPayload> | null> {
      return storage.get<ProjectPayload>(COLLECTIONS.projects, projectId);
    },

    /**
     * Delete an archived project and everything that only existed to serve it.
     *
     * What goes: the project, its reading progress, the id of the AI session that held its code,
     * its annotation layer, its concept documents. Each of those is keyed by the project id, so
     * each is one lookup.
     *
     * What stays, deliberately:
     *
     * - **The study history.** A session record says the learner studied on a day, and that
     *   happened whether or not the material still exists. Throwing away the material is not the
     *   same act as throwing away the record of having worked. Its topic and stack were copied
     *   into the record when the session started, so those rows keep rendering correctly.
     * - **The conversation log.** A day is the record boundary and one day mixes projects, so
     *   there is no per-project unit to remove -- and the design treats the originals as the thing
     *   a failed summary falls back on, never as something to prune.
     *
     * A proposal that was started on this project is walked back to `open` rather than left
     * pointing at a corpse. Nothing else ever writes that status back, so without this the
     * proposal would be permanently invisible: `openProposals` only offers `open` ones.
     *
     * The project record is deleted FIRST and a failure there aborts the rest. The offline buffer
     * has no tombstone for a delete, so when the server is unreachable `remove` returns false and
     * the record survives the source of truth; carrying on would strip a live project of its notes
     * and leave it in the list.
     */
    async deleteProject(projectId: string): Promise<boolean> {
      if (!(await storage.remove(COLLECTIONS.projects, projectId))) return false;

      for (const collection of [
        COLLECTIONS.progress,
        COLLECTIONS.aiSessions,
        COLLECTIONS.annotations,
        COLLECTIONS.concepts,
        COLLECTIONS.traces,
      ]) {
        await storage.remove(collection, projectId);
      }

      // Index summaries only -- the payloads are never opened to find this.
      for (const entry of await storage.list(COLLECTIONS.proposals)) {
        if (str(entry.summary["status"]) !== "started") continue;
        const record = await storage.get<ProposalData>(COLLECTIONS.proposals, entry.id);
        if (record?.data?.started_project_id !== projectId) continue;
        await storage.put(COLLECTIONS.proposals, {
          ...record,
          summary: { ...record.summary, status: "open" },
          data: { ...record.data, started_project_id: null },
        });
      }
      return true;
    },
  };
}

export type StudyFlow = ReturnType<typeof createStudyFlow>;
