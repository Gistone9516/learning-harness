// WHAT: the outline tab -- edit the curriculum doc that conceptprob reads at mount (N-11): add or remove
//       units and concept seeds, optionally ask the AI to propose concept titles for a unit.
// DEPS: web/src/ai/client, web/src/doc/doc, ./model (slugTerm), ./notebook (ctx type only).

import { el, stripFences } from "../../src/doc/doc";
import { slugTerm } from "./model";
import type { NotebookCtx } from "./notebook";

export interface OutlineArea { key: string; label: string; icon?: string; aliases?: string[] }
export interface OutlineSeed { concept_id: string; title: string; [k: string]: unknown }
export interface OutlineDoc { areas: OutlineArea[]; conceptOutline: Record<string, OutlineSeed[]> }

const PROPOSE_CONTRACT =
  "Return only a JSON array of short concept titles (strings), in study order, with no other text.";

/** A unique id from a base slug, suffixed -2, -3 … when taken. Always a valid state/card id. */
export function uniqueId(base: string, taken: ReadonlySet<string>, fallback: string): string {
  let root = (slugTerm(base) ?? "").slice(0, 56) || fallback;
  if (!/^[a-z]/.test(root)) root = "c-" + root;
  let id = root, n = 2;
  while (taken.has(id)) id = `${root}-${n++}`;
  return id;
}

/** Pull a string array out of a model reply, tolerating fences and prose. */
export function parseTitles(text: string): string[] {
  const t = stripFences(text ?? "");
  const start = t.indexOf("["), end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1)) as unknown;
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function mountOutline(root: HTMLElement, ctx: NotebookCtx) {
  const { L, store } = ctx;
  const docName = ctx.props.outline!.doc;
  const propose = ctx.props.outline!.propose;

  const wrap = el("div", "lh-nb-outline");
  const head = el("div", "lh-nb-outline-head");
  head.appendChild(el("h2", "lh-nb-outline-title", L.outlineTitle));
  head.appendChild(el("p", "lh-nb-outline-help", L.outlineHelp));
  const units = el("div", "lh-nb-units");
  const addRow = el("div", "lh-nb-addunit");
  const unitInput = document.createElement("input");
  unitInput.className = "lh-nb-input";
  unitInput.placeholder = L.unitName;
  unitInput.setAttribute("aria-label", L.unitName);
  const addBtn = el("button", "lh-nb-btn", "＋ " + L.addUnit);
  addBtn.type = "button";
  addRow.append(unitInput, addBtn);
  const foot = el("div", "lh-nb-outline-foot");
  const saveBtn = el("button", "lh-nb-btn lh-nb-btn--primary", L.save);
  saveBtn.type = "button";
  const msg = el("span", "lh-nb-outline-msg");
  msg.setAttribute("role", "status");
  foot.append(saveBtn, msg);
  wrap.append(head, units, addRow, foot);
  root.appendChild(wrap);

  let doc: OutlineDoc = { areas: [], conceptOutline: {} };
  const drafts = new Map<string, string>();   // unit key -> textarea text not yet folded in
  let dirty = false;

  function markDirty(): void { dirty = true; msg.textContent = ""; }

  function allIds(): Set<string> {
    return new Set(Object.values(doc.conceptOutline).flat().map((s) => s.concept_id));
  }

  function foldDrafts(): void {
    for (const [key, text] of drafts) {
      const titles = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const seeds = doc.conceptOutline[key] ?? (doc.conceptOutline[key] = []);
      const taken = allIds();
      for (const title of titles) {
        const id = uniqueId(`${key}-${title}`, taken, `${key}-c${seeds.length + 1}`);
        taken.add(id);
        seeds.push({ concept_id: id, title });
      }
    }
    drafts.clear();
  }

  function paint(): void {
    units.innerHTML = "";
    doc.areas.forEach((area) => {
      const box = el("div", "lh-nb-unit");
      const top = el("div", "lh-nb-unit-top");
      const name = document.createElement("input");
      name.className = "lh-nb-input lh-nb-unit-name";
      name.value = area.label;
      name.setAttribute("aria-label", L.unitName);
      name.addEventListener("input", () => { area.label = name.value; markDirty(); });
      const rm = el("button", "lh-nb-btn lh-nb-btn--quiet", L.removeUnit);
      rm.type = "button";
      rm.addEventListener("click", () => {
        if (!rm.dataset["armed"]) { rm.dataset["armed"] = "1"; rm.textContent = L.confirmDelete; rm.classList.add("lh-nb-btn--armed"); return; }
        doc.areas = doc.areas.filter((a) => a.key !== area.key);
        delete doc.conceptOutline[area.key];
        drafts.delete(area.key);
        markDirty(); paint();
      });
      top.append(name, rm);
      box.appendChild(top);

      const ul = el("ul", "lh-nb-seeds");
      for (const seed of doc.conceptOutline[area.key] ?? []) {
        const li = el("li", "lh-nb-seed");
        li.appendChild(el("span", "lh-nb-seed-title", seed.title));
        const x = el("button", "lh-nb-link", L.removeConcept);
        x.type = "button";
        x.addEventListener("click", () => {
          doc.conceptOutline[area.key] = (doc.conceptOutline[area.key] ?? []).filter((s) => s.concept_id !== seed.concept_id);
          markDirty(); paint();
        });
        li.appendChild(x);
        ul.appendChild(li);
      }
      box.appendChild(ul);

      const ta = document.createElement("textarea");
      ta.className = "lh-nb-input lh-nb-seed-input";
      ta.rows = 3;
      ta.placeholder = L.addConcepts;
      ta.setAttribute("aria-label", L.addConcepts);
      ta.value = drafts.get(area.key) ?? "";
      ta.addEventListener("input", () => { drafts.set(area.key, ta.value); markDirty(); });
      box.appendChild(ta);

      if (propose && ctx.ai) {
        const pb = el("button", "lh-nb-btn", L.propose);
        pb.type = "button";
        pb.addEventListener("click", async () => {
          pb.disabled = true; pb.textContent = L.proposing;
          const existing = (doc.conceptOutline[area.key] ?? []).map((s) => s.title);
          const res = await ctx.ai!.ai({
            system: `${propose.system}\n\n${PROPOSE_CONTRACT}`,
            prompt: [`[Unit] ${area.label}`, existing.length ? `[Already listed]\n${existing.join("\n")}` : "", ta.value.trim() ? `[Learner notes]\n${ta.value.trim()}` : ""].filter(Boolean).join("\n\n"),
            model: propose.model,
            effort: "medium",
          });
          pb.disabled = false; pb.textContent = L.propose;
          const titles = res.ok ? parseTitles(res.text).filter((t) => !existing.includes(t)) : [];
          if (!titles.length) { msg.textContent = res.ok ? L.saveFailed : `${L.aiError}: ${res.error ?? "?"}`; return; }
          ta.value = [ta.value.trim(), ...titles].filter(Boolean).join("\n");
          drafts.set(area.key, ta.value);
          markDirty();
        });
        box.appendChild(pb);
      }
      units.appendChild(box);
    });
  }

  async function load(): Promise<void> {
    if (dirty) return;   // keep unsaved edits when the tab is revisited
    const d = await store.getDoc<OutlineDoc>(docName);
    doc = d && Array.isArray(d.areas) ? { areas: d.areas, conceptOutline: d.conceptOutline ?? {} } : { areas: [], conceptOutline: {} };
    drafts.clear();
    paint();
  }

  addBtn.addEventListener("click", () => {
    const label = unitInput.value.trim();
    if (!label) return;
    const key = uniqueId(label, new Set(doc.areas.map((a) => a.key)), `u${doc.areas.length + 1}`);
    doc.areas.push({ key, label });
    doc.conceptOutline[key] = [];
    unitInput.value = "";
    markDirty(); paint();
  });
  unitInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });

  saveBtn.addEventListener("click", async () => {
    foldDrafts();
    const ok = await store.putDoc(docName, doc);
    msg.textContent = ok ? L.saved : L.saveFailed;
    if (ok) dirty = false;
    paint();
  });

  return { load };
}
