"""
scheduler - periodic and time-of-day task scheduling (cron-like).

WHAT : Runs a callback every N seconds, or once daily at a fixed HH:MM time,
       as a background asyncio Task.
DEPS : (standard library only)
USAGE: every(60, job)          # run job() every 60 seconds (sync or async)
       daily("09:00", job)     # run job() every day at 09:00
       Both functions return an asyncio.Task. Call task.cancel() to stop.
SAFETY: Exceptions raised by the callback are caught and logged so the
        schedule loop never dies silently.
DEMO  : python harness/automation/scheduler.py  (validates periodic execution)
"""

import asyncio
import datetime
from typing import Callable, Optional


async def _safe(job: Callable) -> None:
    try:
        r = job()
        if asyncio.iscoroutine(r):
            await r
    except Exception as e:
        print("[scheduler] job error:", e)


def every(seconds: float, job: Callable) -> asyncio.Task:
    async def loop() -> None:
        while True:
            await asyncio.sleep(seconds)
            await _safe(job)
    return asyncio.create_task(loop())


def daily(
    hhmm: str,
    job: Callable,
    tzinfo: Optional[datetime.timezone] = None,
) -> asyncio.Task:
    hh, mm = (int(x) for x in hhmm.split(":"))

    async def loop() -> None:
        while True:
            now = datetime.datetime.now(tzinfo)
            nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if nxt <= now:
                nxt += datetime.timedelta(days=1)
            await asyncio.sleep((nxt - now).total_seconds())
            await _safe(job)
    return asyncio.create_task(loop())


if __name__ == "__main__":
    async def _check() -> None:
        n = {"c": 0}
        t = every(0.1, lambda: n.__setitem__("c", n["c"] + 1))
        await asyncio.sleep(0.35)
        t.cancel()
        assert n["c"] >= 2
        print("scheduler: every() periodic execution OK (", n["c"], "calls )")
    asyncio.run(_check())
