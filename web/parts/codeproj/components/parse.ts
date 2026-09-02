// Tolerant reader for a composed answer.
//
// The model is asked for JSON, but an answer is worth showing even when it arrives imperfect. So:
// fences are stripped, a bare array is accepted as well as {blocks:[...]}, blocks missing their
// type but carrying text become plain text, and anything unusable is skipped rather than throwing.
// If nothing at all can be read, the caller falls back to showing the raw text.

import type { Block, CodeRef, Composed } from "./types";
import { KNOWN_BLOCKS } from "./types";

function stripFences(text: string): string {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, "");
  s = s.replace(/\n?```\s*$/, "");
  return s.trim();
}

/** Pull the outermost {...} or [...] when the model wraps JSON in a sentence. */
export function carveJson(text: string): string | null {
  const s = stripFences(text);
  if (s.startsWith("{") || s.startsWith("[")) return s;
  const first = s.search(/[[{]/);
  if (first < 0) return null;
  const open = s[first];
  const close = open === "{" ? "}" : "]";
  const last = s.lastIndexOf(close);
  if (last <= first) return null;
  return s.slice(first, last + 1);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function lines(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const a = Number(v[0]);
  const b = Number(v[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Normalise one raw block. Returns null when there is nothing worth rendering.
 * A block of an unknown type is kept as text when it carries any, so a newer model that invents a
 * component still says something rather than vanishing.
 */
function readBlock(raw: unknown): Block | null {
  if (typeof raw === "string") return str(raw) ? { t: "text", text: raw } : null;
  if (!isObj(raw)) return null;

  const t = String(raw["t"] ?? raw["type"] ?? "").trim();
  const text = str(raw["text"]);

  if (!KNOWN_BLOCKS.includes(t as Block["t"])) {
    return text ? { t: "text", text } : null;
  }

  switch (t) {
    case "lead":
    case "answer":
    case "text":
    case "caution":
    case "uncertain":
      return text ? ({ t, text } as Block) : null;

    case "list": {
      const items = Array.isArray(raw["items"])
        ? raw["items"].map((i) => str(i)).filter((i): i is string => !!i)
        : [];
      return items.length ? { t: "list", items } : null;
    }

    case "steps": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((i) => (isObj(i) ? { title: str(i["title"]) ?? "", text: str(i["text"]) ?? undefined } : null))
            .filter(Boolean) as { title: string; text?: string }[]
        : [];
      return items.length ? { t: "steps", items } : null;
    }

    case "ref": {
      const path = str(raw["path"]);
      return path ? { t: "ref", path, lines: lines(raw["lines"]), note: str(raw["note"]) ?? undefined } : null;
    }

    case "focus": {
      const l = lines(raw["lines"]);
      return l ? { t: "focus", lines: l, note: str(raw["note"]) ?? undefined } : null;
    }

    case "signature": {
      const sig = str(raw["sig"]) ?? str(raw["signature"]);
      if (!sig) return null;
      const params = Array.isArray(raw["params"])
        ? raw["params"]
            .map((p) => (isObj(p) ? { name: str(p["name"]) ?? "", desc: str(p["desc"]) ?? "" } : null))
            .filter(Boolean) as { name: string; desc: string }[]
        : undefined;
      return { t: "signature", sig, params, returns: str(raw["returns"]) ?? undefined };
    }

    case "io": {
      const input = str(raw["input"]);
      const output = str(raw["output"]);
      return input && output ? { t: "io", input, output } : null;
    }

    case "calls": {
      const side = (v: unknown) =>
        Array.isArray(v)
          ? v
              .map((r) => (isObj(r) && str(r["path"]) ? { path: String(r["path"]), lines: lines(r["lines"]), note: str(r["note"]) ?? undefined } : null))
              .filter(Boolean) as CodeRef[]
          : undefined;
      const callers = side(raw["callers"]);
      const callees = side(raw["callees"]);
      return callers?.length || callees?.length ? { t: "calls", callers, callees } : null;
    }

    case "flow": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((i) =>
              isObj(i) && str(i["title"])
                ? {
                    title: String(i["title"]),
                    text: str(i["text"]) ?? undefined,
                    path: str(i["path"]) ?? undefined,
                    lines: lines(i["lines"]),
                  }
                : null,
            )
            .filter(Boolean) as any
        : [];
      return items.length ? { t: "flow", items } : null;
    }

    case "alt": {
      const pair = (v: unknown) =>
        isObj(v) && str(v["title"]) && str(v["text"])
          ? { title: String(v["title"]), text: String(v["text"]) }
          : null;
      const current = pair(raw["current"]);
      const other = pair(raw["other"]);
      return current && other ? { t: "alt", current, other } : null;
    }

    case "concept": {
      const name = str(raw["name"]);
      const definition = str(raw["definition"]);
      if (!name || !definition) return null;
      return {
        t: "concept",
        name,
        definition,
        general: str(raw["general"]) ?? "",
        industry: str(raw["industry"]) ?? "",
        here: str(raw["here"]) ?? "",
      };
    }

    case "tag": {
      const names = Array.isArray(raw["names"])
        ? raw["names"].map((n) => str(n)).filter((n): n is string => !!n)
        : [];
      return names.length ? { t: "tag", names } : null;
    }

    case "terms": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((i) => (isObj(i) && str(i["term"]) ? { term: String(i["term"]), def: str(i["def"]) ?? "" } : null))
            .filter(Boolean) as { term: string; def: string }[]
        : [];
      return items.length ? { t: "terms", items } : null;
    }

    case "compare": {
      const headers = Array.isArray(raw["headers"])
        ? raw["headers"].map((h) => String(h ?? ""))
        : [];
      const rows = Array.isArray(raw["rows"])
        ? raw["rows"].filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? "")))
        : [];
      return headers.length && rows.length ? { t: "compare", headers, rows } : null;
    }

    case "why": {
      const decision = str(raw["decision"]);
      const reason = str(raw["reason"]);
      return decision && reason ? { t: "why", decision, reason } : null;
    }

    case "quiz": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((i) => (isObj(i) && str(i["q"]) ? { q: String(i["q"]), a: str(i["a"]) ?? "" } : null))
            .filter(Boolean) as { q: string; a: string }[]
        : [];
      return items.length ? { t: "quiz", items } : null;
    }

    case "findit": {
      const q = str(raw["q"]);
      const ans = raw["answer"];
      if (!q || !isObj(ans) || !str(ans["path"])) return null;
      return {
        t: "findit",
        q,
        answer: { path: String(ans["path"]), lines: lines(ans["lines"]) },
        hint: str(raw["hint"]) ?? undefined,
      };
    }

    case "next": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((i) =>
              isObj(i) && str(i["label"])
                ? { label: String(i["label"]), path: str(i["path"]) ?? undefined, lines: lines(i["lines"]) }
                : null,
            )
            .filter(Boolean) as any
        : [];
      return items.length ? { t: "next", items } : null;
    }

    case "related": {
      const items = Array.isArray(raw["items"])
        ? raw["items"]
            .map((r) => (isObj(r) && str(r["path"]) ? { path: String(r["path"]), lines: lines(r["lines"]), note: str(r["note"]) ?? undefined } : null))
            .filter(Boolean) as CodeRef[]
        : [];
      return items.length ? { t: "related", items } : null;
    }

    case "evidence": {
      return text
        ? { t: "evidence", text, path: str(raw["path"]) ?? undefined, lines: lines(raw["lines"]) }
        : null;
    }

    default:
      return text ? { t: "text", text } : null;
  }
}

/**
 * Read a composed answer. Returns null when the text is not a composed answer at all, which tells
 * the caller to show it as prose instead.
 */
export function parseComposed(text: string): Composed | null {
  const carved = carveJson(text);
  if (!carved) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(carved);
  } catch {
    return null;
  }

  const rawBlocks = Array.isArray(parsed)
    ? parsed
    : isObj(parsed) && Array.isArray(parsed["blocks"])
      ? (parsed["blocks"] as unknown[])
      : null;
  if (!rawBlocks) return null;

  const blocks = rawBlocks.map(readBlock).filter((b): b is Block => !!b);
  return blocks.length ? { blocks } : null;
}
