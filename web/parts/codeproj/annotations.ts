// The annotation layer's model: parsing, line lookup and popup placement. No DOM.
//
// Placement lives here rather than beside the popup because jsdom has no layout — every
// getBoundingClientRect() returns zeros — so geometry kept in the view is geometry that cannot
// be unit-tested at all.

/** One annotation. Only `what` is required; the rest are omitted when they would add nothing. */
export interface Annotation {
  /** Inclusive 1-based line range within the file, and the symbol it names when there is one. */
  target: { lines: [number, number]; symbol?: string };
  kind: AnnotationKind;
  what: string;
  why?: string;
  concept?: string;
  watch?: string;
  refs?: { path: string; line?: number; label?: string }[];
}

export const ANNOTATION_KINDS = [
  "file",
  "class",
  "function",
  "method",
  "import",
  "statement",
  "config",
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Per-file state. `pending` is a file whose annotations were asked for but have not arrived. */
export type FileAnnotationStatus = "pending" | "ok" | "failed";

/**
 * Why a file has no usable notes. A bare "failed" leaves both the learner and the operator with
 * nothing to act on but a retry, and the three causes want different responses: `call` is worth
 * retrying, `parse` means the model answered in prose, `dropped` means it answered about lines
 * this file does not have.
 */
export type AnnotationFailure = "call" | "parse" | "dropped";

export interface FileAnnotations {
  status: FileAnnotationStatus;
  items: Annotation[];
  reason?: AnnotationFailure;
}

/** Everything known about one project, keyed by file path. */
export interface AnnotationSet {
  files: Record<string, FileAnnotations>;
}

export function emptyAnnotationSet(): AnnotationSet {
  return { files: {} };
}

/**
 * A file is marked failed rather than partially shown once this much of its annotations had to
 * be discarded. Silent quality loss is the worse outcome: a file that quietly ends up with two
 * usable notes looks like a file the model found uninteresting, and nobody returns to it.
 */
export const DROP_RATIO_LIMIT = 0.3;

export interface ParseResult {
  status: FileAnnotationStatus;
  items: Annotation[];
  /** How many raw entries were discarded. Kept for the status chip and for diagnosis. */
  dropped: number;
  total: number;
}

function asRange(v: unknown, lineCount: number): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = Math.trunc(Number(v[0]));
  const b = Math.trunc(Number(v[1]));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // Out of range is dropped, never clamped. A clamped range still paints an underline, just on
  // the wrong code — and an annotation pointing at the wrong lines is worse than none at all.
  if (lo < 1 || hi > lineCount) return null;
  return [lo, hi];
}

function asText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asRefs(v: unknown): Annotation["refs"] {
  if (!Array.isArray(v)) return undefined;
  const refs = v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      path: asText(r["path"]) ?? "",
      line: Number.isFinite(Number(r["line"])) ? Math.trunc(Number(r["line"])) : undefined,
      label: asText(r["label"]),
    }))
    .filter((r) => r.path);
  return refs.length ? refs : undefined;
}

/**
 * Tolerant parse of one file's annotations. The input is model output, so it is treated as a
 * proposal: entries that cannot be trusted are dropped rather than repaired.
 *
 * `lineCount` is the file's real length — the only thing that can tell a valid range from one
 * the model invented.
 */
export function parseAnnotations(raw: unknown, lineCount: number): ParseResult {
  const container = raw as { items?: unknown } | null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(container?.items)
      ? (container.items as unknown[])
      : null;
  if (!list) return { status: "failed", items: [], dropped: 0, total: 0 };

  const items: Annotation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const what = asText(e["what"]);
    if (!what) continue; // an annotation with nothing to say is not one

    const target = (e["target"] ?? {}) as Record<string, unknown>;
    const lines = asRange(target["lines"] ?? e["lines"], lineCount);
    if (!lines) continue;

    const rawKind = asText(e["kind"]);
    // An unknown kind is a labelling problem, not a content problem, so the note survives as a
    // plain statement instead of being thrown away along with its text.
    const kind = (ANNOTATION_KINDS as readonly string[]).includes(rawKind ?? "")
      ? (rawKind as AnnotationKind)
      : "statement";

    items.push({
      target: { lines, symbol: asText(target["symbol"] ?? e["symbol"]) },
      kind,
      what,
      why: asText(e["why"]),
      concept: asText(e["concept"]),
      watch: asText(e["watch"]),
      refs: asRefs(e["refs"]),
    });
  }

  const total = list.length;
  const dropped = total - items.length;
  const status: FileAnnotationStatus =
    items.length === 0 || dropped / Math.max(total, 1) > DROP_RATIO_LIMIT ? "failed" : "ok";
  return { status, items, dropped, total };
}

/**
 * Line number -> index into `items`, or -1. Built once per file so hovering costs a lookup
 * rather than a scan of every annotation on every mouse move.
 *
 * `kind: "file"` is excluded. Its range is the whole file, so indexing it would light the
 * affordance on every line and destroy the one thing the affordance is for: seeing at a glance
 * where the annotations actually are. The file note is reached from the panel header instead.
 *
 * Overlaps resolve to the narrowest range — the most specific thing said about that line.
 */
export function buildLineIndex(items: Annotation[], lineCount: number): Int32Array {
  const index = new Int32Array(lineCount + 1).fill(-1);
  const width = new Int32Array(lineCount + 1);
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (a.kind === "file") continue;
    const [lo, hi] = a.target.lines;
    const span = hi - lo;
    for (let ln = lo; ln <= hi && ln <= lineCount; ln += 1) {
      if (index[ln] === -1 || span < width[ln]) {
        index[ln] = i;
        width[ln] = span;
      }
    }
  }
  return index;
}

/** The single file-level note, when the model wrote one. */
export function fileNote(items: Annotation[]): Annotation | null {
  return items.find((a) => a.kind === "file") ?? null;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Whether the popup ended up above the anchor; the caller flips the pointer accordingly. */
  above: boolean;
}

export const POPUP_GAP = 8;
export const POPUP_MARGIN = 12;

/**
 * Where to put the popup so it does not cover the line it explains and does not leave the
 * viewport. Below the anchor by default; above when there is no room below but there is above.
 */
export function placePopup(
  anchor: Rect,
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const roomBelow = viewport.height - (anchor.top + anchor.height);
  const roomAbove = anchor.top;
  const above = roomBelow < popup.height + POPUP_GAP && roomAbove > roomBelow;

  const top = above
    ? Math.max(POPUP_MARGIN, anchor.top - popup.height - POPUP_GAP)
    : Math.min(
        anchor.top + anchor.height + POPUP_GAP,
        Math.max(POPUP_MARGIN, viewport.height - popup.height - POPUP_MARGIN),
      );

  const left = Math.min(
    Math.max(POPUP_MARGIN, anchor.left),
    Math.max(POPUP_MARGIN, viewport.width - popup.width - POPUP_MARGIN),
  );
  return { left, top, above };
}
