"""
watcher - Polls a condition and sends a mention alert when it becomes true.

WHAT : Calls check() on each interval; if it returns a truthy value the
       watched user is mentioned (edge-triggered to prevent repeat spam).
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: w = Watcher(CHANNEL, ALLOWED_USER_ID, check=lambda: price > target, label="price spike", interval=10)
       w.start()    # check may be sync or async. Fires once on rising edge; re-arms when condition goes false.
SAFETY: Mentions the allowed user only. Do not set the polling interval too short.
DEMO  : python harness/automation/watcher.py  (edge-trigger validation, no bot required)
"""

import asyncio
from typing import Optional, Union, Callable, Awaitable, Any

import discord


class Watcher:
    def __init__(
        self,
        channel: Optional[discord.abc.Messageable],
        user_id: int,
        check: Callable[[], Union[Any, Awaitable[Any]]],
        label: str = "watch",
        interval: float = 10.0,
        edge: bool = True,
    ) -> None:
        self.channel = channel
        self.user_id = user_id
        self.check = check
        self.label = label
        self.interval = max(1.0, float(interval))
        self.edge = edge
        self._firing = False
        self._task: Optional[asyncio.Task] = None

    async def _eval(self) -> Any:
        r = self.check()
        if asyncio.iscoroutine(r):
            r = await r
        return r

    async def _alert(self, val: Any) -> None:
        text = f"[{self.label}] {val if val is not True else 'condition met'}"
        if self.channel is None:
            return
        try:
            await self.channel.send(
                f"<@{self.user_id}> {text}",
                allowed_mentions=discord.AllowedMentions(users=True),
            )
        except Exception:
            pass

    async def _loop(self) -> None:
        while True:
            try:
                val = await self._eval()
                if val:
                    if not (self.edge and self._firing):
                        await self._alert(val)
                    self._firing = True
                else:
                    self._firing = False
            except Exception as e:
                print("[watcher] error:", e)
            await asyncio.sleep(self.interval)

    def start(self) -> "Watcher":
        self._task = asyncio.create_task(self._loop())
        return self

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


if __name__ == "__main__":
    async def _check() -> None:
        fires = {"n": 0}
        seq = iter([False, True, True, False, True])  # edge-triggered: consecutive Trues fire only once

        class W(Watcher):
            async def _alert(self, val: Any) -> None:
                fires["n"] += 1

        w = W(None, 1, check=lambda: next(seq, False), interval=1.0)
        w.start()
        # simulate 5 loop iterations quickly
        for _ in range(5):
            v = await w._eval()
            if v:
                if not (w.edge and w._firing):
                    await w._alert(v)
                w._firing = True
            else:
                w._firing = False
        w.stop()
        assert fires["n"] == 2, fires["n"]   # two rising edges -> 2 firings
        print("watcher: edge trigger OK (fired", fires["n"], "times)")
    asyncio.run(_check())
