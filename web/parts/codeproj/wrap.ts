// Soft wrap for the code panel: the pure half. Measuring rows needs layout, which jsdom does not
// have, so everything that can be decided without a browser lives here and is tested on its own.

/**
 * Extra columns a continuation row sits in from its own line's indent.
 *
 * Two, not four: four is one indentation level in most code, and in a language where indentation
 * is syntax a continuation row four columns in reads as a nested block. The wrap mark at the end
 * of the row is the other half of that guard.
 */
export const WRAP_EXTRA_CH = 2;

/**
 * Where the preference is kept. Global rather than per subject, beside `lh:theme`: it is how this
 * viewer likes to read code, not a fact about any one project, and a subject in the key would split
 * one preference into one per instance.
 */
export const WRAP_STORAGE_KEY = "lh:code-wrap";

/** Browsers render a tab at 8 columns unless a stylesheet says otherwise, and none here does. */
const TAB_COLUMNS = 8;

/** Columns of leading whitespace, a tab counting to the next tab stop. */
export function leadingColumns(text: string, tabColumns = TAB_COLUMNS): number {
  let col = 0;
  for (const ch of text) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += tabColumns - (col % tabColumns);
    else break;
  }
  return col;
}

export interface RowBox {
  top: number;
  bottom: number;
  right: number;
}

/**
 * The visual rows of one wrapped line, from its inline box fragments, minus the last row.
 *
 * Every row but the last ends where the line was broken, and that is where a mark belongs; the
 * last row ends where the line itself ends. Fragments on one row are merged (nested inline boxes
 * can report more than one), keeping the rightmost edge, and rows come back top to bottom. A line
 * that did not wrap yields nothing.
 */
export function wrappedRowEnds(fragments: ReadonlyArray<RowBox>): RowBox[] {
  const rows: RowBox[] = [];
  for (const f of [...fragments].sort((a, b) => a.top - b.top)) {
    if (f.bottom - f.top <= 0) continue;
    const row = rows.find((r) => Math.abs(r.top - f.top) < 2);
    if (row) {
      row.right = Math.max(row.right, f.right);
      row.bottom = Math.max(row.bottom, f.bottom);
    } else {
      rows.push({ top: f.top, bottom: f.bottom, right: f.right });
    }
  }
  return rows.slice(0, -1);
}

/** Read the preference. Off when unset, unreadable, or storage is unavailable. */
export function readWrapPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(WRAP_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeWrapPreference(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(WRAP_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // A private window or a blocked store: the toggle still works for this visit.
  }
}
