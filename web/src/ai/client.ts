// ai_server browser client (web-contract.md §2). The web reaches the claude subscription only through
// bot/ai_server.py. This wraps POST /ai (token-gated) and GET /health, plus an AiSession that implements
// the load-once -> resume lifecycle (load heavy content once, then resume for small follow-ups).
// The token comes from runtime config (never embedded in the bundle). fetch is injectable for tests.

/** Effort levels the CLI accepts (`--effort`). Callers pick per call kind. */
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiRequest {
  prompt: string;
  system?: string;
  model?: string;
  effort?: AiEffort;
  session_id?: string | null;
}

export interface AiResponse {
  ok: boolean;
  text: string;
  session_id: string | null;
  error: string | null;
  /**
   * "resume_missing" when the server was asked to resume a session it no longer holds.
   * Optional on purpose: the HTTP-failure and fetch-exception paths build a response without
   * it, so a caller that tests for the one value it acts on stays correct on every path.
   */
  error_kind?: string | null;
}

export interface AiClientConfig {
  baseUrl: string;          // e.g. http://localhost:8765 or a tunnel URL
  token: string;            // AI_SERVER_TOKEN, obtained out-of-band; never bundled
  model?: string;           // default model for this client (e.g. claude-opus-5[1m])
  fetchImpl?: typeof fetch; // injectable for tests
}

// On-demand practice-problem generation (server generates + execution-verifies; see bot/probgen.py).
export interface GenProblemsRequest {
  concept: { area?: string; concept_id: string; title: string; body: string };
  existing?: string[];   // prompts of problems already shown (dedup guard)
  feedback?: string[];   // past deletion reasons for this concept
  count?: number;
  course_title?: string;
  model?: string;
}
export interface GenProblemsResponse {
  ok: boolean;
  problems: unknown[];    // raw ProblemDef-shaped objects (verified server-side)
  error: string | null;
  dropped?: number;
}

/**
 * Read a git repository into text (bot/repo_loader.py). The browser can neither clone nor read a
 * disk, and the model runs with tools off, so the server does the reading and hands back files.
 */
export interface RepoLoadRequest {
  /** A remote URL (https, ssh, git@, file://) or a folder path on the server's machine. */
  source: string;
  ref?: string | null;
  /** Paths or globs to keep; empty keeps everything that survives the default filters. */
  include?: string[];
}

/**
 * Why a repository could not be read. `call` is added on this side for a request that never got
 * an answer; every other reason is the server's own.
 */
export type RepoLoadFailure = "source" | "clone" | "path" | "too_large" | "empty" | "call";

export type RepoLoadResponse =
  | {
      ok: true;
      title: string;
      source: string;
      ref: string | null;
      commit: string | null;
      files: { path: string; content: string }[];
      skipped: Record<string, number>;
      total_bytes: number;
    }
  | {
      ok: false;
      reason: RepoLoadFailure;
      error: string;
      /** Only on `too_large`: where the bulk is, so the learner can narrow the scope to part of it. */
      found?: { files: number; bytes: number };
      limits?: { files: number; bytes: number };
      dirs?: { dir: string; files: number; bytes: number }[];
    };

export interface AiClient {
  ai(req: AiRequest): Promise<AiResponse>;
  problems(req: GenProblemsRequest): Promise<GenProblemsResponse>;
  repos(req: RepoLoadRequest): Promise<RepoLoadResponse>;
  health(): Promise<boolean>;
}

export function createAiClient(cfg: AiClientConfig): AiClient {
  const f: typeof fetch = cfg.fetchImpl ?? globalThis.fetch;

  async function ai(req: AiRequest): Promise<AiResponse> {
    const body = JSON.stringify({
      model: cfg.model,
      effort: "medium",
      ...req, // caller fields win (prompt, system, session_id, explicit model/effort)
    });
    try {
      const res = await f(`${cfg.baseUrl}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": cfg.token },
        body,
      });
      if (!res.ok) {
        return { ok: false, text: "", session_id: req.session_id ?? null, error: `HTTP ${res.status}` };
      }
      return (await res.json()) as AiResponse;
    } catch (e) {
      return { ok: false, text: "", session_id: req.session_id ?? null, error: String((e as Error)?.message ?? e) };
    }
  }

  async function problems(req: GenProblemsRequest): Promise<GenProblemsResponse> {
    const body = JSON.stringify({ model: cfg.model, ...req });
    try {
      const res = await f(`${cfg.baseUrl}/problems`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": cfg.token },
        body,
      });
      if (!res.ok) return { ok: false, problems: [], error: `HTTP ${res.status}` };
      return (await res.json()) as GenProblemsResponse;
    } catch (e) {
      return { ok: false, problems: [], error: String((e as Error)?.message ?? e) };
    }
  }

  async function repos(req: RepoLoadRequest): Promise<RepoLoadResponse> {
    try {
      const res = await f(`${cfg.baseUrl}/repos/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": cfg.token },
        body: JSON.stringify(req),
      });
      if (!res.ok) return { ok: false, reason: "call", error: `HTTP ${res.status}` };
      return (await res.json()) as RepoLoadResponse;
    } catch (e) {
      return { ok: false, reason: "call", error: String((e as Error)?.message ?? e) };
    }
  }

  async function health(): Promise<boolean> {
    try {
      const res = await f(`${cfg.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  return { ai, problems, repos, health };
}

// Load-once then resume. The first send mints a session (server returns session_id); later sends resume
// it, so heavy context (a codebase / concept) is sent only once. Volatile, per artifact view.
export class AiSession {
  private sid: string | null = null;
  constructor(private readonly client: AiClient) {}

  async send(req: Omit<AiRequest, "session_id">): Promise<AiResponse> {
    const res = await this.client.ai({ ...req, session_id: this.sid });
    if (res.ok && res.session_id) this.sid = res.session_id;
    return res;
  }

  /**
   * Take over a session minted by an earlier visit (a project reopened from the record store).
   * The session may already be gone server-side; that surfaces on the next send rather than
   * here, because probing it would cost a call on the path that is supposed to be free.
   */
  adopt(sid: string | null): void {
    this.sid = sid;
  }

  get sessionId(): string | null {
    return this.sid;
  }

  reset(): void {
    this.sid = null;
  }
}
