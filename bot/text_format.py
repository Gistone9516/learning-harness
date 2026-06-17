# -*- coding: utf-8 -*-
"""Discord table formatting (the kit-wide standard).

Discord markdown does NOT render tables — pipe tables show as raw `| a | b |` text. The
standard here is a monospace, column-aligned table inside a ``` code block, which Discord
renders in a fixed-width font with aligned columns. East-Asian (CJK) characters are width 2,
so Korean columns line up — this is the single source of truth for display width, reused by
the live table renderer too.

Pure module (no discord, no subject literals):
- display_width(s): sum of per-char display widths (CJK = 2).
- pad(s, width): right-pad to a display width.
- render_table(headers, rows): canonical code-block aligned table string.
- format_tables(text): convert any GFM pipe-table block in free text to render_table output;
  leaves non-table text and existing fenced code blocks untouched; never raises.
"""
from __future__ import annotations

import re
import unicodedata

_COLGAP = "  "  # two spaces between columns


def display_width(s: str) -> int:
    """Monospace display width: East-Asian Wide/Fullwidth chars count as 2, others as 1."""
    w = 0
    for ch in str(s):
        if unicodedata.combining(ch):
            continue
        w += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return w


def pad(s: str, width: int) -> str:
    """Right-pad s with spaces to the given display width (no truncation)."""
    s = str(s)
    return s + " " * max(0, width - display_width(s))


def render_table(headers, rows) -> str:
    """Return a monospace, column-aligned table wrapped in a ``` code block.

    headers: list of column titles. rows: list of row sequences. Cells are stringified.
    Columns are widened to the max display width of header + cells, aligned with CJK awareness.
    """
    headers = [str(h) for h in headers]
    norm_rows = [[str(c) for c in row] for row in rows]
    ncol = max([len(headers)] + [len(r) for r in norm_rows]) if (headers or norm_rows) else 0
    if ncol == 0:
        return ""
    headers = headers + [""] * (ncol - len(headers))
    norm_rows = [r + [""] * (ncol - len(r)) for r in norm_rows]

    widths = []
    for c in range(ncol):
        col_cells = [headers[c]] + [r[c] for r in norm_rows]
        widths.append(max(display_width(x) for x in col_cells))

    def _line(cells):
        return _COLGAP.join(pad(cells[c], widths[c]) for c in range(ncol)).rstrip()

    lines = [_line(headers), _COLGAP.join("-" * widths[c] for c in range(ncol))]
    for r in norm_rows:
        lines.append(_line(r))
    return "```\n" + "\n".join(lines) + "\n```"


# ── markdown pipe-table detection / conversion ──────────────────────────────────

_SEP_CELL = re.compile(r"^:?-{1,}:?$")


def _split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _looks_like_row(line: str) -> bool:
    s = line.strip()
    return ("|" in s) and (s.startswith("|") or s.count("|") >= 2)


def _is_separator(line: str) -> bool:
    cells = _split_row(line)
    return len(cells) >= 1 and all(c and _SEP_CELL.match(c) for c in cells)


def format_tables(text: str) -> str:
    """Convert GFM pipe tables in `text` to monospace code-block tables.

    A table = a header row, a `|---|---|` separator row, then zero or more body rows.
    Existing ``` fenced blocks are passed through untouched (no double conversion). Text with
    no table is returned unchanged. Never raises: returns the original text on any error.
    """
    if not text or "|" not in text:
        return text
    try:
        lines = text.split("\n")
        out: list[str] = []
        i, n = 0, len(lines)
        in_fence = False
        while i < n:
            line = lines[i]
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                out.append(line)
                i += 1
                continue
            if (not in_fence
                    and _looks_like_row(line)
                    and i + 1 < n and _is_separator(lines[i + 1])):
                headers = _split_row(line)
                body = []
                j = i + 2
                while j < n and _looks_like_row(lines[j]) and not lines[j].lstrip().startswith("```"):
                    body.append(_split_row(lines[j]))
                    j += 1
                out.append(render_table(headers, body))
                i = j
                continue
            out.append(line)
            i += 1
        return "\n".join(out)
    except Exception:
        return text
