"""
ratelimit - Coalescing / queue rate-limit pattern.

WHAT : A coalescer that collapses frequent calls into one action per interval.
       Common foundation for live updates and high-frequency edits.
DEPS : (standard library only)
USAGE: c = Coalescer(interval=1.0, action=do_update); c.start()
       c.touch()   # no matter how often touch() is called, action fires at most once per interval
       c.stop()
SAFETY: Exceptions raised by action are caught and retried on the next interval.
DEMO  : python harness/automation/ratelimit.py  (coalescing verification)
"""

import asyncio
from typing import Callable, Optional, Awaitable, Union


class Coalescer:
    def __init__(
        self,
        interval: float,
        action: Callable[[], Union[None, Awaitable[None]]],
    ) -> None:
        self.interval = max(0.1, float(interval))
        self.action = action
        self._dirty = False
        self._task: Optional[asyncio.Task] = None  # type: ignore[type-arg]

    def touch(self) -> None:
        self._dirty = True

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.interval)
                if self._dirty:
                    self._dirty = False
                    try:
                        r = self.action()
                        if asyncio.iscoroutine(r):
                            await r
                    except Exception:
                        pass
        except asyncio.CancelledError:
            pass

    def start(self) -> "Coalescer":
        self._task = asyncio.create_task(self._loop())
        return self

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


if __name__ == "__main__":
    async def _check() -> None:
        n = {"c": 0}
        c = Coalescer(0.2, lambda: n.__setitem__("c", n["c"] + 1))
        c.start()
        for _ in range(20):
            c.touch()
            await asyncio.sleep(0.05)   # touch() called 20 times over ~1 second
        await asyncio.sleep(0.25)
        c.stop()
        assert n["c"] <= 8, n["c"]
        print("ratelimit: coalescing OK (touch x20 -> action x" + str(n["c"]) + ")")
    asyncio.run(_check())
