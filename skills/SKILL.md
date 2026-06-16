---
name: learning-harness
description: Mounts a subject folder onto a Discord learning bot. The bot app is installed in one place; only the content folder is swapped to launch. Use for requests like "put this subject on Discord", "start the learning bot", "run v5", "launch the learning framework".
---

# learning-harness (global skill)

The learning bot app is installed in the folder below (code, engine, harness, and token live here):

```
APP = <APP>
```

The app (code and token) and data (content folder) are separated. The app is fixed; only the content folder is swapped. The token and `.env` are read from APP, so there is no need to reconfigure them for each subject folder.

## Prerequisites (bot will not start if any are missing)

All three of the following must be in place before the bot can start. If any are missing, do not launch and inform the user instead.

1. **Create a new bot app and issue a token in the Discord Developer Portal.** Use a separate app, token, and server from discord-bridge (reusing the same token is not allowed).
2. **Create a new Discord server (guild) dedicated to learning.** When inviting the bot to that server, grant `bot` + `applications.commands` scopes and message read/write, thread, and file attachment permissions.
3. **Fill in the four required keys in the `.env` file inside the APP folder.** Copy `.env.example` and fill in the values.

If permissions or scopes are insufficient, some features such as threads and slash commands will be disabled with a warning, but basic operation is maintained.

## Mounting a subject folder to Discord

Run the following from the subject folder you want to use. That folder's manifest, deck, and config will be injected into the bot.

```
python "<APP>/bot/main.py"
```

To target a different folder, specify the path explicitly.

```
python "<APP>/bot/main.py" "C:\path\to\subject-folder"
```

- If the folder is omitted, the current cwd is used as the mount target.
- Progress is saved under the `_state/` subdirectory of that content folder. Progress is isolated per subject.
- To stop, press Ctrl+C in the terminal. Because only one token is used, only one instance can run at a time.

## Command-line arguments

```
python "<APP>/bot/main.py" [content-folder]
```

- **content-folder**: Omit to use the current cwd. If provided, that absolute or relative path is used as the mount target.
- Mount priority: argument > `.env MOUNT` > cwd.

## Notes

- Keep secrets such as the token only in the APP's `.env` and never expose them.
- AI features (layer 3 capabilities) require the `claude` CLI to be on PATH. If it is absent, only those capabilities are disabled.
- Run `python "<APP>/skills/install.py"` once to register this skill under `~/.claude/skills/`.
