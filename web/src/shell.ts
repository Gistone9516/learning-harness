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
  data: unknown;            // part-specific injected data (problem / project / {areas, conceptOutline})
  ai?: AiClientConfig;      // required for the AI parts (codeproj, conceptprob)
}

export function mountApp(container: HTMLElement, config: AppConfig): void {
  if (config.part === "sheet") {
    mountSheet(container, config.data as SheetProblem);
    return;
  }
  if (!config.ai) {
    container.textContent = "이 모듈은 AI 설정(ai_server)이 필요합니다.";
    return;
  }
  const session = new AiSession(createAiClient(config.ai));
  const data = (config.data ?? {}) as Record<string, unknown>;
  if (config.part === "codeproj") {
    mountCodeproj(container, { session, project: data.project as never });
  } else if (config.part === "conceptprob") {
    mountConceptprob(container, {
      session,
      areas: (data.areas as never) ?? [],
      conceptOutline: (data.conceptOutline as never) ?? {},
      subjectKey: data.subjectKey as string | undefined,
    });
  } else {
    container.textContent = "unknown part";
  }
}
