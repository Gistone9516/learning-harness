"""
store - JSON-backed persistent state storage.

WHAT  : Saves and loads small state (settings, counters, etc.) as a JSON file so
        it survives bot restarts.
DEPS  : (standard library only)
USAGE : s = Store("state.json"); s.set("count", s.get("count", 0) + 1); s.save()
SAFETY: Do not store secrets here. Keep the path inside the working directory;
        never put API keys or tokens in a Store file.
DEMO  : python harness/automation/store.py   (write-then-read verification)
"""

import os
import json
from typing import Any, Optional


class Store:
    def __init__(self, path: str) -> None:
        self.path = path
        self.data: dict[str, Any] = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception:
                self.data = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value

    def save(self) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)  # atomic replace


if __name__ == "__main__":
    import tempfile
    p = os.path.join(tempfile.gettempdir(), "harness_store_test.json")
    s = Store(p); s.set("count", s.get("count", 0) + 1); s.save()
    assert Store(p).get("count") >= 1
    os.remove(p)
    print("store: save/load OK")
