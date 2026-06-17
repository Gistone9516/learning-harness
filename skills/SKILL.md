---
name: learning-harness
description: Mounts a subject folder onto a Discord learning bot. One fixed generic app (code) runs against per-subject data folders; each subject keeps its own .env (channel/token). Use for requests like "put this subject on Discord", "start the learning bot", "run v5", "launch the learning framework", "add a new subject".
---

# learning-harness (global skill)

The learning bot app (generic, subject-agnostic code) is installed here:

```
APP = <APP>
```

**Architecture: one fixed app + per-subject data folders.** The app holds ALL code (bot, engine,
harness) in ONE place and never carries subject content. Each subject is a **data-only folder**
(`manifest.json`, `decks/`, `config/`, `_state/`) plus its own **`.env`**. You run the app's code
against a subject folder; the subject folder holds no code.

## ★ Governance — keep the kit subject-agnostic (hard rules)

These prevent the kit from drifting into one subject's shape (which would collide when you switch
subjects and come back). Follow them on every task:

- **No code clone per subject.** Do not copy `bot/`/`engine/` into a subject folder. There is ONE
  code copy: the APP. Subjects differ only in data + `.env`.
- **Zero subject literals in kit code** (`bot/`, `engine/`). No concrete subject name, no subject
  area labels, no exam names, no task wording like "write a sentence". A guardrail test
  (`bot/tests/test_subject_agnostic.py`) enforces this and fails on leakage.
- **All subject flavor is injected via config**, never edited into the kit:
  - **Areas** (the catalog categories + their labels/icons) → `config/<deck>.json` `"areas"`.
  - **AI identity** → `capabilities.ai.persona` (auto-injected into every AI preamble).
  - **AI task wording + UI strings** → `capabilities.ai.tasks.{practice,convo,explain}` (override the
    generic, subject-neutral defaults in `bot/subject.py`).
  - **Content** → `decks/<deck>.json`.
- **While working on ANY subject, do not modify the kit to suit that subject.** Kit edits are for
  generic framework features only. If you find yourself typing a subject word into `bot/`/`engine/`,
  it belongs in that subject's config instead.

The same principle applies to the sibling `Discord Agents` project (generic `bridge.py` + `skills/`;
instance specifics in `.env`/`roster.json`) — see global CLAUDE.md.

## Prerequisites (per subject)

1. **A Discord bot app + token** in the Developer Portal (separate from discord-bridge). Subjects may
   share one token or use different tokens; either way the token lives in the subject's `.env`.
2. **A Discord server (guild) + channel** for that subject. Invite the bot with `bot` +
   `applications.commands` scopes and message read/write, thread, and file-attachment permissions.
   **Message Content Intent** must be ON (otherwise stop-word / conversation / explain replies are not read).
3. **The subject folder's `.env`** (copy `.env.example`): `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
   `DISCORD_CHANNEL_ID`, `DISCORD_ALLOWED_USER_ID`, plus `AI_MODEL` / `AI_MODEL_EXPLAIN`. Each subject's
   `.env` is how it gets **its own channel** (and optionally its own bot/token).

If permissions or scopes are insufficient, threads and slash commands are disabled with a warning, but
basic operation continues.

## Running a subject

Run **from the subject folder** so its `.env` (channel/token) is the one loaded:

```
cd "C:\path\to\subject-folder"
python "<APP>\bot\main.py" "C:\path\to\subject-folder"
```

- `main.py` runs the APP's code; the path argument is the mount (its `manifest`/`decks`/`config`).
- `load_dotenv()` reads `.env` from the current directory, so launching from the subject folder selects
  that subject's channel/token. Each subject folder must have its own `.env`.
- Progress is saved under that folder's `_state/` (isolated per subject).
- Stop with Ctrl+C. One running instance per token at a time.
- Mount priority: argument > `.env MOUNT` > cwd.

## Adding a NEW subject (no kit edits)

1. Make a folder with `manifest.json`, `decks/<deck>.json`, `config/<deck>.json`, and `.env`.
2. In `config/<deck>.json` set `capabilities.enabled`, `capabilities.ai.persona`, and (if using the
   catalog level/practice model) `"areas"` and `capabilities.ai.tasks` with that subject's wording.
3. Run it with the command above. **Do not touch `bot/`/`engine/`.**

## Notes

- Keep tokens only in each subject's `.env`; never expose them.
- AI features (layer 3) require the `claude` CLI on PATH; absent → only those are disabled.
- Run `python "<APP>/skills/install.py"` once to register this skill under `~/.claude/skills/`.
