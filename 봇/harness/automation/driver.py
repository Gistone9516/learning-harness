"""
driver - Session-independent autonomous job driver (the engine for long search/solve loops).

WHAT  : Runs a queue of attempts in its OWN process (host or docker). It survives
        per-job crashes, persists progress so a restart resumes where it left off,
        and pings a Discord webhook only at milestones (solution found / exhausted /
        optional heartbeat). Built so an overnight loop does NOT depend on a live
        Claude or bot session: the bot just reads the state file to observe.
DEPS  : (standard library only - json, urllib). Your attempt() may use anything.
PERMS : none for the driver itself. The webhook ping needs a Discord channel
        webhook URL (Server Settings -> Integrations -> Webhooks).
USAGE : define attempt(job) -> result; build a list of jobs; then
          d = Driver("solve_state.json", webhook=URL, label="factor7")
          win = d.run(jobs, attempt, is_solution=lambda r: r and r.get("solved"))
        Run it detached so it outlives any session:
          nohup python your_driver.py >> driver.out 2>&1 &
        Observe progress from anywhere (bot, shell):
          python harness/automation/driver.py status solve_state.json
SAFETY: every attempt is wrapped in try/except so one crash never stops the loop;
        the state file is written atomically and is resumable (jobs keyed by a stable
        id, not list position); the webhook URL is passed in / read from env, never
        hardcoded; no secrets are printed.
DEMO  : python harness/automation/driver.py   (crash-tolerance + solve + resume, offline)
"""

import os
import sys
import json
import time
import hashlib
import urllib.request
from typing import Any, Callable, Optional, Iterable


def _job_key(job: Any) -> str:
    # A stable identity for a job so resume survives reordering. Use an explicit
    # "id" when present, otherwise hash the job's JSON form.
    if isinstance(job, dict) and "id" in job:
        return str(job["id"])
    blob = json.dumps(job, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


def _default_is_solution(result: Any) -> bool:
    if isinstance(result, dict):
        return bool(result.get("solved"))
    return bool(result)


class Driver:
    def __init__(self, state_path: str, webhook: Optional[str] = None, label: str = "driver") -> None:
        self.state_path = state_path
        self.webhook = webhook or os.environ.get("DRIVER_WEBHOOK") or None
        self.label = label
        self.state = self._load()

    # ---- persistence ----
    def _load(self) -> dict:
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"label": self.label, "done": {}, "solved_key": None,
                "solution": None, "started": time.time(), "updated": None,
                "attempted": 0, "errors": 0}

    def _save(self) -> None:
        self.state["updated"] = time.time()
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp, self.state_path)  # atomic

    # ---- notify (print + optional webhook + log line) ----
    def _post(self, content: str) -> None:
        if not self.webhook:
            return
        try:
            data = json.dumps({"content": content[:1900]}).encode("utf-8")
            req = urllib.request.Request(
                self.webhook, data=data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            print("[driver] webhook failed:", type(e).__name__)

    def _event(self, msg: str, ping: bool = False) -> None:
        line = "[" + self.label + "] " + msg
        print(line)
        try:
            with open(self.state_path + ".log", "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S") + " " + line + "\n")
        except Exception:
            pass
        if ping:
            self._post(line)

    # ---- main loop ----
    def run(self, jobs: Iterable[Any], attempt: Callable[[Any], Any],
            is_solution: Optional[Callable[[Any], bool]] = None,
            ping_every: int = 0) -> Optional[Any]:
        """Consume jobs in order, calling attempt(job) on each. Returns the winning
        result when is_solution is met, or None when the queue is exhausted. Already
        done jobs (by key) are skipped, so re-running resumes. ping_every>0 also sends
        a heartbeat ping every N freshly attempted jobs."""
        decide = is_solution or _default_is_solution
        done = self.state["done"]
        if self.state.get("solved_key"):
            self._event("already solved on a previous run; nothing to do.")
            return self.state.get("solution")
        self._event("start. " + str(len(done)) + " job(s) already done, resuming.", ping=False)

        for job in jobs:
            key = _job_key(job)
            if key in done:
                continue
            try:
                result = attempt(job)
                ok, err = True, None
            except KeyboardInterrupt:
                self._event("interrupted by user (KeyboardInterrupt). Progress saved.", ping=False)
                self._save()
                raise
            except Exception as e:
                result, ok, err = None, False, type(e).__name__ + ": " + str(e)
                self.state["errors"] += 1
                self._event("job " + key + " crashed: " + err + " (continuing)")

            self.state["attempted"] += 1
            solved = bool(ok and decide(result))
            done[key] = {"ok": ok, "error": err, "solved": solved,
                         "summary": _summarize(result), "t": time.time()}
            if solved:
                self.state["solved_key"] = key
                self.state["solution"] = result if _jsonable(result) else _summarize(result)
            self._save()

            if solved:
                self._event("SOLVED by job " + key + ". " + _summarize(result), ping=True)
                return result
            if ping_every and self.state["attempted"] % ping_every == 0:
                self._event("heartbeat: " + str(self.state["attempted"]) +
                            " attempted, " + str(self.state["errors"]) + " errors.", ping=True)

        self._event("EXHAUSTED: no solution in " + str(len(done)) +
                    " job(s), " + str(self.state["errors"]) + " errors. Human decision needed.", ping=True)
        return None

    # ---- observer view (read-only) ----
    def status(self) -> dict:
        s = self.state
        return {"label": s.get("label"), "attempted": s.get("attempted", 0),
                "errors": s.get("errors", 0), "solved": s.get("solved_key"),
                "done": len(s.get("done", {})), "updated": s.get("updated")}


def _summarize(result: Any, limit: int = 300) -> str:
    if result is None:
        return ""
    if isinstance(result, dict):
        result = {k: result[k] for k in list(result)[:8]}
    try:
        text = json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        text = str(result)
    return text[:limit]


def _jsonable(x: Any) -> bool:
    try:
        json.dumps(x, default=str)
        return True
    except Exception:
        return False


if __name__ == "__main__":
    # CLI: `python driver.py status <state_path>` prints progress for an observer.
    if len(sys.argv) >= 3 and sys.argv[1] == "status":
        d = Driver(sys.argv[2])
        print(json.dumps(d.status(), ensure_ascii=False, indent=2))
        sys.exit(0)

    # DEMO (offline, no webhook): one job crashes, the loop keeps going, finds the
    # target, and a second run resumes without re-doing finished jobs.
    import tempfile
    state = os.path.join(tempfile.gettempdir(), "harness_driver_test.json")
    for p in (state, state + ".tmp", state + ".log"):
        if os.path.exists(p):
            os.remove(p)

    jobs = [{"id": i, "n": i} for i in range(6)]  # search for n == 4

    def attempt(job):
        if job["n"] == 3:
            raise ValueError("simulated crash on n=3")
        return {"solved": job["n"] == 4, "n": job["n"]}

    d = Driver(state, label="demo")
    win = d.run(jobs, attempt, is_solution=lambda r: bool(r and r.get("solved")))
    assert win and win["n"] == 4, win
    assert d.state["errors"] == 1, d.state["errors"]            # the n=3 crash was survived
    attempted_first = d.state["attempted"]

    # resume: a fresh Driver over the same state should not redo finished jobs
    d2 = Driver(state, label="demo")
    again = d2.run(jobs, attempt, is_solution=lambda r: bool(r and r.get("solved")))
    assert again and again["n"] == 4
    assert d2.state["attempted"] == attempted_first, (d2.state["attempted"], attempted_first)

    for p in (state, state + ".tmp", state + ".log"):
        if os.path.exists(p):
            os.remove(p)
    print("driver: crash-tolerance + solve + resume OK")
