// The concept layer: what a loaded codebase teaches, written out as documents.
//
// The annotation layer (FR-21) explains one place in one file. This explains the ideas that run
// across files -- why the code is split the way it is, what a pattern in it is called, what would
// break without it. The two are deliberately different scales; a note that had to cover both would
// be either too long to sit beside a line or too shallow to be worth a page.
//
// The document dialect and its renderer are shared with conceptprob (`src/doc`), so a concept here
// looks like a concept there. What is NOT shared is the practice apparatus: no problems, no
// grading, no tiers. Those belong to a subject with an exam behind it, and this one has none --
// carrying an empty `problems: []` forward "because the format has one" would be structure that
// can never be filled.

import { parseBody, type Step } from "../../src/doc/doc";

/** A concept the project actually uses, before anyone has written it up. */
export interface ConceptSeed {
  /** A coarse grouping key, lowercase ascii (structure, storage, errors...). Author-chosen. */
  area: string;
  /** Stable key within the project. Constrained so it can be a DOM id and a URL fragment. */
  concept_id: string;
  title: string;
}

/** A written concept. `body` is the shared markdown dialect; `parseBody` turns it into blocks. */
export interface ConceptDoc extends ConceptSeed {
  body: string;
}

/** Why a concept has no document. Kept apart from "not started" so a retry can be offered. */
export type ConceptFailure = "call" | "parse";

export interface ConceptEntry {
  seed: ConceptSeed;
  /** `pending` is the normal state for minutes after the learner enters, not an error. */
  status: "pending" | "writing" | "ok" | "failed";
  doc?: ConceptDoc;
  reason?: ConceptFailure;
}

export interface ConceptSet {
  /** Seed order is the reading order. The model groups related concepts adjacently; keep that. */
  entries: ConceptEntry[];
}

/**
 * Ids must survive being used as a record key one day, and as a DOM id today.
 * Same rule as the storage layer's, restated rather than imported because this is a content
 * constraint the prompt has to satisfy, not a storage call this module makes.
 */
export const CONCEPT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * How many concepts one project may have.
 *
 * Not a cost limit -- a document is one resumed call and they run in the background. It is a
 * reading limit: past this many, a list stops being a table of contents and becomes a search
 * problem, and the learner is here to read code, not to work through a syllabus.
 */
export const CONCEPT_MAX = 10;

/** Below this, the outline is not worth showing -- something went wrong upstream. */
export const CONCEPT_MIN = 2;

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Parse the outline reply into seeds.
 *
 * Tolerant per item and strict per field: an item missing a title or carrying an id the storage
 * rule would reject is dropped rather than repaired, because a repaired id stops matching the one
 * the model will use when it writes that document, and the two would silently fail to join.
 * Duplicate ids are dropped for the same reason.
 */
export function parseSeeds(text: string): ConceptSeed[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return [];
  }
  const list = (raw as { concepts?: unknown } | null)?.concepts;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ConceptSeed[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const concept_id = str(o, "concept_id");
    const title = str(o, "title");
    const area = str(o, "area") || "general";
    if (!title || !CONCEPT_ID_RE.test(concept_id) || seen.has(concept_id)) continue;
    seen.add(concept_id);
    out.push({ area, concept_id, title });
    if (out.length === CONCEPT_MAX) break;
  }
  return out;
}

/**
 * Parse one written document, and require it to be about the concept that was asked for.
 *
 * The id is overwritten from the seed rather than read from the reply. A model that renames the
 * concept mid-answer would otherwise orphan the document: the list still shows the seed, and
 * nothing ever fills it. The title is taken from the reply, because a better title for the same
 * idea is an improvement, not a mismatch.
 */
export function parseDoc(text: string, seed: ConceptSeed): ConceptDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const body = typeof o["body"] === "string" ? o["body"] : "";
  if (!body.trim()) return null;
  return {
    area: str(o, "area") || seed.area,
    concept_id: seed.concept_id,
    title: str(o, "title") || seed.title,
    body,
  };
}

/** Strip a ```json fence the model may have wrapped the object in. */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

/** A fresh set: every concept known, none written. This is what the learner walks into. */
export function seedSet(seeds: ConceptSeed[]): ConceptSet {
  return { entries: seeds.map((seed) => ({ seed, status: "pending" as const })) };
}

/** Counts for the tab and the list header. Derived, never stored -- see `web-contract` §5. */
export function conceptProgress(set: ConceptSet): { done: number; total: number; failed: number } {
  return {
    done: set.entries.filter((e) => e.status === "ok").length,
    total: set.entries.length,
    failed: set.entries.filter((e) => e.status === "failed").length,
  };
}

/** The document split into its rendered steps, or null when there is nothing written yet. */
export function docSteps(entry: ConceptEntry): { summary: string; steps: Step[] } | null {
  return entry.doc ? parseBody(entry.doc.body) : null;
}
