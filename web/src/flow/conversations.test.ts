// FR-15a: the transcript.
//
// Nothing reads these yet. They are written now because a summary can only be made from records
// that were kept — the fields dropped here are the ones no later round can recover.
import { describe, it, expect } from "vitest";
import { createLocalStorage } from "../storage/local";
import type { StoragePort } from "../storage/port";
import {
  COLLECTIONS,
  CONVERSATION_MAX_ANSWER,
  CONVERSATION_MAX_QUESTION,
  conversationDayId,
  createStudyFlow,
  type ConversationDay,
  type ConversationEntry,
} from "./study";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

function setup() {
  const storage: StoragePort = createLocalStorage({ namespace: "conv", store: memStorage(), now: () => 100 });
  return { storage, flow: createStudyFlow({ storage }) };
}

const AT = Date.UTC(2026, 8, 2, 12, 0, 0);

const entry = (over: Partial<ConversationEntry> = {}): ConversationEntry => ({
  at: AT,
  kind: "ask",
  project_id: "prj-a",
  history_id: "hist-a",
  path: "app/db.py",
  question: "왜 이렇게 했나요?",
  answer: "이렇게 했습니다.",
  ...over,
});

describe("conversationDayId", () => {
  it("is a legal record id and sorts the same as time", () => {
    // Record ids may not contain slashes, dots, uppercase or underscores.
    const id = conversationDayId(AT);
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    expect(conversationDayId(AT) < conversationDayId(AT + 86_400_000)).toBe(true);
  });

  it("pads so the ordering never breaks on a single-digit month", () => {
    expect(conversationDayId(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });
});

describe("appendConversation", () => {
  it("keeps the words, not just the count", async () => {
    const { flow, storage } = setup();
    await flow.appendConversation(entry());

    const rec = await storage.get<ConversationDay>(COLLECTIONS.conversations, conversationDayId(AT));
    expect(rec!.data.entries).toHaveLength(1);
    expect(rec!.data.entries[0].question).toBe("왜 이렇게 했나요?");
    expect(rec!.data.entries[0].answer).toBe("이렇게 했습니다.");
  });

  it("collects a day into one record", async () => {
    const { flow, storage } = setup();
    await flow.appendConversation(entry());
    await flow.appendConversation(entry({ at: AT + 60_000, kind: "explain", lens: "flow" }));

    expect(await storage.list(COLLECTIONS.conversations)).toHaveLength(1);
    const rec = await storage.get<ConversationDay>(COLLECTIONS.conversations, conversationDayId(AT));
    expect(rec!.data.entries).toHaveLength(2);
  });

  it("starts a new record on a new day", async () => {
    const { flow, storage } = setup();
    await flow.appendConversation(entry());
    await flow.appendConversation(entry({ at: AT + 86_400_000 }));
    expect(await storage.list(COLLECTIONS.conversations)).toHaveLength(2);
  });

  it("keeps what only this moment knows", async () => {
    // scrap_count and depth exist on the event and nowhere else afterwards. Dropping them here
    // would flatten a basket question about six regions into one path, and make a short answer
    // indistinguishable from a full one, with no way to recover either later.
    const { flow, storage } = setup();
    await flow.appendConversation(entry({ scrap_count: 6, depth: "semi", lines: [12, 18] }));

    const rec = await storage.get<ConversationDay>(COLLECTIONS.conversations, conversationDayId(AT));
    const e = rec!.data.entries[0];
    expect(e.scrap_count).toBe(6);
    expect(e.depth).toBe("semi");
    expect(e.lines).toEqual([12, 18]);
    expect(e.project_id).toBe("prj-a");
    expect(e.history_id).toBe("hist-a");
  });

  it("counts the day from the index alone", async () => {
    const { flow, storage } = setup();
    await flow.appendConversation(entry());
    await flow.appendConversation(entry({ kind: "explain", lens: "overview" }));
    await flow.appendConversation(entry({ kind: "explain", lens: "flow" }));

    const [index] = await storage.list(COLLECTIONS.conversations);
    expect(index.summary).toMatchObject({ date: conversationDayId(AT), entries: 3, questions: 1, explains: 2 });
  });

  it("caps an entry so one runaway answer cannot stop the day being written", async () => {
    // The offline buffer is browser storage with a quota, and the write path discards the
    // boolean that would have reported an overflow: without a cap, the record simply stops
    // saving and nothing says so.
    const { flow, storage } = setup();
    await flow.appendConversation(
      entry({ question: "가".repeat(5000), answer: "나".repeat(20_000) }),
    );

    const rec = await storage.get<ConversationDay>(COLLECTIONS.conversations, conversationDayId(AT));
    expect(rec!.data.entries[0].question).toHaveLength(CONVERSATION_MAX_QUESTION);
    expect(rec!.data.entries[0].answer).toHaveLength(CONVERSATION_MAX_ANSWER);
  });
});
