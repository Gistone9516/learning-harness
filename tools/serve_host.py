# -*- coding: utf-8 -*-
"""Generic static host for a web subject (specs/web-notebook.md §5).

One port, one origin, four roots:
    /, /host.js, /host.css  -> tools/webhost/                 (generic host page, kit code)
    /local.config.js        -> <subject>/host/local.config.js  (token; git-ignored in the subject)
    /kit/...                -> <kit>/web/dist/                 (the built bundle)
    /content/...            -> <subject>/content/              (app.json and content files)

Local only: binds 127.0.0.1 and answers 404 for anything that resolves outside those roots. What is served
is decided by tools/hostfiles.py, which the gateway (specs/web-gateway.md) shares. This host hands the token
to the page, so it is for localhost; a page for remote browsers goes through the gateway.
"""
from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hostfiles  # noqa: E402

KIT = hostfiles.KIT


class HostHandler(http.server.SimpleHTTPRequestHandler):
    subject: Path
    kit_dist: Path

    def _resolve(self, url_path: str) -> Path | None:
        clean = unquote(url_path.split("?", 1)[0].split("#", 1)[0])
        if clean == "/local.config.js":
            return self.subject / "host" / "local.config.js"
        return hostfiles.resolve(self.subject, self.kit_dist, clean)

    def translate_path(self, path: str) -> str:
        target = self._resolve(path)
        # A path outside every root maps to a name that cannot exist, so the base class answers 404.
        return str(target) if target is not None else str(self.subject / "__not_served__")

    def end_headers(self) -> None:
        # Content and bundle change between runs; a cached copy would hide an edit or a rebuild.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[host] " + fmt % args + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a web subject: generic host page + kit bundle + subject content.")
    parser.add_argument("--subject", required=True, help="subject folder (holds content/ and host/local.config.js)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("HOST_PORT", "8080")))
    parser.add_argument("--kit", default=str(KIT))
    args = parser.parse_args()

    subject = Path(args.subject).resolve()
    kit_dist = Path(args.kit).resolve() / "web" / "dist"
    if not (subject / "content" / "app.json").exists():
        print(f"[host] missing {subject / 'content' / 'app.json'}", file=sys.stderr)
        return 1
    if not (kit_dist / "assets" / "index.js").exists():
        print(f"[host] kit bundle not built: {kit_dist}  (run npm run build in {Path(args.kit) / 'web'})", file=sys.stderr)
        return 1
    if not (subject / "host" / "local.config.js").exists():
        print("[host] warning: host/local.config.js is missing; the page will say so.", file=sys.stderr)

    HostHandler.subject = subject
    HostHandler.kit_dist = kit_dist
    HostHandler.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                                  ".js": "text/javascript", ".json": "application/json", ".css": "text/css"}

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), HostHandler) as httpd:
        print(f"[host] serving http://127.0.0.1:{args.port}  (subject: {subject})", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[host] stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
