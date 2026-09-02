// WHAT: study history dashboard — sessions, reading progress and topic/stack history from stored records.
// DEPS: web/src/storage (StoragePort). No npm libs; plain DOM.
// INPUT: a StoragePort plus the collection names to read; all figures come from index summaries.
// EVENTS: none (read-only view).
// AI: no — token 0. It never calls ai_server.
// CONSTRAINTS: subject-agnostic, token0 (index summaries only, payloads are never loaded).
// DEMO: mountDashboard(el, { storage }) against any StoragePort, including an in-memory fake.

import type { IndexEntry, StoragePort } from "../../src/storage/port";

export interface DashboardProps {
  storage: StoragePort;
  collections?: { projects: string; progress: string; history: string };
}

export interface DashboardStats {
  sessions: number;
  projects: number;
  filesSeen: number;
  filesTotal: number;
  questions: number;
  explains: number;
  stacks: { name: string; count: number }[];
  recent: {
    project_id: string;
    topic: string;
    stack: string;
    started_at: number;
    questions: number;
    explains: number;
    files_seen: number;
  }[];
  progress: { project_id: string; title: string; seen: number; total: number }[];
}

const DEFAULTS = { projects: "projects", progress: "progress", history: "history" };

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

/**
 * Aggregate from index entries alone. Every figure a dashboard shows is already in the summary a
 * record publishes, so a long history costs one index read per collection rather than N payloads.
 */
export function aggregate(
  history: IndexEntry[],
  projects: IndexEntry[],
  progress: IndexEntry[],
): DashboardStats {
  const titles = new Map(projects.map((p) => [p.id, str(p.summary["title"], p.id)]));

  const stackCounts = new Map<string, number>();
  for (const entry of history) {
    const stack = str(entry.summary["stack"]).trim();
    if (stack) stackCounts.set(stack, (stackCounts.get(stack) ?? 0) + 1);
  }

  const recent = history
    .map((e) => ({
      project_id: str(e.summary["project_id"]),
      topic: str(e.summary["topic"]),
      stack: str(e.summary["stack"]),
      started_at: num(e.summary["started_at"]),
      questions: num(e.summary["questions"]),
      explains: num(e.summary["explains"]),
      files_seen: num(e.summary["files_seen"]),
    }))
    .sort((a, b) => b.started_at - a.started_at);

  return {
    sessions: history.length,
    projects: projects.length,
    filesSeen: progress.reduce((n, e) => n + num(e.summary["seen_count"]), 0),
    filesTotal: progress.reduce((n, e) => n + num(e.summary["file_count"]), 0),
    questions: history.reduce((n, e) => n + num(e.summary["questions"]), 0),
    explains: history.reduce((n, e) => n + num(e.summary["explains"]), 0),
    stacks: [...stackCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    recent,
    progress: progress
      .map((e) => ({
        project_id: str(e.summary["project_id"], e.id),
        title: titles.get(str(e.summary["project_id"], e.id)) ?? e.id,
        seen: num(e.summary["seen_count"]),
        total: num(e.summary["file_count"]),
      }))
      .sort((a, b) => b.seen / (b.total || 1) - a.seen / (a.total || 1)),
  };
}

export async function loadStats(props: DashboardProps): Promise<DashboardStats> {
  const c = props.collections ?? DEFAULTS;
  const [history, projects, progress] = await Promise.all([
    props.storage.list(c.history),
    props.storage.list(c.projects),
    props.storage.list(c.progress),
  ]);
  return aggregate(history, projects, progress);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function tile(label: string, value: string, sub?: string): HTMLElement {
  const box = el("div", "lh-db-tile");
  box.appendChild(el("div", "lh-db-tile-value", value));
  box.appendChild(el("div", "lh-db-tile-label", label));
  if (sub) box.appendChild(el("div", "lh-db-tile-sub", sub));
  return box;
}

function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  // With the time dropped, two sessions on one day render as identical rows -- same topic,
  // same stack, same counts -- and nothing on screen tells them apart. The minute is already
  // in the record; only the formatter was throwing it away.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderDashboard(container: HTMLElement, stats: DashboardStats): void {
  container.innerHTML = "";
  const root = el("div", "lh-db");

  root.appendChild(el("h2", "lh-db-title", "학습 이력"));

  const tiles = el("div", "lh-db-tiles");
  tiles.appendChild(tile("학습 세션", String(stats.sessions)));
  tiles.appendChild(tile("프로젝트", String(stats.projects)));
  tiles.appendChild(
    tile("읽은 파일", `${stats.filesSeen}`, stats.filesTotal ? `전체 ${stats.filesTotal}개 중` : undefined),
  );
  tiles.appendChild(tile("질문", String(stats.questions)));
  tiles.appendChild(tile("해설 요청", String(stats.explains)));
  root.appendChild(tiles);

  if (stats.stacks.length) {
    const section = el("section", "lh-db-section");
    section.appendChild(el("h3", "lh-db-section-title", "스택 이력"));
    const chips = el("div", "lh-db-chips");
    for (const s of stats.stacks) chips.appendChild(el("span", "lh-db-chip", `${s.name} (${s.count})`));
    section.appendChild(chips);
    root.appendChild(section);
  }

  if (stats.progress.length) {
    const section = el("section", "lh-db-section");
    section.appendChild(el("h3", "lh-db-section-title", "프로젝트별 진도"));
    const list = el("ul", "lh-db-progress");
    for (const p of stats.progress) {
      const li = el("li", "lh-db-progress-item");
      li.appendChild(el("span", "lh-db-progress-title", p.title));
      const bar = el("span", "lh-db-bar");
      const fill = el("span", "lh-db-bar-fill");
      fill.style.width = `${p.total ? Math.round((p.seen / p.total) * 100) : 0}%`;
      bar.appendChild(fill);
      li.appendChild(bar);
      li.appendChild(el("span", "lh-db-progress-count", `${p.seen}/${p.total}`));
      list.appendChild(li);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  const section = el("section", "lh-db-section");
  section.appendChild(el("h3", "lh-db-section-title", "최근 세션"));
  if (!stats.recent.length) {
    section.appendChild(el("p", "lh-db-empty", "아직 학습 기록이 없습니다."));
  } else {
    const table = el("table", "lh-db-table");
    const head = el("tr");
    for (const h of ["날짜", "주제", "스택", "읽음", "해설", "질문"]) head.appendChild(el("th", "", h));
    table.appendChild(head);
    for (const r of stats.recent.slice(0, 20)) {
      const tr = el("tr");
      tr.appendChild(el("td", "", formatDate(r.started_at)));
      tr.appendChild(el("td", "", r.topic));
      tr.appendChild(el("td", "", r.stack));
      tr.appendChild(el("td", "lh-db-num", String(r.files_seen)));
      tr.appendChild(el("td", "lh-db-num", String(r.explains)));
      tr.appendChild(el("td", "lh-db-num", String(r.questions)));
      table.appendChild(tr);
    }
    section.appendChild(table);
  }
  root.appendChild(section);

  container.appendChild(root);
}

export async function mountDashboard(container: HTMLElement, props: DashboardProps): Promise<void> {
  container.textContent = "불러오는 중...";
  renderDashboard(container, await loadStats(props));
}
