# v5 launch-skill spec

> buildflow per-folder contract. **Conforms to SoT (`_interface-contract.md`).** SoT takes authority on conflict.
> Scope: `skills/` — global skill + install for consumer projects that copy and launch this framework. Model = same as `discord-bridge`.
> Source model: `~/.claude/skills/discord-bridge/SKILL.md`, `Discord Agents/skills/discord-harness.md`.

---

## 1. APP / DATA separation model (planning §3·§8)

- **APP (fixed kit)** = this repo (bot, engine, harness, skill, `.env`, token). Installed in one place.
- **DATA (content)** = consumer subject project folder (manifest, deck, config = persona, injection-interface).
- "App is fixed; only the content folder is swapped." The bot **mounts the content folder** and serves that subject on Discord.
- One shared learning-bot token (1 bot per token); only the content folder changes between runs. Separate app/token/server from discord-bridge (SoT §0).

---

## 2. global skill (`~/.claude/skills/<name>/SKILL.md`)

Any folder session in a consumer project that reads this file knows the **APP path and how to launch** (analogous to how discord-bridge surfaces the cwd on Discord).
SKILL.md content contract:
- **APP path**: `APP = <absolute path of this repo>`. Bot, engine, harness, `.env`, and token live here.
- **Launch command**: from the consumer content folder, `python "<APP>/bot/main.py" [content-folder]`. Defaults to cwd when folder is omitted.
- **APP/DATA description**: token and `.env` are read from APP, so no per-folder reconfiguration needed. Only mount the content.
- **Triggers**: "put this subject on Discord", "launch the learning bot", "run <framework-name>", etc.
- **Prerequisites**: new bot app, token, learning server, `.env` (§5). Refuse to launch with a message if unmet.
- **Secrets**: token lives in APP `.env` only; never expose it.
- Skill body is imperative and concise (operational directives). No design prose (lesson from discord skill redesign).

---

## 3. install script (`skills/install.py`)

- Run once after cloning or distribution. Auto-detects the clone location and writes `~/.claude/skills/<name>/SKILL.md` (the only absolute path is injected by install; never committed).
- Self-locating (path-independent). Guides the user to fill in `.env.example`. Flow: `git clone -> python skills/install.py -> write .env -> launch`.
- Bot, engine, and harness are also self-locating (no absolute paths committed).

---

## 4. Launching (from a consumer folder)

```
python "<APP>/bot/main.py" [content-folder] [--resume?]
```
- content-folder = mount target (defaults to cwd). The bot loads manifest, deck, and config from that folder (injection-interface).
- Progress is saved in that content folder's `_state/` directory (per-content progress isolation, SoT §2).
- Stop with Ctrl+C. One bot instance per token.
- A consumer project typically launches its subject with a single line: `python "<APP>/bot/main.py"` from its own folder.

---

## 5. Prerequisites (user actions, planning §12)

1. Discord developer portal: **create a new bot app and issue a token** (separate from the bridge bot).
2. **Create a new dedicated learning server (guild)** and invite the bot (required permissions + `applications.commands` scope).
3. Write 4 keys (token, guild ID, channel ID, allowed user IDs) into APP `.env`.
- If permissions or scope are missing, some features (threads, webhooks, file upload, slash commands) are disabled; bot falls back to basic chat with a warning.

---

## 6. Distribution (optional, private)

- `.gitignore` excludes `.env` (token), `_state`, and `__pycache__`. `.env.example` provides a key template.
- The global skill (absolute-path artifact) is not committed; install generates it. Only bot, engine, harness, and skills source are committed.
