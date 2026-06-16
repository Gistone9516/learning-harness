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
   `DISCORD_CHANNEL_ID`, `DISCORD_ALLOWED_USER_ID` (plus optional `USER_LANG`, `MOUNT`).
4. `pip install -U "discord.py>=2.6" python-dotenv`.

**Run:**
```bash
python "bot/main.py" [content-folder]      # omit the folder to use the current folder. Example: python "bot/main.py" examples
```
Loads the content folder's `manifest.json`, `decks/`, and `config/` and puts that subject on Discord.
Progress is saved under that folder's `_state/`.

**From a consuming project:** run `python skills/install.py` once to create the global skill, then launch
the bot from any subject folder with a single line.

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
│   └ harness/                 Discord harness catalog (copied, 59 files)
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
  conditional skip).

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
cd bot    && python -m pytest tests/ -q      # 13 headless boot/session plus examples integration tests
```
- The engine core is pure functions (`now` is injected for determinism). The bot is verified headless without
  discord (boot and the session loop); Discord I/O is live-only.

## 6. Current status

- Done: (1) planning, (2) specs (7 documents, passed adversarial integrity review), (3) implementation
  (engine core, bot shell, mock content, skill).
- 172 regression tests green (159 engine plus 13 bot). The full deterministic loop
  (boot, queue, grade, Leitner, persist) is proven headless.
- Pending: live Discord verification (needs the user prerequisites: bot app, token, server). Discord I/O
  handlers are only verified live.
- Pending: remaining capability increments (mcq_select, seq_modal, AI mode, SRS push, dashboard rendering, and
  so on; about 30 in the catalog). The web (frontend-design) workspace is deferred.

## 7. Where to start (for AI and new contributors)

1. `docs/기획_v5_discord.md` — the big picture. 2. `specs/_interface-contract.md` — the core SoT (types and
contracts). 3. `specs/injection-interface.md` — how to attach a subject. 4. `engine/` and `bot/` code plus tests.
