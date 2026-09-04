// The concept-document dialect: a small markdown subset, its parse tree, and its DOM rendering.
//
// It lives here rather than inside a part because two parts now read the same documents —
// conceptprob renders a subject's pre-baked concepts, codeproj renders the concepts an AI wrote
// about a generated codebase. The web contract keeps shared machinery out of `parts/` for exactly
// this reason: a part has to stay a working unit on its own.
//
// Nothing here knows what subject it is rendering. Badges, tiers, exam vocabulary and progress
// all stayed behind in the part that owns them.

import { highlightCode } from "../highlight/highlight";

export interface Figure { caption?: string; svg: string; anchor?: string }  // anchor = the step title this figure follows ("" / "END" => after all steps)

export interface Term { term: string; def: string }
export interface Point { lead: string; text: string }
export type Block =
  | { kind: "p"; html: string; raw: string }
  | { kind: "head"; text: string }
  | { kind: "terms"; caption: string; rows: Term[] }
  | { kind: "table"; caption: string; head: string[]; rows: string[][] }
  | { kind: "points"; caption: string; items: Point[]; ordered?: boolean }  // ordered=true → numbered 절차 markers
  | { kind: "subsec"; head: string; blocks: Block[]; heading?: boolean; num?: string }  // sub-heading (### or whole-line-bold) + its content, boxed as a card; `heading` (###) gets an X.Y number
  | { kind: "code"; code: string; lang: string }  // fenced ```lang code block → syntax-highlighted <pre><code>
  | { kind: "callout"; variant: CalloutVariant; title: string; blocks: Block[] }  // :::핵심/주의/팁/예시 or > quote → tinted box
  | { kind: "spoiler"; title: string; blocks: Block[] }  // :::정답 or <details> → collapsible reveal
  | { kind: "formula"; code: string }  // $$ … $$ → centered monospace formula card
  | { kind: "fig"; figure: Figure; trusted?: boolean };  // a figure placed inline; trusted=false (AI SVG) is sanitized
export type CalloutVariant = "key" | "warn" | "tip" | "example" | "quote";
// Callout label → variant. Bodies/AI write ":::주의" etc; unknown labels fall back to a neutral tip box.
export const CALLOUTS: Record<string, { variant: CalloutVariant; label: string }> = {
  "핵심": { variant: "key", label: "핵심" }, "정리": { variant: "key", label: "정리" }, "요약": { variant: "key", label: "요약" },
  "주의": { variant: "warn", label: "주의" }, "함정": { variant: "warn", label: "함정" }, "경고": { variant: "warn", label: "주의" },
  "팁": { variant: "tip", label: "팁" }, "참고": { variant: "tip", label: "참고" }, "노트": { variant: "tip", label: "참고" },
  "예시": { variant: "example", label: "예시" }, "예": { variant: "example", label: "예시" },
};
// ":::정답" 류 라벨 → 접이식 spoiler(정답/풀이 감추기).
export const SPOILERS: Record<string, string> = { "정답": "정답 보기", "답": "정답 보기", "풀이": "풀이 보기", "해설": "해설 보기" };
/** Extract {title, inner-markdown} from a raw <details>…</details> block the AI may emit. */
export function parseDetails(raw: string): { title: string; inner: string } {
  const sm = raw.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const title = (sm ? sm[1] : "").replace(/<[^>]+>/g, "").trim() || "정답 보기";
  const inner = raw.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "").replace(/<\/?details[^>]*>/gi, "").trim();
  return { title, inner };
}
export interface Step { title: string; blocks: Block[] }

export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// ── Markdown → inline HTML + body → steps ────────────────────────────────────
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Inline markdown: **bold**, `code`. Operates on already-escaped text. */
export function inlineMd(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="lh-cp-icode">$1</code>')
    .replace(/==([^=]+)==/g, '<mark class="lh-cp-mark">$1</mark>');
}
export function isTableSep(line: string | undefined): boolean {
  return !!line && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}
export function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
/** Split a bullet into {lead, text} on "**lead** — text" / "lead — text" / "lead: text". */
export function splitPoint(s: string): Point {
  let m = s.match(/^\*\*([^*]+)\*\*\s*[—:-]\s*(.+)$/);
  if (m) return { lead: m[1].trim(), text: m[2].trim() };
  m = s.match(/^([^—:]{1,24})\s*[—:]\s*(.+)$/);
  if (m) return { lead: m[1].trim(), text: m[2].trim() };
  return { lead: "", text: s.trim() };
}

export function isCaption(raw: string): boolean { return /[:：]\s*$/.test(raw.trim()); }
export function cleanCaption(raw: string): string { return raw.trim().replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim(); }

/** Map a concept area key to a default code language for untagged fences (```). */
export function areaLang(area?: string): string {
  return area === "clang" ? "c" : area === "python" ? "python" : area === "java" ? "java" : area === "sql" ? "sql" : "";
}
/** Parse a concept body (markdown) into a lead summary + numbered steps of ordered blocks.
 *  `defaultLang` colors untagged code fences (bodies often omit the language). */
export function parseBody(body: string, defaultLang = ""): { summary: string; steps: Step[] } {
  const lines = body.replace(/\r/g, "").split("\n");
  const steps: Step[] = [];
  const summaryParas: string[] = [];
  let cur: Step | null = null;
  // A whole-line-bold sub-heading opens a sub-section: following blocks nest inside it (a card),
  // until the next sub-heading or the next ## step. `target()` is where new blocks land.
  let curSub: { kind: "subsec"; head: string; blocks: Block[] } | null = null;
  let para: string[] = [];
  let pts: string[] = [];
  let ptsOrdered = false;  // whether the current list started with "1." (numbered) vs "-" (bullet)
  const ensure = (): Step => { if (!cur) { cur = { title: "", blocks: [] }; steps.push(cur); } return cur; };
  const target = (): Block[] => (curSub ? curSub.blocks : ensure().blocks);
  const popCaption = (): string => {
    const arr = curSub ? curSub.blocks : cur ? cur.blocks : null;
    if (arr && arr.length) {
      const last = arr[arr.length - 1];
      if (last.kind === "p" && isCaption(last.raw)) { arr.pop(); return cleanCaption(last.raw); }
    }
    return "";
  };
  const flushPara = (): void => {
    const text = para.join(" ").trim(); para = [];
    if (!text) return;
    const blk: Block = { kind: "p", html: inlineMd(escapeHtml(text)), raw: text };
    if (curSub) curSub.blocks.push(blk);
    else if (cur) cur.blocks.push(blk);
    else summaryParas.push(text);
  };
  const flushPts = (): void => {
    if (!pts.length) return;
    const items = pts.map(splitPoint); pts = [];
    const ordered = ptsOrdered; ptsOrdered = false;
    const caption = popCaption();
    target().push({ kind: "points", caption, items, ordered });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // fenced code block ```lang ... ``` → one code block (indentation preserved, no inline md)
    const fence = line.match(/^```+\s*([A-Za-z0-9+#_-]*)\s*$/);
    if (fence) {
      flushPts(); flushPara();
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      if (fence[1].toLowerCase() === "svg") target().push({ kind: "fig", figure: { svg: buf.join("\n"), caption: "" }, trusted: false });
      else target().push({ kind: "code", code: buf.join("\n"), lang: fence[1] || defaultLang });
      continue;
    }
    // callout / spoiler container ":::핵심 …" or ":::정답 …" … ":::" (inner content re-parsed)
    const cal = line.match(/^:::\s*(\S+)\s*(.*)$/);
    if (cal && cal[1] !== ":") {
      flushPts(); flushPara();
      const inner: string[] = []; i++;
      while (i < lines.length && lines[i].trim() !== ":::") { inner.push(lines[i]); i++; }
      const body = parseFlatBlocks(inner.join("\n"));
      if (SPOILERS[cal[1]]) target().push({ kind: "spoiler", title: cal[2].trim() || SPOILERS[cal[1]], blocks: body });
      else { const meta = CALLOUTS[cal[1]] ?? { variant: "tip" as CalloutVariant, label: cal[1] }; target().push({ kind: "callout", variant: meta.variant, title: cal[2].trim() || meta.label, blocks: body }); }
      continue;
    }
    // raw <details>…</details> the AI may emit → absorb into a collapsible spoiler (no tag leak)
    if (/^<details/i.test(line)) {
      flushPts(); flushPara();
      const buf: string[] = [lines[i]];
      while (!/<\/details>/i.test(buf[buf.length - 1]) && i + 1 < lines.length) { i++; buf.push(lines[i]); }
      const { title, inner } = parseDetails(buf.join("\n"));
      target().push({ kind: "spoiler", title, blocks: parseFlatBlocks(inner) });
      continue;
    }
    // formula "$$ … $$" (fenced on its own lines, or single-line "$$ x $$")
    const fm1 = line.match(/^\$\$\s*(.+?)\s*\$\$$/);
    if (line === "$$" || fm1) {
      flushPts(); flushPara();
      if (fm1) { target().push({ kind: "formula", code: fm1[1].trim() }); continue; }
      const buf: string[] = []; i++;
      while (i < lines.length && lines[i].trim() !== "$$") { buf.push(lines[i]); i++; }
      target().push({ kind: "formula", code: buf.join("\n").trim() });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPts(); flushPara();
      if (h[1].length >= 3) {
        // ### or deeper → a numbered sub-section (X.Y) nested in the current step
        const node: { kind: "subsec"; head: string; blocks: Block[]; heading: boolean } = { kind: "subsec", head: h[2].trim(), blocks: [], heading: true };
        ensure().blocks.push(node); curSub = node;
      } else {
        curSub = null; cur = { title: h[2].trim(), blocks: [] }; steps.push(cur);
      }
      continue;
    }
    if (!line) { flushPts(); flushPara(); continue; }
    // whole-line-bold ("**…**", not a "…:" caption, not a table row) → a sub-section heading (card)
    const ss = line.match(/^\*\*(.+?)\*\*$/);
    if (ss && !line.includes("|") && !isCaption(line)) {
      flushPts(); flushPara();
      const node: { kind: "subsec"; head: string; blocks: Block[] } = { kind: "subsec", head: ss[1].trim(), blocks: [] };
      ensure().blocks.push(node); curSub = node; continue;
    }
    if (line.includes("|") && isTableSep(lines[i + 1]?.trim())) {
      flushPts(); flushPara();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(splitRow(lines[i].trim())); i++; }
      i--;
      const caption = popCaption();
      if (head.length === 2) target().push({ kind: "terms", caption, rows: rows.map((r) => ({ term: r[0] ?? "", def: r[1] ?? "" })) });
      else target().push({ kind: "table", caption, head, rows });
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) { flushPara(); if (!pts.length) ptsOrdered = false; pts.push(b[1]); continue; }
    const ob = line.match(/^\d+\.\s+(.*)$/);
    if (ob) { flushPara(); if (!pts.length) ptsOrdered = true; pts.push(ob[1]); continue; }
    // blockquote "> …" (consecutive lines) → a quote callout
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPts(); flushPara();
      const buf: string[] = [q[1]];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1].trim())) { i++; buf.push(lines[i].trim().replace(/^>\s?/, "")); }
      target().push({ kind: "callout", variant: "quote", title: "", blocks: parseFlatBlocks(buf.join("\n")) });
      continue;
    }
    // a "**라벨**: …" note is its own item → close any open sub-section so it isn't nested inside it
    if (curSub && /^\*\*[^*]+\*\*\s*[:：]/.test(line)) { flushPts(); curSub = null; }
    flushPts(); para.push(line);
  }
  flushPts(); flushPara();
  return { summary: summaryParas.join(" "), steps: steps.filter((s) => s.title || s.blocks.length) };
}

/** Render one content block (paragraph / terms / table / points). */
export function renderBlock(blk: Block): HTMLElement {
  if (blk.kind === "p") { const d = el("div", "lh-cp-step-body"); d.innerHTML = blk.html; return d; }
  if (blk.kind === "head") { return el("div", "lh-cp-ai-h", blk.text); }
  if (blk.kind === "code") {
    const pre = el("pre", "lh-cp-codeblock");
    if (blk.lang) pre.dataset["lang"] = blk.lang;
    const code = el("code");
    code.innerHTML = highlightCode(blk.code, blk.lang);
    pre.appendChild(code);
    return pre;
  }
  if (blk.kind === "fig") { return renderFigure(blk.figure, blk.trusted !== false); }
  if (blk.kind === "callout") {
    const box = el("div", "lh-cp-callout lh-cp-callout--" + blk.variant);
    if (blk.title) box.appendChild(el("div", "lh-cp-callout-title", blk.title));
    const body = el("div", "lh-cp-callout-body");
    for (const b of blk.blocks) body.appendChild(renderBlock(b));
    box.appendChild(body);
    return box;
  }
  if (blk.kind === "spoiler") {
    const d = document.createElement("details");
    d.className = "lh-cp-spoiler";
    const sum = document.createElement("summary");
    sum.className = "lh-cp-spoiler-sum";
    sum.textContent = blk.title;
    d.appendChild(sum);
    const body = el("div", "lh-cp-spoiler-body");
    for (const b of blk.blocks) body.appendChild(renderBlock(b));
    d.appendChild(body);
    return d;
  }
  if (blk.kind === "formula") {
    const box = el("div", "lh-cp-formula");
    box.textContent = blk.code;
    return box;
  }
  if (blk.kind === "subsec") {
    const box = el("div", "lh-cp-subsec");
    const head = el("div", "lh-cp-subsec-head");
    if (blk.num) head.appendChild(el("span", "lh-cp-subsec-num", blk.num));
    else head.appendChild(el("span", "lh-cp-subsec-dot"));
    const ht = el("span", "lh-cp-subsec-title");
    ht.innerHTML = inlineMd(escapeHtml(blk.head));
    head.appendChild(ht);
    box.appendChild(head);
    const body = el("div", "lh-cp-subsec-body");
    for (const b of blk.blocks) body.appendChild(renderBlock(b));
    box.appendChild(body);
    return box;
  }
  if (blk.kind === "points") {
    const wrap = el("div", "lh-cp-pblock");
    if (blk.caption) wrap.appendChild(el("div", "lh-cp-block-cap", blk.caption));
    const ordered = !!blk.ordered;
    const ul = el(ordered ? "ol" : "ul", ordered ? "lh-cp-steps" : "lh-cp-points");
    let n = 0;
    for (const p of blk.items) {
      n += 1;
      const pl = el("li", ordered ? "lh-cp-stepitem" : "lh-cp-point");
      pl.appendChild(ordered ? el("span", "lh-cp-step-num", String(n)) : el("span", "lh-cp-point-dot", "●"));
      const tx = el("div", "lh-cp-point-text");
      tx.innerHTML = (p.lead ? `<strong>${escapeHtml(p.lead)}</strong><span class="lh-cp-point-dash"> — </span>` : "") + inlineMd(escapeHtml(p.text));
      pl.appendChild(tx); ul.appendChild(pl);
    }
    wrap.appendChild(ul); return wrap;
  }
  if (blk.kind === "terms") {
    const box = el("div", "lh-cp-terms");
    if (blk.caption) box.appendChild(el("div", "lh-cp-terms-cap", blk.caption));
    for (const t of blk.rows) {
      const r = el("div", "lh-cp-term");
      const k = el("span", "lh-cp-term-k"); k.innerHTML = inlineMd(escapeHtml(t.term)); r.appendChild(k);
      const dv = el("span", "lh-cp-term-d"); dv.innerHTML = inlineMd(escapeHtml(t.def)); r.appendChild(dv);
      box.appendChild(r);
    }
    return box;
  }
  const box = el("div", "lh-cp-vtable");
  if (blk.caption) box.appendChild(el("div", "lh-cp-vtable-cap", blk.caption));
  const cols = `repeat(${blk.head.length}, minmax(0, 1fr))`;
  const hr = el("div", "lh-cp-vtable-head"); hr.style.gridTemplateColumns = cols;
  for (const hc of blk.head) { const c = el("div", "lh-cp-vtable-h"); c.innerHTML = inlineMd(escapeHtml(hc)); hr.appendChild(c); }
  box.appendChild(hr);
  for (const row of blk.rows) {
    const rr = el("div", "lh-cp-vtable-row"); rr.style.gridTemplateColumns = cols;
    row.forEach((cv, ci) => { const cc = el("div", "lh-cp-vtable-c" + (ci === 0 ? " lh-cp-vtable-c0" : "")); cc.innerHTML = inlineMd(escapeHtml(cv)); rr.appendChild(cc); });
    box.appendChild(rr);
  }
  return box;
}

/** Parse AI-returned markdown into a flat block list (headings kept as 'head'; captions absorbed). */
export function parseFlatBlocks(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let pts: string[] = [];
  let ptsOrdered = false;
  const popCaption = (): string => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "p" && isCaption(last.raw)) { blocks.pop(); return cleanCaption(last.raw); }
    return "";
  };
  const flushPara = (): void => { const t = para.join(" ").trim(); para = []; if (t) blocks.push({ kind: "p", html: inlineMd(escapeHtml(t)), raw: t }); };
  const flushPts = (): void => { if (!pts.length) return; const items = pts.map(splitPoint); pts = []; const ordered = ptsOrdered; ptsOrdered = false; blocks.push({ kind: "points", caption: popCaption(), items, ordered }); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const fence = line.match(/^```+\s*([A-Za-z0-9+#_-]*)\s*$/);
    if (fence) {
      flushPts(); flushPara();
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      if (fence[1].toLowerCase() === "svg") blocks.push({ kind: "fig", figure: { svg: buf.join("\n"), caption: popCaption() }, trusted: false });
      else blocks.push({ kind: "code", code: buf.join("\n"), lang: fence[1] || "" });
      continue;
    }
    // raw inline <svg>…</svg> (AI may emit it directly) → sanitized figure
    if (/^<svg[\s>]/i.test(line)) {
      flushPts(); flushPara();
      const buf: string[] = [lines[i]];
      while (!/<\/svg>/i.test(buf[buf.length - 1]) && i + 1 < lines.length) { i++; buf.push(lines[i]); }
      blocks.push({ kind: "fig", figure: { svg: buf.join("\n"), caption: popCaption() }, trusted: false });
      continue;
    }
    const cal = line.match(/^:::\s*(\S+)\s*(.*)$/);
    if (cal && cal[1] !== ":") {
      flushPts(); flushPara();
      const inner: string[] = []; i++;
      while (i < lines.length && lines[i].trim() !== ":::") { inner.push(lines[i]); i++; }
      const body = parseFlatBlocks(inner.join("\n"));
      if (SPOILERS[cal[1]]) blocks.push({ kind: "spoiler", title: cal[2].trim() || SPOILERS[cal[1]], blocks: body });
      else { const meta = CALLOUTS[cal[1]] ?? { variant: "tip" as CalloutVariant, label: cal[1] }; blocks.push({ kind: "callout", variant: meta.variant, title: cal[2].trim() || meta.label, blocks: body }); }
      continue;
    }
    // raw <details>…</details> → collapsible spoiler (absorb the HTML so tags never leak as text)
    if (/^<details/i.test(line)) {
      flushPts(); flushPara();
      const buf: string[] = [lines[i]];
      while (!/<\/details>/i.test(buf[buf.length - 1]) && i + 1 < lines.length) { i++; buf.push(lines[i]); }
      const { title, inner } = parseDetails(buf.join("\n"));
      blocks.push({ kind: "spoiler", title, blocks: parseFlatBlocks(inner) });
      continue;
    }
    const fm1 = line.match(/^\$\$\s*(.+?)\s*\$\$$/);
    if (line === "$$" || fm1) {
      flushPts(); flushPara();
      if (fm1) { blocks.push({ kind: "formula", code: fm1[1].trim() }); continue; }
      const buf: string[] = []; i++;
      while (i < lines.length && lines[i].trim() !== "$$") { buf.push(lines[i]); i++; }
      blocks.push({ kind: "formula", code: buf.join("\n").trim() });
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flushPts(); flushPara(); blocks.push({ kind: "head", text: h[1].trim() }); continue; }
    if (!line) { flushPts(); flushPara(); continue; }
    if (line.includes("|") && isTableSep(lines[i + 1]?.trim())) {
      flushPts(); flushPara();
      const head = splitRow(line); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(splitRow(lines[i].trim())); i++; }
      i--;
      const caption = popCaption();
      if (head.length === 2) blocks.push({ kind: "terms", caption, rows: rows.map((r) => ({ term: r[0] ?? "", def: r[1] ?? "" })) });
      else blocks.push({ kind: "table", caption, head, rows });
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/); if (b) { flushPara(); if (!pts.length) ptsOrdered = false; pts.push(b[1]); continue; }
    const ob = line.match(/^\d+\.\s+(.*)$/); if (ob) { flushPara(); if (!pts.length) ptsOrdered = true; pts.push(ob[1]); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPts(); flushPara();
      const buf: string[] = [q[1]];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1].trim())) { i++; buf.push(lines[i].trim().replace(/^>\s?/, "")); }
      blocks.push({ kind: "callout", variant: "quote", title: "", blocks: parseFlatBlocks(buf.join("\n")) });
      continue;
    }
    flushPts(); para.push(line);
  }
  flushPts(); flushPara();
  return blocks;
}

/** Render AI markdown into the same component harness the concept body uses. */
export function renderAiBody(md: string): HTMLElement {
  const root = el("div", "lh-cp-ai-rich");
  for (const b of parseFlatBlocks(md)) root.appendChild(renderBlock(b));
  return root;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
export function blueLabel(text: string): HTMLElement {
  const w = el("div", "lh-cp-label");
  w.appendChild(el("span", "lh-cp-label-dot"));
  w.appendChild(el("span", "lh-cp-label-text", text));
  return w;
}

export function sanitizeSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || doc.getElementsByTagName("parsererror").length) return "";
    const walk = (node: Element): void => {
      const tag = node.nodeName.toLowerCase();
      if (tag === "script" || tag === "foreignobject") { node.remove(); return; }
      for (const attr of Array.from(node.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on")) node.removeAttribute(attr.name);
        else if ((n === "href" || n.endsWith(":href")) && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
      Array.from(node.children).forEach((c) => walk(c));
    };
    walk(root);
    if (root.nodeName.toLowerCase() !== "svg") return "";
    return new XMLSerializer().serializeToString(root);
  } catch { return ""; }
}
export function renderFigure(fig: Figure, trusted = true): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "lh-cp-fig";
  const frame = el("div", "lh-cp-fig-frame");
  frame.innerHTML = trusted ? fig.svg : sanitizeSvg(fig.svg);   // body figures trusted; AI SVG sanitized
  figure.appendChild(frame);
  if (fig.caption) { const cap = document.createElement("figcaption"); cap.className = "lh-cp-fig-cap"; cap.textContent = fig.caption; figure.appendChild(cap); }
  return figure;
}


/**
 * The notation an author must use so that `parseBody` renders it as components.
 *
 * One copy, because a dialect described in two prompts drifts in one of them and then the parser
 * silently agrees with neither. Anything about a particular screen -- how wide it is, whether it
 * wants figures -- belongs to the prompt that owns that screen, not here.
 */
export const DOC_DIALECT: string = [
  "[출력 형식] 아래 마크다운 표기만 쓴다. 화면이 이 표기를 컴포넌트로 렌더한다.",
  "- 소제목: '## 제목'",
  "- 핵심 항목 목록: '- **용어** — 설명'",
  "- 순서나 절차: '1. 2. 3.' 번호 목록(번호가 원으로 렌더된다)",
  "- 용어표(2열): '| 용어 | 설명 |'. 표 바로 앞 줄에 콜론(:)으로 끝나는 한 줄을 두면 표 제목이 된다",
  "- 비교표는 3열 이상으로 쓴다",
  "- 강조 박스: 새 줄에 ':::핵심' 또는 ':::주의' ':::팁' ':::예시' 로 열고, 다음 줄부터 내용을 쓰고, 마지막에 ':::' 한 줄로 닫는다",
  "- 인용이나 강조 문장: '> 문장'",
  "- 접어 두기: 새 줄에 ':::정답' 으로 열고 내용을 쓴 뒤 ':::' 로 닫으면 눌러서 펼치는 접이식이 된다",
  "- 공식/수식: '$$' 한 줄로 열고 수식을 쓴 뒤 '$$' 한 줄로 닫는다(또는 '$$ 수식 $$' 한 줄)",
  "- 코드: 삼중 백틱과 언어명으로 감싸면 구문 색상이 입혀진다",
  "- 문장 안 강조: '==중요==' (형광펜)",
  "원시 HTML 태그(<details>, <summary>, <br> 등)와 감싸는 중괄호는 쓰지 말고 위 표기만 사용한다.",
].join("\n");

/** The figure clause, kept apart: a narrow or small screen may not want figures at all. */
export const DOC_FIGURE_CLAUSE: string = [
  "[그림] 관계·구조·흐름·계층처럼 도식이 더 명확한 경우, SVG를 직접 그려 넣어라.",
  "- ```svg 코드펜스 안에 self-contained <svg>를 넣는다. viewBox를 지정하고, 외부 리소스나 스크립트는 금지.",
  "- 블록과 화살표와 한국어 라벨로 관계를 분명히 하고, 차분한 색(회색 테두리, 옅은 채움)을 쓰며, 텍스트가 겹치지 않게 배치.",
  "- 그림 바로 앞 줄에 콜론(:)으로 끝나는 한 줄을 두면 그림 캡션이 된다.",
].join("\n");
