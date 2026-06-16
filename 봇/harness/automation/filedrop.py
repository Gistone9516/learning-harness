"""
filedrop - Watch a folder and post new files to a channel.

WHAT  : Polls a directory and uploads any newly-appeared files as Discord
        attachments (remote file delivery).
DEPS  : discord.py>=2.6
PERMS : Attach Files
USAGE : fd = FileDrop(CHANNEL, "/path/to/watch", interval=5); fd.start()
SAFETY: Sensitive files (.env, *.key, etc.) are never sent. Mind the
        attachment size limit.
DEMO  : python harness/automation/filedrop.py  (guard validation)
"""

import os
import asyncio
from typing import Optional

import discord

_SENS_END = (".pem", ".key", ".secret", ".p12", ".pfx")


def _sensitive(name: str) -> bool:
    n = name.lower()
    return n.startswith(".env") or n in ("id_rsa", "id_dsa") or n.endswith(_SENS_END)


class FileDrop:
    def __init__(
        self,
        channel: "discord.abc.Messageable",
        watch_dir: str,
        interval: float = 5.0,
    ) -> None:
        self.channel = channel
        self.dir = os.path.abspath(watch_dir)
        self.interval = float(interval)
        self._seen = set(os.listdir(self.dir)) if os.path.isdir(self.dir) else set()
        self._task: Optional[asyncio.Task] = None

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.interval)
                try:
                    cur = set(os.listdir(self.dir))
                    for name in sorted(cur - self._seen):
                        path = os.path.join(self.dir, name)
                        if _sensitive(name) or not os.path.isfile(path):
                            continue
                        try:
                            await self.channel.send(f"New file: {name}", file=discord.File(path))
                        except Exception:
                            pass
                    self._seen = cur
                except Exception:
                    pass
        except asyncio.CancelledError:
            pass

    def start(self) -> "FileDrop":
        self._task = asyncio.create_task(self._loop())
        return self

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


if __name__ == "__main__":
    assert _sensitive(".env") and _sensitive("a.key") and not _sensitive("a.txt")
    print("filedrop: sensitive-file guard OK")
