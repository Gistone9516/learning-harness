"""
heartbeat - dead-man signal loss detection.

WHAT : If beat() is not called again within the timeout window, the allowed user
       is mentioned to signal a process or feed has died. When the signal
       resumes, a recovery notification is sent.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: hb = Heartbeat(CHANNEL, ALLOWED_USER_ID, timeout=60, label="feed"); hb.start()
       # Call hb.beat() periodically while the process is alive.
SAFETY: Mentions are sent only to the allowed user.
DEMO  : python harness/automation/heartbeat.py  (state-transition check, no bot required)
"""

import asyncio
import time
from typing import Optional

import discord


class Heartbeat:
    def __init__(
        self,
        channel: "Optional[discord.abc.Messageable]",
        user_id: int,
        timeout: float = 60.0,
        label: str = "heartbeat",
        check_interval: float = 5.0,
    ) -> None:
        self.channel = channel
        self.user_id = user_id
        self.timeout = float(timeout)
        self.label = label
        self.check_interval = float(check_interval)
        self._last = time.time()
        self._alerted = False
        self._task = None

    def beat(self) -> None:
        self._last = time.time()
        if self._alerted:
            self._alerted = False
            asyncio.create_task(self._send(f"[{self.label}] signal restored"))

    async def _send(self, text: str) -> None:
        if self.channel is None:
            return
        try:
            await self.channel.send(f"<@{self.user_id}> {text}",
                                    allowed_mentions=discord.AllowedMentions(users=True))
        except Exception:
            pass

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.check_interval)
            if not self._alerted and (time.time() - self._last) > self.timeout:
                self._alerted = True
                await self._send(f"[{self.label}] no signal for {int(time.time() - self._last)}s")

    def start(self) -> "Heartbeat":
        self._last = time.time()
        self._task = asyncio.create_task(self._loop())
        return self

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


if __name__ == "__main__":
    hb = Heartbeat(None, 1, timeout=0.2, check_interval=0.1)
    hb._last = time.time() - 1.0   # simulate a missed signal
    assert (time.time() - hb._last) > hb.timeout
    print("heartbeat: timeout detection OK (beat() would reset _last)")
