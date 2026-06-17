# Learning Harness (Discord-native)

> **A personal learning harness that runs on Discord (general-purpose framework).** Card retrieval,
> spaced repetition (Leitner), diagnostics, and AI-assisted study delivered through a Python bot plus
> Discord. **A tool kit with no subject or content of its own** — other projects copy and consume it,
> attaching their own subject. (v5. The earlier static-HTML version v4 is preserved under `_archive_v4/`.)

---

## 1. At a glance

- **What** — deterministic grading, Leitner, and dashboards (zero tokens), plus an optional AI study mode
  (`claude -p`, uses subscription tokens), delivered Discord-native.
- **Why Discord** — multi-device (phone and PC) and UI are absorbed by Discord (automatic sync, native
  components). Built by copying the sibling `Discord Agents/harness` catalog.
- **Subject-agnostic** — zero subject vocabulary hard-coded into the engine, bot, or harness. Content and
  config are injected as JSON by the consuming project (that is what gives it a personality).
- **Distribution model** — like `discord-bridge`: a fixed APP kit plus a mounted content folder. Ships with
  a launch skill.

## 2. Quick start (running it)

**Prerequisites (user actions):**
1. Create a **new bot app and issue a token** in the Discord Developer Portal (separate from discord-bridge).
2. Create a **new server (guild) dedicated to learning** and invite the bot (required permissions plus the
   `applications.commands` scope).
3. Write the root `.env` (copy `.env.example`) — `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
   `DISCORD_CHANNEL_ID`, `DISCORD_ALLOWED_USER_ID` (plus optional `USER_LANG`, `MOUNT`, and the
   AI model ids `AI_MODEL` / `AI_MODEL_EXPLAIN`).
4. `pip install -U "discord.py>=2.6" python-dotenv`.

**Run:**
```bash
python "bot/main.py" [content-folder]      # omit the folder to use the current folder. Example: python "bot/main.py" examples
```
Loads the content folder's `manifest.json`, `decks/`, and `config/` and puts that subject on Discord.
Progress is saved under that folder's `_state/`.

**From a consuming project:** run `python skills/install.py` once to create the global skill, then launch
the bot from any subject folder with a single line.

### Modular clone (copy only the capabilities you need)

The kit is capability-modular: a consuming project can clone the **core kernel** plus only the
capability bundles it enables, run from its own copy, and leave this repo pristine.

```bash
python tools/clone.py --target <PROJECT_DIR> --from-config [--env copy]
```

- `bot/capability_registry.py` is the single source of truth: each `capability_id` maps to its
  files, shared bases, dispatch handler, and slash commands. `bot/boot.py`, `bot/wiring.py`, and
  `tools/clone.py` all read it.
- `tools/clone.py` resolves the enabled set (from the target's `config/<deck>.json`), unions the
  core kernel with each enabled capability's files (deduped, transitive), and copies them preserving
  the `bot/ + engine/ + bot/harness/` layout. The target's content (`manifest/decks/config/_state`) is untouched.
- **Gated wiring**: `bot/wiring.py` registers dispatch handlers and `bot/commands.py` registers slash
  commands **only for enabled capabilities** (recall_self is always present as the fallback). An
  enabled capability whose files were not cloned fails boot with a clear `ContentInjectionError`.
- The cloned project runs standalone: `cd <PROJECT_DIR> && python bot/main.py <PROJECT_DIR>`.
- `/study unit:<unit>` filters the session to one unit (e.g. a day or a `*-learn` flashcard set).

### Catalog learning model + study control panel

The english-GO subject uses a leveled **catalog** model (not fixed days):

- Catalog items (vocabulary / grammar / idioms) are **self flashcards** tagged with
  `tags.area` (vocab/grammar/idiom) and `tags.level` (1–10). Marking one "알아요" sets a
  per-card `learned` flag (`bot/level_state.py`, sidecar).
- **Per-area independent level**, controlled by `/level <단어|문법|숙어> <1-10>` (or panel ⬆️⬇️),
  with a difficulty-example confirm dialog. Raising a level bulk-marks lower items learned;
  lowering unmarks higher items. Study/practice is bounded to the current level
  (`bot/study_select.py` `cards_in_area_level/upto`) so difficulty never jumps ahead.
- **AI practice** (`bot/caps_ai/ai_practice.py`): for learned items, AI generates a
  composition problem and grades the learner's English with Korean feedback.
- **AI conversation** (`bot/caps_ai/ai_convo.py`): a threaded multi-turn chat seeded by the
  learned-item list (main model); AI asks → learner writes English → AI explains in plain Korean.
- **AI concept explanation** (`bot/caps_ai/ai_explain.py`): the answer reveal carries a
  🤖 AI 해설 button (gated on the `ai_explain` capability). It opens a **one-off thread** that
  explains the card concept in plain Korean and answers a few follow-ups, then **discards (deletes)
  the thread**. It runs the cheaper explain model (`ctx.ai_model_explain`, e.g. haiku) on a
  throwaway conversation session, so the learner's study session is never polluted.
- **Answer reveal as Components V2** (`bot/handlers/recall_self.py`): the (now enriched) explanation
  plus the ✅ 알았어요 / ❌ 몰랐어요 [ / 🤖 AI 해설 ] buttons are rendered in a `discord.ui.LayoutView`
  (`Container` + `ActionRow`) sent as a separate message. V2 items require a LayoutView, and a
  LayoutView message cannot also carry `content=`, so the card front (plain `content`) and the reveal
  are distinct messages.
- **Control panel** (`control_panel`, persistent): per-area level + learned progress, area →
  mode menu (🧠 암기 / ✍️ AI 연습 / ⬆️⬇️ 레벨), plus 🔁 복습 / 🗣 대화 / 📊 대시보드 / 🧹 정리 / ❓ 도움말.
  Auto-posts on ready and after each session; `/ui` re-summons; `/clear [n]` purges the channel.
  Cards show `n/N` progress + ✅/❌ feedback. Persistence: `timeout=None` + fixed `custom_id` + `add_view()`.

## 3. Folder structure

```
learning-harness/              the general-purpose framework repo (no real subject content)
├ README.md                    this document
├ .env.example                 .env template (blank tokens)
├ docs/                        planning and ideation (Korean, kept as-is)
│   ├ 기획_v5_discord.md        planning (intent, architecture, scope)
│   ├ _이데이션_능력카탈로그.md   four-layer learning capability catalog
│   └ _이데이션_원본.json        raw ideation data
├ specs/                       contracts (SoT-first)
│   ├ _interface-contract.md   core SoT (shared types, persistence, wiring, capability registry, AI adapter, errors, invariants)
│   ├ injection-interface.md   content and config injection format for consuming projects
│   ├ engine-contract.md       engine (pure) contract
│   ├ bot-contract.md          bot (discord.py) contract
│   ├ learning-types.md        four-layer capability registry
│   ├ ai-mode.md               _invoke adapter and token control
│   └ launch-skill.md          global skill and install
├ engine/                      pure Python core (zero discord, zero file I/O): scoring, leitner, selection, dashboard, migrate
├ bot/                         discord.py shell: boot, session, dispatch, handlers, persist, ai, commands
│   ├ capability_registry.py   capability SoT (files/handler/commands per capability_id)
│   ├ wiring.py                gated handler registration + required-file verification
│   ├ study_select.py          unit + area/level card filters (level continuity)
│   ├ level_state.py           per-area level + learned flags (sidecar) + bulk re-level
│   ├ control_panel.py         persistent learning-hub panel (capability control_panel, /ui)
│   ├ caps_ai/ai_practice.py   AI-generated composition problem + grading (per catalog item)
│   ├ caps_ai/ai_convo.py      threaded multi-turn English conversation (main model)
│   ├ caps_ai/ai_explain.py    one-off per-card concept explanation thread (explain model, discarded after use)
│   └ harness/                 Discord harness catalog (copied, 59 files)
├ tools/                       maintenance scripts
│   └ clone.py                 clone core kernel + selected capabilities into a consuming project
├ skills/                      launch skill source plus install.py
├ examples/                    mock content for development and verification (not a real subject)
├ web/                         (reserved) frontend-design workspace for continuous interactive practice and long-form reading, deferred
└ _archive_v4/                 the old static-HTML framework (porting and reference source)
```

## 4. Design core

**Two pillars**
- **A. Deterministic learning** (zero tokens) — four grading modes (exact/keyword/cloze/self), normalization,
  Leitner, a question queue (interleaving, due-first, D-day), and dashboard aggregation. The v4 JS core ported
  to pure Python functions.
- **B. AI study mode** (optional tokens) — replicates the `claude -p --input-format stream-json` `_invoke`
  adapter pattern (zero bridge import or execution). Token control (short preamble, low effort, cheap model,
  conditional skip). **Model ids are a single source of truth in `.env`** (`AI_MODEL` for grading/practice/
  conversation, `AI_MODEL_EXPLAIN` for the concept-explanation thread) — never hard-coded in code or config;
  `bot/boot.py` reads them (env first, config fallback) into `BootResult` → `Ctx` → the per-call `model`
  override on `ai_caps.one_shot` / `ConvManager`.

**Four-layer capability catalog** (toggled by the consuming config) — (1) engine core, (2) Discord learning
(harness primitives), (3) AI, (4) infrastructure (gating, heartbeat, and so on). Details in
`docs/_이데이션_능력카탈로그.md`.

**Invariant boundaries** (SoT `specs/_interface-contract.md §7`)
- Subject-agnostic (zero hard-coded vocabulary, everything injected); copy model (zero discord-bridge runtime
  dependency); bot isolation (new app, token, server); **engine vs harness boundary** (learning algorithms live
  in a fully pure engine core, Discord I/O and file storage live in harness/bot); binary grading (no partial
  credit, no pass probability); stable card_id; deterministic means zero tokens.

**Dependency direction:** `bot -> engine (pure), harness, content (injected)`. The engine core depends on
nothing (zero file I/O, discord, or harness imports).

## 5. Development and testing

```bash
cd engine && python -m pytest tests/ -q      # 159 pure-engine regression tests
cd bot    && python -m pytest tests/ -q      # 362 headless tests (boot/session, handlers, caps, AI seam, renderers)
```
- The engine core is pure functions (`now` is injected for determinism). The bot is verified headless without
  discord or a live `claude` CLI (boot, session loop, handler grading cores, sidecar I/O, and the AI helper
  layer with a mocked `invoke`). Discord I/O and live AI are exercised only against a running bot.

## 6. Current status

- Done: (1) planning, (2) specs (7 documents, passed adversarial integrity review), (3) implementation
  (engine core, bot shell, mock content, skill).
- Done: the full capability set across the four layers.
  - All six card handlers: recall_self, short_modal, cloze_modal, mcq_buttons, and the formerly-missing
    seq_modal and mcq_select (no more silent fallback).
  - `/review` (incorrect or due cards) and the dashboard commands `/dashboard` and `/digest`.
  - Six sidecar capabilities (confidence_rate, hint_progressive, elaborate_ask, read_resume, srs_due_alert,
    adaptive_weight) wired as opt-in session hooks and queue weighting.
  - Twelve layer-3 AI capabilities on the session-based `ai_caps` seam (one claude session per study session,
    multi-turn only for `ai_socratic`); AI grading falls back to self-grade, so the binary invariant holds.
  - Dashboard renderers (live card, box table, mastery chart with a text fallback, weekly digest, weakness
    wiki) and the SRS due-card push loop.
  - Catalog learning model: leveled self-flashcards (vocab/grammar/idiom, per-area level 1–10), AI practice
    and AI conversation, the persistent control panel, and per-card AI concept-explanation threads
    (`ai_explain`, one-off, discarded after use). Card explanations (`back.detail`) are enriched for beginners.
  - Answer reveal rebuilt on Components V2 (`discord.ui.LayoutView`); AI model ids moved to `.env`
    (`AI_MODEL` / `AI_MODEL_EXPLAIN`) as the single source of truth.
- 521 regression tests green (159 engine plus 362 bot), all headless. The deterministic loop and every new
  capability are proven without discord or a live `claude` CLI (mocked `invoke`).
- Pending: live Discord verification (needs the user prerequisites: bot app, token, server) and live AI
  smoke (needs the `claude` CLI on PATH). The web (frontend-design) workspace remains deferred.

## 7. Where to start (for AI and new contributors)

1. `docs/기획_v5_discord.md` — the big picture. 2. `specs/_interface-contract.md` — the core SoT (types and
contracts). 3. `specs/injection-interface.md` — how to attach a subject. 4. `engine/` and `bot/` code plus tests.
