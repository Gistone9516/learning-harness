// Generic app shell (web-contract.md §1). Mounts the part named by an injected AppConfig. Carries no
// subject or instance literal: the part id, its data, and AI config all come from the consuming
// instance (or a dev fixture). This is the only place that knows the full part roster.
import { mountSheet, type SheetProblem } from "../parts/sheet/sheet";
import { mountCodeproj } from "../parts/codeproj/codeproj";
import { mountConceptprob } from "../parts/conceptprob/conceptprob";
import { createAiClient, AiSession, type AiClientConfig } from "./ai/client";

export type PartId = "sheet" | "codeproj" | "conceptprob";

export interface AppConfig {
  part: PartId;
  data: unknown;            // part-specific injected data (problem / project / {areas, conceptOutline, concepts?})
  ai?: AiClientConfig;      // optional: AI parts also run from pre-baked injected content with no ai_server
}

export function mountApp(container: HTMLElement, config: AppConfig): void {
  if (config.part === "sheet") {
    mountSheet(container, config.data as SheetProblem);
    return;
  }

  // AI is optional: a part can run from pre-baked injected content with no ai_server (token 0, offline).
  // The session is built only when ai is configured; null otherwise.
  const session = config.ai ? new AiSession(createAiClient(config.ai)) : null;
  const data = (config.data ?? {}) as Record<string, unknown>;

  if (config.part === "codeproj") {
    const project = data.project as never;
    if (!session && !project) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 사전 생성 프로젝트가 필요합니다.";
      return;
    }
    mountCodeproj(container, { session, project });
  } else if (config.part === "conceptprob") {
    const concepts = data.concepts as Record<string, unknown> | undefined;
    const hasPrebaked = !!concepts && Object.keys(concepts).length > 0;
    if (!session && !hasPrebaked) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 사전 생성 개념이 필요합니다.";
      return;
    }
    mountConceptprob(container, {
      session,
      areas: (data.areas as never) ?? [],
      conceptOutline: (data.conceptOutline as never) ?? {},
      concepts: concepts as never,
      subjectKey: data.subjectKey as string | undefined,
    });
  } else {
    container.textContent = "unknown part";
  }
}
