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
4. Install the kit on this machine: `python tools/setup.py` (see "Install on a new machine" below).

**Run (one app + per-subject data):** there is ONE code copy (this repo). A subject is a data-only
folder (`manifest.json`, `decks/`, `config/`, `_state/`) plus its own `.env`. Run **from the subject
folder** so its `.env` (channel/token) is the one loaded:
```bash
cd "C:\path\to\subject-folder"
python "<KIT>\bot\main.py" "C:\path\to\subject-folder"
```
`load_dotenv()` reads the cwd's `.env`, so each subject gets its own channel/token. Progress is saved
under that folder's `_state/`. Mount priority: argument > `.env MOUNT` > cwd.

**From a consuming project:** run `python skills/install.py` once to create the global skill, then launch
any subject folder with the line above. **Do not clone code per subject** — the kit code stays generic
(see "Subject injection" below); only data + `.env` differ.

### Install on a new machine (bootstrap)

The kit is path-portable (self-locating; zero hardcoded machine paths). Set it up on any computer with:
```bash
git clone <repo-url>
cd learning-harness
python tools/setup.py
```
`tools/setup.py` (cross-platform, pure Python) verifies Python 3.11+, installs `requirements.txt`,
registers the global launch skill at this clone's path (via `skills/install.py`), and creates a `.env`
from the template. Then fill the 4 keys in `.env` and launch as above. The `claude` CLI is optional (AI
capabilities); without it the deterministic features still work. Re-running the bootstrap is safe.

### Subject injection (kit stays subject-agnostic)

The kit code (`bot/`, `engine/`) carries **zero subject literals**; a subject's shape is injected via its
`config/<deck>.json` and compiled into a `SubjectProfile` (`bot/subject.py`):

- **`areas`** — catalog category taxonomy `[{key, label, icon?, aliases?}]`. Drives `/level`, the control
  panel, and per-area level state. Omit for subjects with no catalog areas.
- **`capabilities.ai.persona`** — short identity clause, auto-injected into every AI preamble (carries the
  subject identity, so kit task roles stay generic).
- **`capabilities.ai.tasks.{practice,convo,explain}`** — per-capability overrides of the generic,
  subject-neutral defaults (roles + a few UI strings). Any omitted key falls back to the default.

A guardrail test (`bot/tests/test_subject_agnostic.py`) fails if any subject literal leaks into kit code.
`bot/capability_registry.py` remains the single source of truth for which `capability_id` maps to which
files/handler/commands (read by `bot/boot.py` and `bot/wiring.py`); gated wiring registers handlers and
slash commands only for enabled capabilities. `/study unit:<unit>` filters a session to one unit.

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
│   ├ 기획_web.md               web frame plan (parts+standards, ai_server bridge)
│   ├ _이데이션_능력카탈로그.md   four-layer learning capability catalog
│   └ _이데이션_원본.json        raw ideation data
├ specs/                       contracts (SoT-first)
│   ├ _interface-contract.md   core SoT (shared types, persistence, wiring, capability registry, AI adapter, errors, invariants)
│   ├ injection-interface.md   content and config injection format for consuming projects
│   ├ engine-contract.md       engine (pure) contract
│   ├ bot-contract.md          bot (discord.py) contract
│   ├ learning-types.md        four-layer capability registry
│   ├ ai-mode.md               _invoke adapter and token control
│   ├ web-notebook.md          notebook part, generic web host, conceptprob instance hooks (N-1..N-17)
│   ├ web-compose.md           compose part: writing practice with AI grading incl. a minor-slip pass (W-1..W-14)
│   ├ web-quiz.md              quiz part: problem drilling, language toggle, exam mode (Q-1..Q-12)
│   ├ web-roadmap.md           roadmap part: curriculum from a planning document, derived study status, build hints (RM-1..RM-12)
│   ├ web-gateway.md           gateway: many web subjects under one prefix, login, token kept server-side (GW-1..GW-18)
│   └ launch-skill.md          global skill and install
├ engine/                      pure Python core (zero discord, zero file I/O): scoring, leitner, selection, dashboard, migrate
├ bot/                         discord.py shell: boot, session, dispatch, handlers, persist, ai, commands
│   ├ capability_registry.py   capability SoT (files/handler/commands per capability_id)
│   ├ wiring.py                gated handler registration + required-file verification
│   ├ study_select.py          unit + area/level card filters (level continuity)
│   ├ level_state.py           per-area level + learned flags (sidecar) + bulk re-level
│   ├ subject.py               SubjectProfile: injected area taxonomy + AI task templates (subject-agnostic kit)
│   ├ control_panel.py         persistent learning-hub panel (capability control_panel, /ui)
│   ├ caps_ai/ai_practice.py   AI-generated composition problem + grading (per catalog item)
│   ├ caps_ai/ai_convo.py      threaded multi-turn conversation (main model)
│   ├ caps_ai/ai_explain.py    one-off per-card concept explanation thread (explain model, discarded after use)
│   ├ ai_server.py             gated local HTTP server bridging a web client to claude (web AI, Discord-independent) + the /state record API
│   ├ state_store.py           record-per-file store with derived indexes (_verify drift check, _rebuild full rescan)
│   ├ session_guard.py         claude session lifetime tracking and shutdown (no orphan processes; tree kill on Windows)
│   ├ live.py                  opt-in long-lived claude process per session for short repeated turns (ai-mode §4.1)
│   └ harness/                 Discord harness catalog (copied, 59 files)
├ skills/                      launch skill source plus install.py
├ examples/                    mock content for development and verification (not a real subject)
├ tools/                       setup.py; serve_host.py + start_web.ps1 + webhost/ (generic host page: one page per web subject, views from its content/app.json, relative URLs);
│                              hostfiles.py (what a host serves, shared); gateway/ (remote access: login, /<base>/<slug>/ prefix, boot page, API proxy, one ai_server per subject); tests/
├ web/                         Vite + TS parts kit (subject-agnostic): parts/ (sheet, codeproj, dashboard, conceptprob, notebook, compose, quiz, roadmap), src/ui (shared tab layout), src/grade (engine grader port), src/ai (ai_server client), src/storage (record store port + offline buffer), src/highlight (dependency-free syntax highlighter), src/flow (study and workspace flows), src/styles (design tokens), USAGE.md (AI operating manual); web AI routes through bot/ai_server.py
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
cd bot    && python -m pytest tests/ -q      # 425 headless tests (boot/session, handlers, caps, AI seam, renderers)
```
- The engine core is pure functions (`now` is injected for determinism). The bot is verified headless without
  discord or a live `claude` CLI (boot, session loop, handler grading cores, sidecar I/O, and the AI helper
  layer with a mocked `invoke`). Discord I/O and live AI are exercised only against a running bot.

```bash
cd web && npm install && npm test     # 339 headless web tests (grade parity, parts, ai client, pre-baked offline mount, subject-agnostic guard)
cd web && npm run build               # tsc --noEmit + vite production build
```
- The web kit is verified headless with vitest (the TS grader is checked against engine-generated golden
  vectors for parity; the AI client runs against a mock `/ai`, no live claude; a jsdom gate mounts a
  pre-baked concept with no session and grades it with zero AI). For a local visual check,
  `cd web && npm run dev` serves a dev fixture at `localhost:5173` (`#conceptprob` for the offline module).

Two tests are opt-in because they spend money. `parts/codeproj/repo.live.test.ts` reads a real repository
through a running `ai_server`, loads it into a real `claude` session, and times choosing the first files and
annotating a few of them; `parts/codeproj/trace.live.test.ts` resumes a session already holding a project
and times one debug leg. There is no vitest config in this repo, so the default include glob picks these
files up and the gate lives inside them — without `LH_LIVE` they are skipped and `npm test` stays at 477 green.

```bash
cd web && LH_LIVE=1 LH_LIVE_TOKEN=<ai_server token> LH_LIVE_REPO=<url or folder> npx vitest run parts/codeproj/repo.live.test.ts
cd web && LH_LIVE=1 LH_LIVE_TOKEN=<ai_server token> npx vitest run parts/codeproj/trace.live.test.ts
```

The token goes in the `X-AI-Token` header (`Authorization: Bearer` also works); `ai_server` refuses
to start without one and rejects every other header name.
- Env: `LH_LIVE_URL` (default `http://127.0.0.1:8765`), `LH_LIVE_MODEL` (default `claude-opus-5[1m]`),
  `LH_LIVE_OUT` (where the measurement is written), and for the repository run `LH_LIVE_REF`, `LH_LIVE_GOAL`,
  `LH_LIVE_FOCUS`, `LH_LIVE_SCOPE` (comma separated) and `LH_LIVE_ANNOTATE` (files to annotate, default 2).
  Each step is written as soon as it lands, so a run that dies midway still leaves the numbers it reached.

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
  - Subject-agnostic refactor: area taxonomy, AI persona, and AI task wording are injected via config
    (`bot/subject.py` SubjectProfile); the per-subject `clone` tool was removed in favor of one app
    running against per-subject data folders (each with its own `.env`). Guardrail test enforces zero
    subject literal in kit code.
- 584 python tests green, all headless (measured 2026-09-02). The deterministic loop and every new
  capability are proven without discord or a live `claude` CLI (mocked `invoke`).
- Web kit built: a Vite + TS parts kit (subject-agnostic, mirroring the bot's injection model) with four
  parts (sheet, codeproj, dashboard, conceptprob), a shared engine grader port (golden-vector parity with the
  Python engine), an `ai_server` browser client (load-once then resume sessions), a warm study-compendium design layer
  (`src/styles`: serif display, IBM Plex, expressway-green accent on paper), and `web/USAGE.md` (the AI operating manual, intent-first). 477 web tests green plus a clean `tsc --noEmit` (measured 2026-09-15).
  `codeproj` reads a git repository the learner names rather than generating one: `bot/repo_loader.py` behind
  `POST /repos/load` shallow-clones a URL or reads a local folder, filters it (ignored dirs, lock files, binaries,
  the learner's scope) and caps it at 300 files / 1.5MB. The learner's request (goal and level, focus, scope)
  reaches every annotation prompt; up to 8 files are annotated before entry, chosen for the request, and a
  one-at-a-time background queue does the rest. Not yet measured against a live CLI with a real repository.
  `bot/ai_server.py` (gated local HTTP, proven over a public tunnel) bridges the web client to `claude -p`
  with no Discord dependency. **AI is optional**: the AI parts also run from **pre-baked verified content**
  injected by the instance (`concepts` / `project`) — mounting with no `ai_server` and grading fully
  offline (token 0); concept bodies render Markdown (headings, tables, code) via a hand-rolled renderer.
- Record store and study flows: `bot/state_store.py` plus the `/state` API on `ai_server` give the kit a
  record-per-file store with derived indexes (`_verify` drift check, `_rebuild` full rescan); `web/src/storage`
  is its browser port with an offline buffer (localStorage is a buffer, never the source of truth), and
  `web/src/flow` holds the load→archive study flow and the archived-project workspace.
  `codeproj` grew to the IDE shape it was specified for: a dependency-free syntax highlighter (`web/src/highlight`,
  no CDN so it works offline), an optional soft wrap with hanging indent and copy-safe `↵` marks (`parts/codeproj/wrap.ts`),
  multi-range code scrap, and a composed-answer block system
  (`parts/codeproj/components`, 24 block types covering the 25 catalogue entries — inline and block code
  references share one `ref` type). `session_guard` ends claude sessions so no process is orphaned.
  Three AI-written layers sit over a loaded project, each its own per-project record and each
  injected into the part rather than stored by it: annotations (`annotations.ts`, Ctrl-hover popups,
  the first 8 files built before the learner arrives and the rest behind them), concept documents (`concepts.ts`, background after entry), and
  debug runs (`trace.ts`, one leg per file, started by the learner from a chosen line). All three are
  read back with zero AI calls when an archived project is reopened.
- Web subjects run from one page (2026-09-30, `specs/web-notebook.md`). `tools/start_web.ps1 -Subject <folder>`
  builds the bundle and starts `ai_server` (state under `<folder>/state`) plus `tools/serve_host.py`, which serves
  the generic host page `tools/webhost/` with the subject's `content/` and `host/local.config.js`. The new
  `notebook` part asks the AI anything, keeps every thread (resumable), captures terms into a dictionary,
  reviews them with Leitner, and edits the curriculum outline that `conceptprob` reads from a state doc.
  `conceptprob` gained optional instance hooks (labels, an author prompt with a kit-owned response contract,
  persisted live concepts, per-problem explanations, a problem style for `/problems`, a hand-off of selected
  text to the notebook); with none passed it behaves as before. `bot/ai.py` now starts the CLI with
  `--setting-sources project,local` so the operator's user hooks stay out of learner answers. Verified live
  with a real subject (ask, follow-up resume, concept generation and persistence, grading, review):
  Problem fronts can be forced to bare abbreviations (`collapseAbbreviations`, N-17).
  515 web tests and 614 python tests green (bot 455 + engine 159; measured 2026-09-30).
- Live AI sessions (2026-10-05, `bot/live.py`, ai-mode §4.1 L-1..L-6): a `/ai` request with `live: true` is answered
  from one long-lived `claude -p` process per session (review grading: 2.1-2.6 s per follow-up against 4.9-5.7 s
  per spawned call, measured end to end). `session_guard` now ends the whole process tree on Windows; `proc.kill()`
  alone was measured to leave `claude.exe` running. 622 python tests green (bot 463 + engine 159); 545 web tests green.
- Two more state-backed parts (2026-10-01). `compose` (`specs/web-compose.md`): writing tasks generated by mode,
  AI grading (correct / partial = minor slips only, counted as a pass / incorrect; unreadable = ungraded, never a
  fail), grammar examples under each error, a local word diff,
  revise-and-resubmit in one session, a Leitner revise queue, error stats, and corrected expressions captured
  into the notebook dictionary without counting as lookups. `quiz` (`specs/web-quiz.md`): drilling over concept
  and generated problems, sets by unit/source/count, practice or timed exam, a per-problem language toggle whose
  translation is fetched once and stored, flags, deletion reasons fed back to generation, and results with
  retry-wrong. Both reuse the notebook's tab layout (`src/ui/tabs.ts`) and style primitives; JSON replies are
  read by one helper (`src/ai/json.ts`). Verified live (generation, grading, translation, resume).
  544 web tests green (measured 2026-10-05).
- Remote web subjects and the roadmap part (2026-10-18). `tools/gateway/` (`specs/web-gateway.md`) serves every
  configured subject under one prefix (`/study/<slug>/`) behind a password login (scrypt hash, signed cookie scoped to
  the prefix, throttle, same-origin check), starts one `ai_server` per subject with an isolated environment, and
  proxies `/study/<slug>/api/*` to it with the token added on the server, so the browser holds no secret. The host
  page now uses relative URLs, and `tools/hostfiles.py` is the one resolver both hosts use (with `contentLinks` for a
  planning document kept outside `content/`). `ai_server` now cancels `/ai` and `/problems` when the caller hangs up
  (`_unless_dropped`); before, a closed tab left its `claude` child running (measured). `roadmap`
  (`specs/web-roadmap.md`) reads cycles and steps from the instance's Markdown plan, derives each step's study status
  from the quiz bank and log (shared loader `parts/quiz/bankload.ts`), and gives graded build hints whose code fences
  are replaced unless marked `text`. 568 web tests and 655 python tests green (measured 2026-10-18).
  Run: `python tools/gateway/gateway.py --config <file> --set-password`, then `python tools/gateway/gateway.py --config <file>`
  as the user logged in to the `claude` CLI.
- Remote load time (2026-10-18). Over the tunnel each request took 1.1 to 1.9 s (routed through Cloudflare LAX), so the
  first paint was bounded by sequential round trips. Independent reads now go together (`Promise.all`), the state
  adapter coalesces reads issued in one task into `POST /state/_batch`, the gateway inlines app.json, content files,
  runtime config and a `/state/_snapshot` into the page (GW-18), and versioned static files are browser-cached and
  gzip-compressed (GW-17). The gateway binds its port exclusively and holds its `ai_server`s in a kill-on-close job
  object, so neither a second instance nor a killed gateway leaves processes behind (measured: both happened).
  571 web tests and 666 python tests green.
- Pending: live Discord verification (needs the user prerequisites: bot app, token, server), the
  conversation compaction and long-term memory that the stored per-day records exist to feed, and a
  delete tombstone in `web/src/storage/buffered.ts` — with the server unreachable a removed record is
  still served from the localStorage buffer, so a deletion made offline comes back.

## 7. Where to start (for AI and new contributors)

1. `docs/기획_v5_discord.md` — the big picture. 2. `specs/_interface-contract.md` — the core SoT (types and
contracts). 3. `specs/injection-interface.md` — how to attach a subject. 4. `engine/` and `bot/` code plus tests.
