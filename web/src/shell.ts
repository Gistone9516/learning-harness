// Generic app shell (web-contract.md §1). Mounts the part named by an injected AppConfig. Carries no
// subject or instance literal: the part id, its data, and AI config all come from the consuming
// instance (or a dev fixture). This is the only place that knows the full part roster.
import { mountSheet, type SheetProblem } from "../parts/sheet/sheet";
import { mountCodeproj } from "../parts/codeproj/codeproj";
import { mountConceptprob } from "../parts/conceptprob/conceptprob";
import { mountDashboard } from "../parts/dashboard/dashboard";
import { createAiClient, AiSession, type AiClientConfig } from "./ai/client";
import { createApiStorage } from "./storage/api";
import { createLocalStorage } from "./storage/local";
import { createBufferedStorage } from "./storage/buffered";
import type { StoragePort } from "./storage/port";
import { createStudyFlow } from "./flow/study";
import { createWorkspace } from "./flow/workspace";

export type PartId = "sheet" | "codeproj" | "conceptprob" | "dashboard";

/** State layer for instances whose records must also be readable outside the browser. */
export interface StateConfig {
  baseUrl: string;          // state API origin (same server as ai_server)
  token: string;            // AI_SERVER_TOKEN, obtained out-of-band; never bundled
  namespace: string;        // localStorage namespace for the offline buffer
}

export interface AppConfig {
  part: PartId;
  data?: unknown;           // part-specific injected data (problem / project / {areas, conceptOutline, concepts?})
  ai?: AiClientConfig;      // optional: AI parts also run from pre-baked injected content with no ai_server
  state?: StateConfig;      // optional: enables the archive/history workspace
}

/**
 * Source of truth is the state API; localStorage is the offline buffer in front of it. With no
 * state config an instance keeps working browser-only.
 */
function buildStorage(state: StateConfig): StoragePort {
  const primary = createApiStorage({ baseUrl: state.baseUrl, token: state.token });
  const buffer = createLocalStorage({ namespace: state.namespace });
  return createBufferedStorage({ primary, buffer });
}

export function mountApp(container: HTMLElement, config: AppConfig): void {
  if (config.part === "sheet") {
    mountSheet(container, config.data as SheetProblem);
    return;
  }

  if (config.part === "dashboard") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    void mountDashboard(container, { storage: buildStorage(config.state) });
    return;
  }

  // AI is optional: a part can run from pre-baked injected content with no ai_server (token 0,
  // offline). The client/session are built only when ai is configured; null otherwise.
  const client = config.ai ? createAiClient(config.ai) : null;
  const session = client ? new AiSession(client) : null;
  const data = (config.data ?? {}) as Record<string, unknown>;

  if (config.part === "codeproj") {
    // The server reads repositories, so loading one needs the same client the AI calls use.
    const loadRepo = client ? client.repos : undefined;

    // With a state layer the part runs inside the workspace (archive, history); without one it is
    // the plain single-project view.
    if (config.state) {
      const flow = createStudyFlow({ storage: buildStorage(config.state) });
      const workspace = createWorkspace({
        container,
        flow,
        // A fresh session per project: loading puts the codebase in once, then follow-ups resume.
        newSession: () => (client ? new AiSession(client) : null),
        loadRepo,
      });
      void workspace.showLauncher();
      return;
    }

    const project = data.project as never;
    if (!session && !project) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 미리 준비된 프로젝트가 필요합니다.";
      return;
    }
    mountCodeproj(container, { session, project, loadRepo });
  } else if (config.part === "conceptprob") {
    const concepts = data.concepts as Record<string, unknown> | undefined;
    const hasPrebaked = !!concepts && Object.keys(concepts).length > 0;
    if (!session && !hasPrebaked) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 사전 생성 개념이 필요합니다.";
      return;
    }
    mountConceptprob(container, {
      session,
      aiClient: client,
      areas: (data.areas as never) ?? [],
      conceptOutline: (data.conceptOutline as never) ?? {},
      concepts: concepts as never,
      subjectKey: data.subjectKey as string | undefined,
      courseTitle: data.courseTitle as string | undefined,
    });
  } else {
    container.textContent = "unknown part";
  }
}
