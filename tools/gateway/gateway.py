# -*- coding: utf-8 -*-
"""Study gateway: many web subjects under one prefix, behind a login (specs/web-gateway.md).

    python tools/gateway/gateway.py --config <file> --set-password
    python tools/gateway/gateway.py --config <file>

Run it as the user logged in to the claude CLI (the subscription login lives in that profile).
"""
from __future__ import annotations

import argparse
import getpass
import http.server
import logging
import os
import signal
import socket
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import app  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
from children import Supervisor  # noqa: E402

KIT = HERE.parents[1]


class ExclusiveServer(http.server.ThreadingHTTPServer):
    """GW-1: the port is ours alone. socketserver marks it reusable, and on Windows that lets a second
    gateway bind the same port beside the first, each then answering part of the traffic."""
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def set_password(path: Path) -> int:
    pw = getpass.getpass("new password: ")
    if len(pw) < 8:
        print("password must be at least 8 characters", file=sys.stderr)
        return 1
    if getpass.getpass("again: ") != pw:
        print("passwords differ", file=sys.stderr)
        return 1
    config.save_auth(path, auth.hash_password(pw), auth.new_secret())
    print("password set; every existing session is now signed out (GW-9).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve web subjects under one prefix, behind a login.")
    parser.add_argument("--config", required=True, help="gateway config file (outside the kit)")
    parser.add_argument("--set-password", action="store_true", help="set the login password and rotate the secret")
    parser.add_argument("--no-children", action="store_true", help="do not start ai_server processes (tests)")
    args = parser.parse_args()
    path = Path(args.config).expanduser().resolve()

    if args.set_password:
        return set_password(path)

    log_dir = path.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(log_dir / "gateway.log", encoding="utf-8")])
    try:
        cfg = config.load(path)
    except config.ConfigError as e:
        logging.error("config: %s", e)
        return 2
    if not cfg.auth.password_hash or not cfg.auth.secret:
        logging.error("no password set; run with --set-password first")
        return 2
    kit_dist = KIT / "web" / "dist"
    if not (kit_dist / "assets" / "index.js").is_file():
        logging.error("kit bundle not built: %s (run npm run build in %s)", kit_dist, KIT / "web")
        return 2

    if cfg.extra_path:
        os.environ["PATH"] = os.pathsep.join([*cfg.extra_path, os.environ.get("PATH", "")])
    handler = app.make_handler(cfg, kit_dist, auth.Throttle())
    try:
        httpd = ExclusiveServer(("127.0.0.1", cfg.port), handler)
    except OSError as e:
        logging.error("port %d is taken (%s); is another gateway running?", cfg.port, e)
        return 3
    supervisor = Supervisor(cfg.subjects, log_dir)
    if not args.no_children:
        supervisor.start()
    logging.info("gateway on http://127.0.0.1:%d%s/  (%d subjects)", cfg.port, cfg.base_path, len(cfg.subjects))

    def shutdown(*_):
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None)):
        if sig is not None:
            signal.signal(sig, shutdown)
    try:
        httpd.serve_forever()
    finally:
        supervisor.stop()
        httpd.server_close()
        logging.info("gateway stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
