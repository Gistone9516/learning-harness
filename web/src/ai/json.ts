// Pull one JSON object out of a model reply. /ai has no JSON mode and tools are off, so a reply may wrap
// the object in a fence or prose. Order: the last ```json fence, else the outermost {...}. Anything that
// does not parse to a plain object is null -- callers treat null as "no structured answer", never as data.

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const src = text ?? "";
  const fence = /```json\s*([\s\S]*?)```/gi;
  let last: RegExpExecArray | null = null;
  for (let m = fence.exec(src); m; m = fence.exec(src)) last = m;
  const candidates: string[] = [];
  if (last) candidates.push(last[1]);
  const start = src.indexOf("{"), end = src.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(src.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim()) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
