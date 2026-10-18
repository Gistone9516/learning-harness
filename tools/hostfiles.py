# -*- coding: utf-8 -*-
"""What a web host serves for one subject (specs/web-gateway.md §4).

Shared by tools/serve_host.py (one subject at /) and tools/gateway (many subjects under a prefix), so the two
hosts cannot disagree about which files are reachable. `rel` is the path below the subject root, already
URL-decoded, without a leading slash:

    "" | "index.html" | "host.js" | "host.css"  -> tools/webhost/
    "kit/<f>"                                   -> <kit>/web/dist/<f>
    "content/<f>"                               -> <subject>/content/<f>, or the file named for <f> in
                                                   app.json "contentLinks" (relative to content/)

Anything that resolves outside its root is refused (None). local.config.js is not resolved here: the local
host reads the subject's file, the gateway generates one without the token (GW-3).
"""
from __future__ import annotations

import json
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
WEBHOST = KIT / "tools" / "webhost"
HOST_FILES = ("host.js", "host.css")


def _inside(base: Path, rel: str) -> Path | None:
    target = (base / rel).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    return target


def content_links(subject: Path) -> dict[str, str]:
    """app.json "contentLinks": names under content/ that are served from another file of the subject."""
    try:
        cfg = json.loads((subject / "content" / "app.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    links = cfg.get("contentLinks") if isinstance(cfg, dict) else None
    if not isinstance(links, dict):
        return {}
    return {str(k): str(v) for k, v in links.items() if isinstance(k, str) and isinstance(v, str)}


def resolve(subject: Path, kit_dist: Path, rel: str) -> Path | None:
    clean = rel.split("?", 1)[0].split("#", 1)[0].lstrip("/")
    if clean in ("", "index.html"):
        return WEBHOST / "index.html"
    if clean in HOST_FILES:
        return WEBHOST / clean
    if clean.startswith("kit/"):
        return _inside(kit_dist, clean[len("kit/"):])
    if clean.startswith("content/"):
        name = clean[len("content/"):]
        link = content_links(subject).get(name)
        if link is not None:
            # Listed by the subject itself, so it may point outside content/; it must stay a file.
            target = (subject / "content" / link).resolve()
            return target if target.is_file() else None
        return _inside(subject / "content", name)
    return None
