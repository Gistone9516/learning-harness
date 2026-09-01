// One renderer per component, kept in a registry so a new component never touches an existing one.
//
// House style follows the design spec: spacing carries the hierarchy, and only a few components
// earn a background or a border (concept card, code reference, caution, quiz). Everything else is
// a label and text. The panel is narrow, so tables stay at two columns and code scrolls sideways.

import type { Block, CodeRef, Composed } from "./types";

/** What a renderer may ask the surrounding app to do. */
export interface RenderContext {
  /** Jump the code panel to a location. Absent when navigation is not possible (offline read). */
  navigate?: (path: string, lines?: [number, number]) => void;
  /** Path of the file on screen, so a `focus` block knows what it refers to. */
  currentPath?: string;
  /** True when the location exists in the project; a reference to nothing renders as plain text. */
  exists?: (path: string, lines?: [number, number]) => boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function label(text: string): HTMLElement {
  return el("div", "lh-cb-label", text);
}

function whereText(lines?: [number, number]): string {
  if (!lines) return "";
  return lines[0] === lines[1] ? `${lines[0]}행` : `${lines[0]}-${lines[1]}행`;
}

/** A code location as a chip. Falls back to plain text when the target does not exist. */
function refChip(ref: CodeRef, ctx: RenderContext, extraClass = ""): HTMLElement {
  const usable = ctx.navigate && (!ctx.exists || ctx.exists(ref.path, ref.lines));
  const where = whereText(ref.lines);
  const text = where ? `${ref.path} ${where}` : ref.path;

  if (!usable) {
    const span = el("span", `lh-cb-ref-flat ${extraClass}`.trim(), text);
    return span;
  }
  const btn = el("button", `lh-cb-ref ${extraClass}`.trim());
  btn.appendChild(el("span", "lh-cb-ref-path", text));
  if (ref.note) btn.appendChild(el("span", "lh-cb-ref-note", ref.note));
  btn.addEventListener("click", () => ctx.navigate?.(ref.path, ref.lines));
  return btn;
}

type Renderer = (block: Block, ctx: RenderContext) => HTMLElement;

const RENDERERS: { [K in Block["t"]]: (b: Extract<Block, { t: K }>, ctx: RenderContext) => HTMLElement } = {
  // ── skeleton ──
  lead: (b) => el("p", "lh-cb-lead", b.text),
  answer: (b) => el("p", "lh-cb-answer", b.text),
  text: (b) => el("p", "lh-cb-text", b.text),
  list: (b) => {
    const ul = el("ul", "lh-cb-list");
    for (const item of b.items) ul.appendChild(el("li", "", item));
    return ul;
  },
  steps: (b) => {
    const ol = el("ol", "lh-cb-steps");
    for (const item of b.items) {
      const li = el("li");
      li.appendChild(el("span", "lh-cb-step-title", item.title));
      if (item.text) li.appendChild(el("span", "lh-cb-step-text", item.text));
      ol.appendChild(li);
    }
    return ol;
  },

  // ── code-linked ──
  ref: (b, ctx) => {
    const box = el("div", "lh-cb-refbox");
    box.appendChild(refChip(b, ctx, "lh-cb-ref-block"));
    return box;
  },
  focus: (b, ctx) => {
    const box = el("div", "lh-cb-refbox");
    box.appendChild(refChip({ path: ctx.currentPath ?? "", lines: b.lines, note: b.note }, ctx, "lh-cb-ref-block"));
    return box;
  },
  signature: (b) => {
    const box = el("div", "lh-cb-sig");
    box.appendChild(el("code", "lh-cb-sig-line", b.sig));
    if (b.params?.length) {
      const dl = el("dl", "lh-cb-params");
      for (const p of b.params) {
        dl.appendChild(el("dt", "", p.name));
        dl.appendChild(el("dd", "", p.desc));
      }
      box.appendChild(dl);
    }
    if (b.returns) {
      const ret = el("div", "lh-cb-returns");
      ret.appendChild(el("span", "lh-cb-mini-label", "반환"));
      ret.appendChild(el("span", "", b.returns));
      box.appendChild(ret);
    }
    return box;
  },
  io: (b) => {
    const box = el("div", "lh-cb-io");
    for (const [name, value] of [["입력", b.input], ["출력", b.output]] as const) {
      const cell = el("div", "lh-cb-io-cell");
      cell.appendChild(el("span", "lh-cb-mini-label", name));
      cell.appendChild(el("span", "", value));
      box.appendChild(cell);
    }
    return box;
  },
  calls: (b, ctx) => {
    const box = el("div", "lh-cb-calls");
    const side = (name: string, refs?: CodeRef[]) => {
      if (!refs?.length) return;
      const group = el("div", "lh-cb-calls-side");
      group.appendChild(el("span", "lh-cb-mini-label", name));
      const list = el("div", "lh-cb-chiprow");
      for (const r of refs) list.appendChild(refChip(r, ctx));
      group.appendChild(list);
      box.appendChild(group);
    };
    side("호출하는 쪽", b.callers);
    side("호출되는 쪽", b.callees);
    return box;
  },
  flow: (b, ctx) => {
    const ol = el("ol", "lh-cb-flow");
    for (const item of b.items) {
      const li = el("li");
      li.appendChild(el("span", "lh-cb-step-title", item.title));
      if (item.text) li.appendChild(el("span", "lh-cb-step-text", item.text));
      if (item.path) {
        const row = el("div", "lh-cb-chiprow");
        row.appendChild(refChip({ path: item.path, lines: item.lines }, ctx));
        li.appendChild(row);
      }
      ol.appendChild(li);
    }
    return ol;
  },
  alt: (b) => {
    const box = el("div", "lh-cb-alt");
    for (const [kind, side] of [["현재", b.current], ["대안", b.other]] as const) {
      const cell = el("div", "lh-cb-alt-cell");
      cell.appendChild(el("span", "lh-cb-mini-label", kind));
      cell.appendChild(el("div", "lh-cb-alt-title", side.title));
      cell.appendChild(el("div", "lh-cb-alt-text", side.text));
      box.appendChild(cell);
    }
    return box;
  },

  // ── concepts ──
  concept: (b) => {
    const card = el("div", "lh-cb-concept");
    card.appendChild(el("div", "lh-cb-concept-name", b.name));
    const parts: [string, string][] = [
      ["개념", b.definition],
      ["일반 응용", b.general],
      ["실무 사례", b.industry],
      ["이 프로젝트에서의 사용", b.here],
    ];
    for (const [name, body] of parts) {
      if (!body) continue;
      const part = el("div", "lh-cb-concept-part");
      part.appendChild(label(name));
      part.appendChild(el("p", "", body));
      card.appendChild(part);
    }
    return card;
  },
  tag: (b) => {
    const row = el("div", "lh-cb-chiprow");
    for (const name of b.names) row.appendChild(el("span", "lh-cb-tag", name));
    return row;
  },
  terms: (b) => {
    const dl = el("dl", "lh-cb-terms");
    for (const item of b.items) {
      dl.appendChild(el("dt", "", item.term));
      dl.appendChild(el("dd", "", item.def));
    }
    return dl;
  },
  compare: (b) => {
    // The panel is narrow: past two columns a table stops being readable, so it becomes a list.
    if (b.headers.length > 2) {
      const box = el("div", "lh-cb-compare-stack");
      for (const row of b.rows) {
        const group = el("div", "lh-cb-compare-group");
        row.forEach((cell, i) => {
          const line = el("div", "lh-cb-compare-line");
          line.appendChild(el("span", "lh-cb-mini-label", b.headers[i] ?? ""));
          line.appendChild(el("span", "", cell));
          group.appendChild(line);
        });
        box.appendChild(group);
      }
      return box;
    }
    const table = el("table", "lh-cb-compare");
    const head = el("tr");
    for (const h of b.headers) head.appendChild(el("th", "", h));
    table.appendChild(head);
    for (const row of b.rows) {
      const tr = el("tr");
      for (const cell of row) tr.appendChild(el("td", "", cell));
      table.appendChild(tr);
    }
    return table;
  },
  caution: (b) => {
    const box = el("div", "lh-cb-caution");
    box.appendChild(el("span", "lh-cb-mini-label", "주의"));
    box.appendChild(el("span", "", b.text));
    return box;
  },
  why: (b) => {
    const box = el("div", "lh-cb-why");
    box.appendChild(el("div", "lh-cb-why-decision", b.decision));
    box.appendChild(el("div", "lh-cb-why-reason", b.reason));
    return box;
  },

  // ── learning aids ──
  quiz: (b) => {
    const box = el("div", "lh-cb-quiz");
    box.appendChild(label("확인 질문"));
    for (const item of b.items) {
      const details = document.createElement("details");
      details.className = "lh-cb-quiz-item";
      const summary = document.createElement("summary");
      summary.textContent = item.q;
      details.appendChild(summary);
      details.appendChild(el("div", "lh-cb-quiz-answer", item.a));
      box.appendChild(details);
    }
    return box;
  },
  findit: (b, ctx) => {
    const box = el("div", "lh-cb-quiz");
    box.appendChild(label("직접 찾기"));
    const details = document.createElement("details");
    details.className = "lh-cb-quiz-item";
    const summary = document.createElement("summary");
    summary.textContent = b.q;
    details.appendChild(summary);
    const answer = el("div", "lh-cb-quiz-answer");
    answer.appendChild(refChip(b.answer, ctx));
    details.appendChild(answer);
    box.appendChild(details);
    if (b.hint) box.appendChild(el("div", "lh-cb-hint", b.hint));
    return box;
  },
  next: (b, ctx) => {
    const box = el("div", "lh-cb-next");
    box.appendChild(label("다음 단계"));
    const row = el("div", "lh-cb-chiprow");
    for (const item of b.items) {
      if (item.path) {
        row.appendChild(refChip({ path: item.path, lines: item.lines, note: item.label }, ctx));
      } else {
        row.appendChild(el("span", "lh-cb-tag", item.label));
      }
    }
    box.appendChild(row);
    return box;
  },
  related: (b, ctx) => {
    const box = el("div", "lh-cb-next");
    box.appendChild(label("관련 위치"));
    const row = el("div", "lh-cb-chiprow");
    for (const r of b.items) row.appendChild(refChip(r, ctx));
    box.appendChild(row);
    return box;
  },

  // ── trust ──
  evidence: (b, ctx) => {
    const box = el("div", "lh-cb-evidence");
    box.appendChild(el("span", "", b.text));
    if (b.path) {
      const row = el("div", "lh-cb-chiprow");
      row.appendChild(refChip({ path: b.path, lines: b.lines }, ctx));
      box.appendChild(row);
    }
    return box;
  },
  uncertain: (b) => {
    const box = el("div", "lh-cb-uncertain");
    box.appendChild(el("span", "lh-cb-mini-label", "확실하지 않음"));
    box.appendChild(el("span", "", b.text));
    return box;
  },
};

/** Render one block. Unknown types never reach here; parse.ts turns them into text. */
export function renderBlock(block: Block, ctx: RenderContext): HTMLElement {
  const renderer = RENDERERS[block.t] as Renderer | undefined;
  if (!renderer) return el("p", "lh-cb-text", JSON.stringify(block));
  return renderer(block, ctx);
}

/** Render a whole composed answer into a container. */
export function renderComposed(composed: Composed, ctx: RenderContext): HTMLElement {
  const wrap = el("div", "lh-cb");
  for (const block of composed.blocks) wrap.appendChild(renderBlock(block, ctx));
  return wrap;
}
