// Study flow: the rules connecting a study session to stored state, kept out of both the parts
// (which only render and emit events) and the storage adapters (which only move records).
//
// Collections, all one-record-per-file behind a derived index:
//   proposals  what the operator suggests studying next; a learner starts one, never the AI
//   projects   generated projects, archived so they can be reopened offline
//   progress   one record per project holding which files have been read
//   history    one record per study session: what was read, asked and explained

import type { IndexEntry, StoragePort, StorageRecord } from "../storage/port";
import { makeRecord } from "../storage/port";

export const COLLECTIONS = {
  proposals: "proposals",
  projects: "projects",
  progress: "progress",
  history: "history",
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

export interface HistoryCounters {
  explains: number;
  questions: number;
  lens_counts: Record<string, number>;
  asked: { at: number; path: string; lines?: [number, number]; text: string }[];
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
      const historyId = makeId("hist", stamp, token());

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

      await storage.put(
        COLLECTIONS.history,
        makeRecord<HistoryCounters>(
          "history",
          historyId,
          {
            project_id: projectId,
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

      if (input.proposalId) await this.markProposalStarted(input.proposalId, projectId);
      return { projectId, historyId };
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
      event: { kind: "explain" | "ask"; lens?: string; path: string; lines?: [number, number]; question?: string },
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
        counters.asked.push({ at: now(), path: event.path, lines: event.lines, text: event.question ?? "" });
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
  };
}

export type StudyFlow = ReturnType<typeof createStudyFlow>;
