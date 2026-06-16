# Discord harness kit (`harness/`)

A catalog of **copy-and-use, self-contained snippets** covering almost everything a
Discord bot can do. An AI (or a developer) **reads this index, picks only the files a
task needs, and copies/adapts them.** Each file works on its own (minimal inline
helpers) and ships a standalone demo (`python harness/<path>.py`).

Nothing here runs automatically (opt-in). The kit lives in its own path, separate from
any bot it is copied into.

- **License:** MIT (see `LICENSE`). **Version:** see `VERSION`.
- **Built with AI (Claude).**
- **Machine-readable index:** `index.json` (regenerate with `python harness/build_index.py`).

---

## How to use (rules for the AI)

1. **Selection.** Read this index (or `index.json`) first -> pick **only the files the
   task needs** -> copy them -> fill the placeholders per each file's `USAGE` and bring
   along the files listed in `DEPS` -> wire them into the target bot -> tell the user (FYI)
   what you enabled.
2. **Pick from the index.** Don't read all the code; narrow by the one-line summaries,
   then open only the files you need.
3. **Opt-in / minimalism.** Files you don't use stay off (don't copy them).
4. **Per-project copy model.** To reuse in another project, copy this `harness/` folder to
   `<project>/harness/` and adapt it there. Keep harness code in that project's own
   `harness/` path.
5. **Placeholders.** Names to fill after copying: `CHANNEL` (target channel/thread),
   `ALLOWED_USER_ID` (the only user allowed to command), `WORKDIR` (work folder).

### Hard constraints (every file)
- **Allowlist gating.** Commands and interactions accept only `ALLOWED_USER_ID`.
- **No secrets in output.** Never print tokens/keys/env values; cite config by path and
  field name. Sensitive files (`.env`, `*.key`, ...) are never shown or attached.
- **Live updates coalesce.** In-place updates edit a message at most once per second
  (rate limit ~5 messages / 5 s per channel).
- **Permissions / scope.** Threads, webhooks, file attach, and slash commands need the bot
  (re-)invited with the matching permissions + the `applications.commands` scope.
- **One bot instance per token.** Don't run two bot processes on the same token.
- **Heavy / special deps.** `media/voice` needs PyNaCl + ffmpeg. The `community/` files
  need strong guild permissions. Missing deps/perms fail gracefully.

### File header schema (each file's docstring)
```
WHAT   : one-line description
DEPS   : discord.py>=2.6 (+ extra packages), companion harness files
PERMS  : Discord permissions / scopes required
INTENTS: gateway intents required (only when applicable)
USAGE  : what to fill in and how to call / wire it
SAFETY : gating / secrets / rate-limit notes
```

> Note: `install.py` at the repo root writes a helper skill to `~/.claude/skills/`; that
> is a setup step for Claude Code users only and is unrelated to this kit.

---

## Index - mainstream (core agent capabilities)

### output/ - outgoing messages
- `output/cards.py` - Components V2 card builders (Container/Section/Separator/MediaGallery/Thumbnail)
- `output/embeds.py` - classic embeds (fields/author/footer/timestamp/image)
- `output/chunk.py` - split long text into 2000-char messages / code blocks
- `output/mention.py` - mention the user for a push notification
- `output/reply.py` - reply (message reference) and message forwarding
- `output/reactions.py` - add reactions and collect a choice
- `output/pins.py` - pin / unpin messages
- `output/typing_indicator.py` - typing indicator (renamed to avoid shadowing stdlib `typing`)
- `output/suppress.py` - suppress link previews / embeds

### live/ - in-place updates (coalescing)
- `live/livecard.py` - live-update a single card's numbers/fields (coalescing base)
- `live/livetable.py` - live-update a multi-row table (portfolio / leaderboard)
- `live/progressbar.py` - in-place progress-bar card
- `live/logtail.py` - rolling tail of the last N log lines
- `live/livechart.py` - periodically render and replace a chart image

### interaction/ - interactive components
- `interaction/confirm.py` - button approval -> bool (with timeout)
- `interaction/buttons.py` - buttons (styles / link / emoji)
- `interaction/selects.py` - select menus (string/user/role/channel/mentionable)
- `interaction/form.py` - modal form (TextInput + Checkbox/RadioGroup/FileUpload/Label)
- `interaction/poll.py` - native poll + vote handling
- `interaction/paginator.py` - button pagination
- `interaction/contextmenu.py` - right-click context menus (user/message)
- `interaction/persistviews.py` - persistent views that survive restarts (custom_id/DynamicItem)

### slash/ - slash commands
- `slash/slash.py` - registration/sync/choices/autocomplete/groups/ephemeral/defer
- `slash/installctx.py` - user-install / DM contexts (allowed_installs/contexts)

### channels/ - channels & structure
- `channels/channels.py` - auto-create / edit text channels
- `channels/threads.py` - create / archive / lock threads
- `channels/forum.py` - forum posts + tags
- `channels/webhook.py` - post under a webhook identity (name/avatar)

### media/ - files & media
- `media/files.py` - attach files (dynamic filesize_limit + sensitive-file guard)
- `media/imagesend.py` - send / replace chart & image attachments
- `media/voice.py` - join a voice channel and play audio [heavy: PyNaCl + ffmpeg]

### automation/ - flow & automation
- `automation/gating.py` - allowed-user / channel gating
- `automation/events.py` - catalog of useful event hooks (joins/voice/deletes/...)
- `automation/scheduler.py` - interval / daily scheduling (cron-like)
- `automation/watcher.py` - poll a condition -> mention alert on rising edge
- `automation/heartbeat.py` - dead-man signal-loss detection
- `automation/digest.py` - roll up events into a periodic summary
- `automation/filedrop.py` - watch a folder -> post new files
- `automation/metricpush.py` - push named metrics -> live dashboard card
- `automation/store.py` - JSON persistent state (config/counters)
- `automation/driver.py` - session-independent autonomous job driver (crash-tolerant, resumable, webhook ping) for long search/solve loops
- `automation/ratelimit.py` - coalescing / queue rate-limit pattern

### meta/ - bot meta
- `meta/presence.py` - bot status / activity (playing/watching/custom)
- `meta/dm.py` - direct messages (send/receive)
- `meta/botinvite.py` - build a bot re-invite OAuth URL (permission int + scopes)
- `meta/checklist.py` - intents & permission checks

---

## Index - non-mainstream (`community/`, community & server management)

Need strong guild permissions and are not core agent work. Use only for community/server
operations.

- `community/moderation.py` - kick/ban/timeout/bulk-delete/nickname
- `community/automod.py` - automod rules [niche]
- `community/audit.py` - read the audit log
- `community/roles.py` - create/assign/remove roles
- `community/permissions.py` - channel permission overwrites
- `community/invites.py` - create/track guild invites
- `community/scheduledevents.py` - guild scheduled events
- `community/categories.py` - channel category organization
- `community/stickers.py` - send guild stickers
- `community/emoji.py` - use/manage custom emoji
- `community/soundboard.py` - soundboard [niche]
- `community/monetization.py` - SKU / premium button / entitlement [niche]
