// WHAT: the ask tab -- thread list on the left, the open conversation on the right. Each send saves the
//       question first (N-2), calls /ai (resuming the thread's session, N-3), then stores the reply and
//       captures its terms (N-4, N-5).
// DEPS: web/src/ai/client, web/src/doc/doc, ./model, ./notebook (ctx type only).

import { AiSession, type AiResponse } from "../../src/ai/client";
import { el, renderAiBody } from "../../src/doc/doc";
import {
  ASK_CONTRACT, curriculumText, fallbackTitle, parseReply, savedTermsBlock, slugTerm, threadId, transcript,
  type ThreadData, type Turn,
} from "./model";
import type { ThreadEntry } from "./store";
import type { NotebookCtx } from "./notebook";

export function mountAsk(root: HTMLElement, ctx: NotebookCtx) {
  const { L, store } = ctx;

  const side = el("aside", "lh-nb-threads");
  const newBtn = el("button", "lh-nb-btn lh-nb-btn--primary lh-nb-new", "＋ " + L.newThread);
  newBtn.type = "button";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "lh-nb-input lh-nb-search";
  search.placeholder = L.threadSearch;
  search.setAttribute("aria-label", L.threadSearch);
  const list = el("ul", "lh-nb-thread-list");
  side.append(newBtn, search, list);

  const conv = el("div", "lh-nb-conv");
  const head = el("div", "lh-nb-conv-head");
  const title = el("h2", "lh-nb-conv-title");
  const delBtn = el("button", "lh-nb-btn lh-nb-btn--quiet", L.deleteThread);
  delBtn.type = "button";
  head.append(title, delBtn);
  const msgs = el("div", "lh-nb-msgs");
  msgs.setAttribute("aria-live", "polite");
  const composer = el("div", "lh-nb-composer");
  const input = document.createElement("textarea");
  input.className = "lh-nb-input lh-nb-ask-input";
  input.rows = 3;
  input.setAttribute("aria-label", L.askPlaceholder);
  const sendBtn = el("button", "lh-nb-btn lh-nb-btn--primary", L.send);
  sendBtn.type = "button";
  const sendCol = el("div", "lh-nb-send");
  sendCol.append(sendBtn, el("span", "lh-nb-hint", L.sendHint));
  composer.append(input, sendCol);
  conv.append(head, msgs, composer);
  root.append(side, conv);

  let threads: ThreadEntry[] = [];
  let openId: string | null = null;
  let openTitle = "";
  let openData: ThreadData | null = null;
  let busy = false;
  let headwords = new Map<string, string>();

  function paintHead(): void {
    title.textContent = openData ? openTitle : L.newThread;
    delBtn.hidden = !openData;
    delBtn.textContent = L.deleteThread;
    delete delBtn.dataset["armed"];
    delBtn.classList.remove("lh-nb-btn--armed");
    input.placeholder = openData ? L.followPlaceholder : L.askPlaceholder;
  }

  function paintList(): void {
    list.innerHTML = "";
    const q = search.value.trim().toLowerCase();
    const shown = q ? threads.filter((t) => String(t.summary.title ?? "").toLowerCase().includes(q)) : threads;
    if (!shown.length) { list.appendChild(el("li", "lh-nb-empty", L.threadsEmpty)); return; }
    for (const t of shown) {
      const li = el("li");
      const b = el("button", "lh-nb-thread" + (t.id === openId ? " lh-nb-thread--on" : ""));
      b.type = "button";
      b.appendChild(el("span", "lh-nb-thread-title", String(t.summary.title ?? t.id)));
      const meta = el("span", "lh-nb-thread-meta");
      meta.appendChild(el("span", "lh-nb-badge", L.types[t.summary.type] ?? t.summary.type));
      meta.appendChild(document.createTextNode(` ${t.summary.turns} · ${shortDate(t.summary.updated)}`));
      b.appendChild(meta);
      b.addEventListener("click", () => void open(t.id));
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  function renderTurn(turn: Turn, pending: boolean): void {
    const u = el("div", "lh-nb-msg lh-nb-msg--user");
    u.appendChild(el("div", "lh-nb-bubble", turn.q));
    msgs.appendChild(u);
    const a = el("div", "lh-nb-msg lh-nb-msg--ai");
    const bubble = el("div", "lh-nb-bubble");
    if (pending) { bubble.classList.add("lh-nb-bubble--pending"); bubble.textContent = L.pending; }
    else if (turn.error) { bubble.classList.add("lh-nb-bubble--error"); bubble.textContent = turn.a; }
    else bubble.appendChild(renderAiBody(turn.a));
    a.appendChild(bubble);
    if (!pending && turn.terms.length) {
      const chips = el("div", "lh-nb-chips");
      chips.appendChild(el("span", "lh-nb-chips-label", L.captured));
      for (const id of turn.terms) {
        const c = el("button", "lh-nb-chip", headwords.get(id) ?? id);
        c.type = "button";
        c.addEventListener("click", () => ctx.openTerm(id));
        chips.appendChild(c);
      }
      a.appendChild(chips);
    }
    msgs.appendChild(a);
  }

  function paintConv(pendingLast = false): void {
    msgs.innerHTML = "";
    if (!openData || !openData.turns.length) {
      msgs.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", ctx.ai ? L.askEmpty : L.aiOff));
      return;
    }
    openData.turns.forEach((t, i) => renderTurn(t, pendingLast && i === openData!.turns.length - 1));
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function refreshHeadwords(): Promise<void> {
    headwords = new Map((await store.listTerms()).map((e) => [e.id, String(e.summary.headword ?? e.id)]));
  }

  async function refreshList(): Promise<void> {
    threads = await store.listThreads();
    paintList();
  }

  let openSeq = 0;   // the latest open() wins; a slower earlier one (e.g. the restored thread) is dropped
  async function open(id: string | null): Promise<void> {
    if (busy) return;
    const mine = ++openSeq;
    openId = id; openData = null; openTitle = "";
    if (id) {
      const t = await store.getThread(id);
      if (mine !== openSeq) return;
      if (t) { openData = t.data; openTitle = t.title; } else openId = null;
    }
    ctx.remember("thread", openId);
    await refreshHeadwords();
    if (mine !== openSeq) return;
    paintHead(); paintConv(); paintList();
    input.focus();
  }

  function friendly(res: AiResponse): string {
    const e = res.error ?? "";
    if (/401|403/.test(e)) return L.aiOff;
    if (/fetch|network|failed|refused|ECONN|Load failed/i.test(e)) return L.aiOff;
    return `${L.aiError}: ${e || "?"}`;
  }

  async function curriculum(): Promise<string> {
    const doc = ctx.props.outline?.doc;
    if (!doc) return "";
    return curriculumText(await store.getDoc(doc));
  }

  async function send(): Promise<void> {
    const q = input.value.trim();
    if (!q || busy) return;
    busy = true; sendBtn.disabled = true; input.disabled = true;
    const now = ctx.now();
    if (!openData || !openId) {
      openId = threadId(now);
      openData = { session_id: null, type: "question", turns: [] };
      openTitle = fallbackTitle(q);
    }
    const id = openId, data = openData;
    const prior = data.turns.slice();
    const turn: Turn = { q, a: "", at: now, terms: [] };
    data.turns.push(turn);
    input.value = "";
    await store.putThread(id, openTitle, data, now);          // N-2: the question is kept whatever happens next
    ctx.remember("thread", id);
    paintHead(); paintConv(true);
    void refreshList();

    try {
      if (!ctx.ai) { turn.a = L.aiOff; turn.error = true; return; }
      const session = new AiSession(ctx.ai);
      session.adopt(data.session_id);
      const { system, model, effort } = ctx.props.ask;
      const fullSystem = `${system}\n\n${ASK_CONTRACT}`;
      // N-19: every turn carries the current dictionary, so the model names only terms not yet saved.
      const saved = savedTermsBlock((await store.listTerms()).map((e) => String(e.summary.headword ?? e.id)));
      const seeded = async (): Promise<AiResponse> => {
        session.reset();
        const cur = await curriculum();
        const parts = [
          cur ? `[Curriculum studied so far]\n${cur}` : "",
          saved,
          prior.length ? `[Earlier conversation]\n${transcript(prior)}` : "",
          `[Learner input]\n${q}`,
        ].filter(Boolean);
        return session.send({ prompt: parts.join("\n\n"), system: fullSystem, model, effort: effort ?? "medium" });
      };
      let res = data.session_id
        ? await session.send({ prompt: saved ? `${saved}\n\n[Learner input]\n${q}` : q, model, effort: effort ?? "medium" })
        : await seeded();
      if (!res.ok && res.error_kind === "resume_missing") res = await seeded();   // N-3
      if (!res.ok) { turn.a = friendly(res); turn.error = true; return; }

      const parsed = parseReply(res.text);
      turn.a = parsed.answer || res.text.trim();
      data.session_id = session.sessionId;
      if (prior.length === 0) {
        if (parsed.meta?.type) data.type = parsed.meta.type;
        if (parsed.meta?.title) openTitle = parsed.meta.title;
      }
      turn.terms = await store.captureTerms(parsed.meta?.terms ?? [], { now: ctx.now(), via: "ask", thread: id, skipExisting: true, keep: slugTerm(q) ?? undefined });
    } finally {
      await store.putThread(id, openTitle, data, ctx.now());
      busy = false; sendBtn.disabled = false; input.disabled = false;
      if (openId === id) { await refreshHeadwords(); paintHead(); paintConv(); }
      await refreshList();
      ctx.refreshCounts();
      input.focus();
    }
  }

  newBtn.addEventListener("click", () => void open(null));
  search.addEventListener("input", paintList);
  sendBtn.addEventListener("click", () => void send());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  });
  delBtn.addEventListener("click", async () => {
    if (!openId) return;
    if (!delBtn.dataset["armed"]) { delBtn.dataset["armed"] = "1"; delBtn.textContent = L.confirmDelete; delBtn.classList.add("lh-nb-btn--armed"); return; }
    await store.removeThread(openId);
    await open(null);
    await refreshList();
  });

  paintHead(); paintConv();
  const last = ctx.recall("thread");
  if (last) void open(last);

  return {
    open,
    refreshList,
    prefill(text: string): void {
      void open(null).then(() => { input.value = text; input.focus(); });
    },
  };
}

function shortDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
