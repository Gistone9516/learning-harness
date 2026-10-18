// WHAT: pure model of the roadmap part (specs/web-roadmap.md): parse the planning document into cycles and
//       steps, derive each step's study status, guard hints against code, and shape a hint request.
//       No DOM, no I/O. Tested in model.test.ts.

import type { AiEffort } from "../../src/ai/client";
import { isTableSep, splitRow } from "../../src/doc/doc";
import type { UnitProgress } from "../quiz/model";

export interface RoadmapSource {
  cycleHeading: string;
  cycleFilter?: string;
  columns: { step: string; study: string; build: string; check: string; status?: string };
  doneValues?: string[];
  flags?: { key: string; marker: string; label: string }[];
}

export interface Step {
  key: string;           // RM-3: the step cell lowercased; the same key as the outline unit
  code: string;          // the step cell as written (1-1, V-2)
  title: string;         // study text, or build text when there is no study
  study: string;
  build: string;
  check: string;
  status: string;        // the planning document's own status cell, untranslated (RM-6)
  built: boolean;
  noStudy: boolean;
  flags: string[];       // flag keys (RM-4)
  cycle: string;
}

export interface Cycle { label: string; steps: Step[] }

export type StudyStatus = "none" | "todo" | "studying" | "studied";

export interface Criterion { minAnswered: number; minAccuracy: number }
export const DEFAULT_CRITERION: Criterion = { minAnswered: 5, minAccuracy: 0.8 };

function stripMarkers(text: string, flags: RoadmapSource["flags"], found: Set<string>): string {
  let out = text;
  for (const f of flags ?? []) {
    if (f.marker && out.includes(f.marker)) {
      found.add(f.key);
      out = out.split(f.marker).join(" ");
    }
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
}

/** RM-2..RM-6: cycles are matching headings, steps are rows of the tables under them that carry a step column. */
export function parseRoadmap(md: string, src: RoadmapSource): Cycle[] {
  const heading = new RegExp(src.cycleHeading);
  const filter = src.cycleFilter ? new RegExp(src.cycleFilter) : null;
  const done = new Set((src.doneValues ?? []).map((v) => v.trim()));
  const lines = md.split(/\r?\n/);
  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      const m = heading.exec(line);
      const label = m ? (m[1] ?? m[0]).trim() : "";
      cur = m && (!filter || filter.test(label)) ? { label, steps: [] } : null;
      if (cur) cycles.push(cur);
      continue;
    }
    if (!cur || !line.trim().startsWith("|") || !isTableSep(lines[i + 1])) continue;
    const header = splitRow(line);
    const col = (name: string | undefined) => (name ? header.indexOf(name) : -1);
    const ix = { step: col(src.columns.step), study: col(src.columns.study), build: col(src.columns.build), check: col(src.columns.check), status: col(src.columns.status) };
    if (ix.step < 0) continue;
    i += 2;
    for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
      const cells = splitRow(lines[i]);
      const at = (k: number) => (k >= 0 ? cells[k] ?? "" : "");
      const code = at(ix.step);
      if (!code) continue;
      const found = new Set<string>();
      const study = stripMarkers(at(ix.study), src.flags, found);
      const build = stripMarkers(at(ix.build), src.flags, found);
      const check = stripMarkers(at(ix.check), src.flags, found);
      const status = at(ix.status);
      const noStudy = !study || /^\(.*\)$/.test(study);
      cur.steps.push({
        key: code.trim().toLowerCase(), code, title: noStudy ? build : study, study, build, check, status,
        built: done.has(status.trim()), noStudy, flags: [...found], cycle: cur.label,
      });
    }
    i--;
  }
  return cycles;
}

/** RM-3: the outline unit of a step: the same key, else a label that starts with the step cell and a space. */
export function unitFor(step: Step, areas: { key: string; label: string }[]): string | null {
  const exact = areas.find((a) => a.key === step.key);
  if (exact) return exact.key;
  const byLabel = areas.find((a) => (a.label ?? "").trim().toLowerCase().startsWith(step.key + " "));
  return byLabel ? byLabel.key : null;
}

/** RM-5: derived from the bank and the log, never stored. */
export function studyStatus(step: Step, p: UnitProgress | undefined, c: Criterion): StudyStatus {
  if (step.noStudy) return "none";
  if (!p || p.answered === 0) return "todo";
  return p.answered >= c.minAnswered && p.lastCorrect / p.answered >= c.minAccuracy ? "studied" : "studying";
}

export function accuracy(p: UnitProgress | undefined): number | null {
  return p && p.answered ? p.lastCorrect / p.answered : null;
}

/** RM-7: the first step, in document order, that is not built. */
export function currentStep(cycles: Cycle[]): Step | null {
  for (const c of cycles) for (const s of c.steps) if (!s.built) return s;
  return null;
}

// ── hints (RM-9..RM-11) ─────────────────────────────────────────────────────────────

export interface HintLevel { key: string; label: string; ask: string }
export interface HintsConfig { model?: string; effort?: AiEffort; system: string; levels: HintLevel[]; allowFences?: string[] }
export interface StepHints { step: string; levels: Record<string, { text: string; at: number }>; note?: string }

export const HINTS = "roadmap-hints";
export const DEFAULT_FENCES = ["text", "pseudo"];

export const HINT_DIRECTIVE = [
  "[Hint rules] Reply in the output language as Markdown. Give only what the requested level asks for.",
  "Write short paragraphs and bullet lists, no headings.",
  "Never write runnable code; if structure helps, write pseudocode inside a fence marked text.",
  "Name the functions, commands or documents the learner should look up instead of showing their use in full.",
  "Build on the hints already given instead of repeating them.",
].join("\n");

/** Record id for a step (RM-11): state names allow only [a-z0-9-]. */
export function hintId(stepKey: string): string {
  return stepKey.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "") || "step";
}

/** RM-9: a level opens once the one before it was received. */
export function levelOpen(levels: HintLevel[], rec: StepHints | null, index: number): boolean {
  return index === 0 || !!rec?.levels[levels[index - 1].key];
}

/** RM-10: replace every fenced block whose info string is not allowed. An unclosed fence runs to the end. */
export function guardFences(md: string, allow: string[], replacement: string): string {
  const ok = new Set(allow.map((a) => a.toLowerCase()));
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[i]);
    if (!open) { out.push(lines[i]); continue; }
    const fence = open[1];
    const info = open[2].toLowerCase();
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith(fence)) j++;
    if (ok.has(info)) out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
    else out.push(replacement);
    i = j;
  }
  return out.join("\n");
}

export function hintRequest(step: Step, level: HintLevel, rec: StepHints | null, levels: HintLevel[], cfg: HintsConfig): { system: string; prompt: string; model?: string; effort: AiEffort } {
  const given = levels.filter((l) => l.key !== level.key && rec?.levels[l.key]).map((l) => ({ level: l.label, text: rec!.levels[l.key].text }));
  const prompt = {
    step: { id: step.code, study: step.study, build: step.build, check: step.check },
    level: { label: level.label, ask: level.ask },
    hints_already_given: given,
    learner_note: rec?.note?.trim() || null,
  };
  return { system: `${cfg.system}\n\n${HINT_DIRECTIVE}`, prompt: JSON.stringify(prompt), model: cfg.model, effort: cfg.effort ?? "medium" };
}
