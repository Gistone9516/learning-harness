// Generic shell entry (web-contract.md §1). Mounts the part named by the injected runtime config: a host
// page sets globalThis.LH_CONFIG, or a consuming instance supplies it. The kit ships NO subject/instance
// content. For local dev only (`npm run dev`), it falls back to a mock fixture under examples/, which is
// never part of the kit contract (excluded from the subject-agnostic guard).
import { mountApp, type AppConfig } from "./shell";

async function resolveConfig(): Promise<AppConfig | null> {
  const injected = (globalThis as unknown as { LH_CONFIG?: AppConfig }).LH_CONFIG;
  if (injected) return injected;
  if (import.meta.env.DEV) {
    const m = await import("../examples/dev-fixture");
    return m.devConfig;
  }
  return null;
}

const app = document.getElementById("app");
if (app) {
  void resolveConfig().then((cfg) => {
    if (cfg) mountApp(app, cfg);
    else app.textContent = "마운트할 콘텐츠가 없습니다 (globalThis.LH_CONFIG 주입 필요).";
  });
}
