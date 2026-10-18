// WHAT: the bank tab -- totals and per-unit accuracy, per-concept counts with "generate 5" and "drill",
//       and "fill unit" for concepts below the target (Q-5, Q-8). Generated problems land in the state API.
// DEPS: web/src/doc/doc, ./model, ./quiz (ctx type only).

import { el } from "../../src/doc/doc";
import { coerceQuizProblem, deletionFeedback, stemOf, unitStats, type FrontKo, type QuizProblem } from "./model";
import type { QuizCtx } from "./quiz";

export function mountBank(root: HTMLElement, ctx: QuizCtx) {
  const { L } = ctx;
  const wrap = el("div", "lh-qz-bank");
  root.appendChild(wrap);
  let busy = false;
  let lastMsg = "";   // survives the repaint that follows a generation

  async function generate(area: string, conceptId: string, count = 5): Promise<{ ok: boolean; added: number; error?: string }> {
    if (!ctx.ai) return { ok: false, added: 0, error: L.aiOff };
    const set = await ctx.getSet(conceptId);
    const current = ctx.bank().filter((p) => p.concept_id === conceptId);
    const allIds = current.map((p) => p.card_id).concat(Object.keys(ctx.log().items));
    const res = await ctx.ai.problems({
      concept: { area, concept_id: conceptId, title: ctx.conceptTitle(conceptId), body: ctx.conceptBody(conceptId) },
      existing: current.map((p) => stemOf(p.front as FrontKo)).filter(Boolean),
      feedback: deletionFeedback(ctx.log(), allIds),
      count,
      course_title: ctx.props.courseTitle,
      ...(ctx.props.problemStyle ? { style: ctx.props.problemStyle } : {}),
    });
    if (!res.ok) return { ok: false, added: 0, error: res.error ?? L.genFail };
    const have = new Set(set.generated.map((p) => p.card_id));
    const add = res.problems.map((r) => coerceQuizProblem(r, area, conceptId)).filter((p): p is QuizProblem => !!p && !have.has(p.card_id));
    if (!add.length) return { ok: false, added: 0, error: L.genFail };
    await ctx.putSet(conceptId, { ...set, generated: set.generated.concat(add) });
    return { ok: true, added: add.length };
  }

  function refresh(): void {
    wrap.innerHTML = "";
    const bank = ctx.bank();
    const log = ctx.log();
    const stats = unitStats(bank, log);
    let total = 0, seen = 0, correct = 0, attempts = 0;
    for (const s of stats.values()) { total += s.total; seen += s.seen; correct += s.correct; attempts += s.attempts; }

    const head = el("div", "lh-qz-stats");
    const tile = (k: string, v: string) => { const t = el("div", "lh-qz-tile"); t.appendChild(el("span", "lh-qz-tile-v", v)); t.appendChild(el("span", "lh-qz-tile-k", k)); return t; };
    head.append(
      tile(L.bankTotal, String(total)),
      tile(L.bankSeen, total ? `${seen} (${Math.round((seen / total) * 100)}%)` : "0"),
      tile(L.bankAccuracy, attempts ? `${Math.round((correct / attempts) * 100)}%` : "—"),
    );
    wrap.appendChild(head);
    if (!ctx.ai) wrap.appendChild(el("p", "lh-nb-hint", L.aiOff));
    const msg = el("p", "lh-nb-hint lh-qz-msg"); msg.setAttribute("role", "status");
    msg.textContent = lastMsg;
    wrap.appendChild(msg);

    const target = ctx.props.fillTarget ?? 5;
    for (const area of ctx.outline().areas) {
      const seeds = ctx.outline().conceptOutline[area.key] ?? [];
      const s = stats.get(area.key);
      const sec = el("section", "lh-qz-unit");
      const top = el("div", "lh-qz-unit-top");
      top.appendChild(el("h3", "lh-qz-unit-title", area.label));
      top.appendChild(el("span", "lh-nb-hint", s ? `${s.total} · ${L.bankAccuracy} ${s.attempts ? Math.round((s.correct / s.attempts) * 100) + "%" : "—"}` : "0"));
      const fill = el("button", "lh-nb-btn", L.fillUnit); fill.type = "button";
      fill.disabled = !ctx.ai || busy;
      fill.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        const need = seeds.filter((sd) => ctx.bank().filter((p) => p.concept_id === sd.concept_id).length < target);
        let k = 0;
        for (const sd of need) {
          msg.textContent = `${L.filling} ${++k}/${need.length} · ${sd.title}`;
          const r = await generate(area.key, sd.concept_id);
          if (!r.ok) lastMsg = msg.textContent = `${sd.title}: ${r.error ?? L.genFail}`;
        }
        busy = false;
        await ctx.reload();
        refresh();
      });
      top.appendChild(fill);
      sec.appendChild(top);

      const ul = el("ul", "lh-qz-concepts");
      for (const sd of seeds) {
        const probs = bank.filter((p) => p.concept_id === sd.concept_id);
        const hs = probs.map((p) => log.items[p.card_id]?.h ?? []);
        const att = hs.reduce((n, h) => n + h.length, 0);
        const cor = hs.reduce((n, h) => n + h.filter((v) => v === "c").length, 0);
        const li = el("li", "lh-qz-concept-row");
        li.appendChild(el("span", "lh-qz-concept-title", sd.title));
        li.appendChild(el("span", "lh-qz-concept-n", `${probs.length}`));
        li.appendChild(el("span", "lh-qz-concept-acc", att ? `${Math.round((cor / att) * 100)}%` : "—"));
        const drill = el("button", "lh-nb-btn", L.drill); drill.type = "button";
        drill.style.visibility = probs.length ? "" : "hidden";   // keeps the column aligned without a dead button
        drill.addEventListener("click", () => ctx.drill(probs.map((p) => p.card_id)));
        // An empty concept is where generating matters; on a populated one the button steps back.
        const gen = el("button", "lh-nb-btn" + (probs.length ? " lh-nb-btn--quiet" : ""), L.generate); gen.type = "button";
        gen.disabled = !ctx.ai || busy;
        gen.addEventListener("click", async () => {
          if (busy) return;
          busy = true; gen.textContent = L.generating; gen.disabled = true;
          const r = await generate(area.key, sd.concept_id);
          busy = false;
          lastMsg = msg.textContent = r.ok ? `${sd.title}: +${r.added}` : `${sd.title}: ${r.error ?? L.genFail}`;
          await ctx.reload();
          refresh();
        });
        li.append(drill, gen);
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      wrap.appendChild(sec);
    }
  }

  return { refresh };
}
