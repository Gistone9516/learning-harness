# -*- coding: utf-8 -*-
"""The boot page and static-file efficiency of the gateway (specs/web-gateway.md GW-17, GW-18).

- versions: a content hash per static file, so the page can ask for `?v=<hash>` and the browser may keep it.
- gzip: compressed bytes for text responses, cached per file version.
- page: the generic host page with the subject's app.json, content files, runtime config and a state snapshot
  inlined, so the browser does not spend one round trip on each of them before the first paint.
"""
from __future__ import annotations

import gzip
import hashlib
import http.client
import json
import logging
import threading
from pathlib import Path

import hostfiles
from config import Config, Subject

log = logging.getLogger("gateway.boot")

GZIP_MIN = 1024
_COMPRESSIBLE = ("text/", "application/json", "image/svg+xml")
SNAPSHOT_TIMEOUT_S = 2.0
_lock = threading.Lock()
_versions: dict[tuple[str, int, int], str] = {}
_gzipped: dict[tuple[str, int, int], bytes] = {}

BS = chr(92)
# JSON inside <script>: "<" would let "</script>" close the block; U+2028/2029 end a JS line in older engines.
_SCRIPT_ESCAPES = {"<": BS + "u003c", chr(0x2028): BS + "u2028", chr(0x2029): BS + "u2029"}


def _key(path: Path) -> tuple[str, int, int]:
    st = path.stat()
    return (str(path), st.st_mtime_ns, st.st_size)


def version(path: Path) -> str:
    """First 12 hex of the file's sha256, recomputed only when the file changes (GW-17)."""
    k = _key(path)
    with _lock:
        v = _versions.get(k)
    if v is None:
        v = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        with _lock:
            _versions[k] = v
    return v


def compressible(ctype: str) -> bool:
    return any(ctype.startswith(t) for t in _COMPRESSIBLE)


def gzip_file(path: Path) -> bytes:
    k = _key(path)
    with _lock:
        z = _gzipped.get(k)
    if z is None:
        z = gzip.compress(path.read_bytes(), 6)
        with _lock:
            _gzipped[k] = z
    return z


def script_json(obj) -> str:
    text = json.dumps(obj, ensure_ascii=False)
    for ch, rep in _SCRIPT_ESCAPES.items():
        text = text.replace(ch, rep)
    return text


def _content_files(subject: Subject, kit_dist: Path, app: dict) -> dict:
    """Every file a view names, read the way host.js would (Markdown and text as strings, the rest as JSON)."""
    out: dict = {}
    for view in app.get("views") or []:
        for name in ((view or {}).get("files") or {}).values():
            if not isinstance(name, str) or name in out:
                continue
            target = hostfiles.resolve(subject.dir, kit_dist, "content/" + name)
            if target is None or not target.is_file():
                continue
            try:
                text = target.read_text(encoding="utf-8")
                out[name] = text if name.lower().endswith((".md", ".txt")) else json.loads(text)
            except (OSError, ValueError):
                continue   # host.js fetches what is missing and reports it there
    return out


def snapshot(subject: Subject) -> dict | None:
    conn = http.client.HTTPConnection("127.0.0.1", subject.ai_port, timeout=SNAPSHOT_TIMEOUT_S)
    try:
        conn.request("GET", "/state/_snapshot", headers={"X-AI-Token": subject.token})
        res = conn.getresponse()
        body = json.loads(res.read() or b"{}")
        if res.status != 200 or not body.get("ok"):
            return None
        return {"docs": body.get("docs") or {}, "indexes": body.get("indexes") or {}}
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        conn.close()


def page(cfg: Config, subject: Subject, kit_dist: Path) -> str:
    """The host page with versioned asset URLs and the inline boot block (GW-17, GW-18)."""
    original = (hostfiles.WEBHOST / "index.html").read_text(encoding="utf-8")
    html = original
    try:
        app = json.loads((subject.dir / "content" / "app.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        app = None
    try:
        v = {
            "host.js": version(hostfiles.WEBHOST / "host.js"),
            "host.css": version(hostfiles.WEBHOST / "host.css"),
            "index.css": version(kit_dist / "assets" / "index.css"),
            "index.js": version(kit_dist / "assets" / "index.js"),
        }
    except OSError as e:
        log.error("cannot version the host files (%s); serving the page without the boot block", e)
        return original
    bundle = f"kit/assets/index.js?v={v['index.js']}"
    boot: dict = {"bundle": bundle}
    if isinstance(app, dict):
        boot["app"] = app
        boot["files"] = _content_files(subject, kit_dist, app)
    state = snapshot(subject)
    if state is not None:
        boot["state"] = state
    local = {"serverUrl": f"{cfg.base_path}/{subject.slug}/api", "gated": True}
    inline = ("<script>/* Inlined by the gateway (specs/web-gateway.md GW-3, GW-18). No token. */\n"
              f"window.LH_LOCAL = {script_json(local)};\nwindow.LH_BOOT = {script_json(boot)};\n</script>")
    replacements = [
        ('href="kit/assets/index.css"', f'href="kit/assets/index.css?v={v["index.css"]}"'),
        ('href="kit/assets/index.js"', f'href="{bundle}"'),
        ('href="host.css"', f'href="host.css?v={v["host.css"]}"'),
        ('<script src="local.config.js"></script>', inline),
        ('src="host.js"', f'src="host.js?v={v["host.js"]}"'),
    ]
    for old, new in replacements:
        if html.count(old) != 1:
            log.error("host page changed shape: %r not found once; serving it without the boot block", old)
            return original
        html = html.replace(old, new)
    return html
