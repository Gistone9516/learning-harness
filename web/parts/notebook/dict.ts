// WHAT: the dictionary tab -- search, filter and sort the term index (N-9), and a detail view with
//       senses, examples, the threads a term came from, and known / delete / ask actions.
// DEPS: web/src/doc/doc, ./model, ./store, ./notebook (ctx type only).

import { el, escapeHtml, inlineMd } from "../../src/doc/doc";
import { termSummary, type TermData } from "./model";
import type { TermEntry } from "./store";
import type { NotebookCtx } from "./notebook";

type Sort = "recent" | "lookups" | "alpha";

export function mountDict(root: HTMLElement, ctx: NotebookCtx) {
  const { L, store } = ctx;

  const side = el("aside", "lh-nb-dict-side");
  const tools = el("div", "lh-nb-dict-tools");
  const search = document.createElement("input");
  search.type = "search";
  search.className = "lh-nb-input lh-nb-search";
  search.placeholder = L.dictSearch;
  search.setAttribute("aria-label", L.dictSearch);
  const filters = el("div", "lh-nb-filters");
  const sortSel = document.createElement("select");
  sortSel.className = "lh-nb-input lh-nb-select";
  sortSel.setAttribute("aria-label", L.sortRecent);
  for (const [v, t] of [["recent", L.sortRecent], ["lookups", L.sortLookups], ["alpha", L.sortAlpha]] as const) {
    const o = document.createElement("option"); o.value = v; o.textContent = t; sortSel.appendChild(o);
  }
  const knownLbl = el("label", "lh-nb-check");
  const knownCb = document.createElement("input");
  knownCb.type = "checkbox";
  knownLbl.append(knownCb, document.createTextNode(" " + L.includeKnown));
  const row2 = el("div", "lh-nb-dict-row");
  row2.append(sortSel, knownLbl);
  tools.append(search, filters, row2);
  const list = el("ul", "lh-nb-term-list");
  side.append(tools, list);
  const detail = el("div", "lh-nb-detail");
  root.append(side, detail);

  let entries: TermEntry[] = [];
  let typeFilter = "all";
  let openId: string | null = null;

  const typeKeys = ["all", "word", "phrase", "acronym"];
  const filterBtns = typeKeys.map((k) => {
    const b = el("button", "lh-nb-filter", k === "all" ? L.filterAll : (L.types[k] ?? k));
    b.type = "button";
    b.addEventListener("click", () => { typeFilter = k; paintFilters(); paintList(); });
    filters.appendChild(b);
    return { k, b };
  });
  function paintFilters(): void {
    for (const { k, b } of filterBtns) {
      b.classList.toggle("lh-nb-filter--on", k === typeFilter);
      b.setAttribute("aria-pressed", String(k === typeFilter));
    }
  }

  function visible(): TermEntry[] {
    const q = search.value.trim().toLowerCase();
    const sort = sortSel.value as Sort;
    const out = entries.filter((e) => {
      const s = e.summary;
      if (!knownCb.checked && s.known) return false;
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (!q) return true;
      return String(s.headword ?? "").toLowerCase().includes(q) || String(s.gloss ?? "").toLowerCase().includes(q);
    });
    out.sort((a, b) =>
      sort === "alpha" ? String(a.summary.headword).localeCompare(String(b.summary.headword))
        : sort === "lookups" ? b.summary.lookups - a.summary.lookups || b.summary.last_seen - a.summary.last_seen
        : b.summary.last_seen - a.summary.last_seen);
    return out;
  }

  function paintList(): void {
    list.innerHTML = "";
    const shown = visible();
    if (!shown.length) { list.appendChild(el("li", "lh-nb-empty", L.dictEmpty)); return; }
    for (const e of shown) {
      const s = e.summary;
      const li = el("li");
      const b = el("button", "lh-nb-term" + (e.id === openId ? " lh-nb-term--on" : "") + (s.known ? " lh-nb-term--known" : ""));
      b.type = "button";
      const top = el("span", "lh-nb-term-top");
      top.appendChild(el("span", "lh-nb-term-head", String(s.headword)));
      top.appendChild(el("span", "lh-nb-badge", L.types[s.type] ?? s.type));
      if (s.lookups > 1) top.appendChild(el("span", "lh-nb-term-count", `×${s.lookups}`));
      b.appendChild(top);
      if (s.gloss) b.appendChild(el("span", "lh-nb-term-gloss", String(s.gloss)));
      b.addEventListener("click", () => void open(e.id));
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  function section(label: string): HTMLElement {
    const s = el("div", "lh-nb-sec");
    s.appendChild(el("h3", "lh-nb-sec-h", label));
    return s;
  }

  async function open(id: string): Promise<void> {
    openId = id;
    paintList();
    const d = await store.getTerm(id);
    detail.innerHTML = "";
    if (!d) { detail.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", L.dictEmpty)); return; }
    paintDetail(id, d);
  }

  function paintDetail(id: string, d: TermData): void {
    detail.innerHTML = "";
    const head = el("div", "lh-nb-detail-head");
    const h = el("h2", "lh-nb-detail-word", d.headword);
    head.appendChild(h);
    const sub = el("div", "lh-nb-detail-sub");
    sub.appendChild(el("span", "lh-nb-badge", L.types[d.type] ?? d.type));
    if (d.pos) sub.appendChild(el("span", "lh-nb-pos", d.pos));
    if (d.ipa) sub.appendChild(el("span", "lh-nb-ipa", d.ipa));
    if (d.known) sub.appendChild(el("span", "lh-nb-badge lh-nb-badge--ok", L.known));
    head.appendChild(sub);
    detail.appendChild(head);

    if (d.expansion) {
      const s = section(L.expansion);
      s.appendChild(el("p", "lh-nb-expansion", d.expansion));
      detail.appendChild(s);
    }
    if (d.senses.length) {
      const s = section(L.senses);
      const ol = el("ol", "lh-nb-senses");
      for (const sense of d.senses) {
        const li = el("li");
        if (sense.domain) li.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", L.domains[sense.domain] ?? sense.domain));
        const g = el("span"); g.innerHTML = inlineMd(escapeHtml(sense.gloss)); li.appendChild(g);
        ol.appendChild(li);
      }
      s.appendChild(ol);
      detail.appendChild(s);
    }
    if (d.examples.length) {
      const s = section(L.examples);
      for (const ex of d.examples) {
        const box = el("div", "lh-nb-example");
        box.appendChild(el("p", "lh-nb-example-en", ex.en));
        if (ex.ko) box.appendChild(el("p", "lh-nb-example-ko", ex.ko));
        if (ex.thread) {
          const b = el("button", "lh-nb-link", L.threadsOf + " →");
          b.type = "button";
          b.addEventListener("click", () => ctx.openThread(ex.thread!));
          box.appendChild(b);
        }
        s.appendChild(box);
      }
      detail.appendChild(s);
    }
    if (d.related.length) {
      const s = section(L.related);
      const chips = el("div", "lh-nb-chips");
      const known = new Map(entries.map((e) => [String(e.summary.headword).toLowerCase(), e.id]));
      for (const r of d.related) {
        const target = known.get(r.toLowerCase());
        const c = el(target ? "button" : "span", "lh-nb-chip" + (target ? "" : " lh-nb-chip--flat"), r);
        if (target) c.addEventListener("click", () => void open(target));
        chips.appendChild(c);
      }
      s.appendChild(chips);
      detail.appendChild(s);
    }
    if (d.threads.length) {
      const s = section(L.threadsOf);
      const ul = el("ul", "lh-nb-thread-refs");
      void store.listThreads().then((all) => {
        const titles = new Map(all.map((t) => [t.id, String(t.summary.title ?? t.id)]));
        for (const tid of d.threads) {
          if (!titles.has(tid)) continue;
          const li = el("li");
          const b = el("button", "lh-nb-link", titles.get(tid)!);
          b.type = "button";
          b.addEventListener("click", () => ctx.openThread(tid));
          li.appendChild(b);
          ul.appendChild(li);
        }
      });
      s.appendChild(ul);
      detail.appendChild(s);
    }

    const meta = el("p", "lh-nb-meta",
      `${L.lookups} ${d.lookups} · ${L.box} ${d.srs.box} · ${L.nextDue} ${new Date(d.srs.due_at).toLocaleDateString()}`);
    detail.appendChild(meta);

    const actions = el("div", "lh-nb-actions");
    const knownBtn = el("button", "lh-nb-btn", d.known ? L.unmarkKnown : L.markKnown);
    knownBtn.type = "button";
    knownBtn.addEventListener("click", async () => {
      const next: TermData = { ...d, known: !d.known };
      if (await store.putTerm(id, next)) {
        const e = entries.find((x) => x.id === id);
        if (e) Object.assign(e.summary, termSummary(next));
        paintList(); paintDetail(id, next); ctx.refreshCounts();
      }
    });
    const askBtn = el("button", "lh-nb-btn", L.askAbout);
    askBtn.type = "button";
    askBtn.addEventListener("click", () => ctx.prefillAsk(d.headword));
    const delBtn = el("button", "lh-nb-btn lh-nb-btn--quiet", L.deleteTerm);
    delBtn.type = "button";
    delBtn.addEventListener("click", async () => {
      if (!delBtn.dataset["armed"]) { delBtn.dataset["armed"] = "1"; delBtn.textContent = L.confirmDelete; delBtn.classList.add("lh-nb-btn--armed"); return; }
      if (await store.removeTerm(id)) {
        entries = entries.filter((x) => x.id !== id);
        openId = null; detail.innerHTML = "";
        detail.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", L.dictPick));
        paintList(); ctx.refreshCounts();
      }
    });
    actions.append(knownBtn, askBtn);
    const use = ctx.props.useTerm;
    if (use) {
      const useBtn = el("button", "lh-nb-btn", use.label);
      useBtn.type = "button";
      useBtn.addEventListener("click", () => use.run(d.headword));
      actions.appendChild(useBtn);
    }
    actions.appendChild(delBtn);
    detail.appendChild(actions);
  }

  async function refresh(): Promise<void> {
    entries = await store.listTerms();
    paintList();
    if (openId && entries.some((e) => e.id === openId)) await open(openId);
    else if (!openId) { detail.innerHTML = ""; detail.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", L.dictPick)); }
  }

  search.addEventListener("input", paintList);
  sortSel.addEventListener("change", paintList);
  knownCb.addEventListener("change", paintList);
  paintFilters();

  return {
    refresh,
    open(id: string): void {
      openId = id;
      void refresh();
    },
  };
}
