#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-shot bootstrap to install the learning-harness kit on any machine.

Run it from a fresh clone. It verifies Python, installs runtime dependencies, registers the global
launch skill at THIS machine's clone path (so nothing is hardcoded to one computer), and prepares a
.env template. Cross-platform: pure Python, the one guaranteed prerequisite. ASCII-only output (the
Windows console is cp949). Idempotent: safe to re-run; never overwrites an existing .env.

Usage:
    python tools/setup.py
"""
import os
import shutil
import subprocess
import sys
import pathlib

# tools/ is one level under the kit root; derive the kit root from this file's location.
APP = pathlib.Path(__file__).resolve().parent.parent


def _stage(label: str) -> None:
    print(f"[setup] {label}")


def main() -> None:
    try:
        # Stage 0: Python version (spec requires 3.11+).
        _stage("checking Python version")
        if sys.version_info < (3, 11):
            print(f"  FAIL: Python 3.11+ required, found {sys.version.split()[0]}", file=sys.stderr)
            sys.exit(1)
        print(f"  OK: Python {sys.version.split()[0]}")

        # Stage 1: runtime dependencies.
        req = APP / "requirements.txt"
        _stage("installing dependencies (requirements.txt)")
        if not req.is_file():
            print(f"  FAIL: not found: {req}", file=sys.stderr)
            sys.exit(1)
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(req)])
        if r.returncode != 0:
            print("  FAIL: pip install failed (see output above)", file=sys.stderr)
            sys.exit(1)
        print("  OK: dependencies installed")

        # Stage 2: register the global launch skill at this machine's clone path.
        _stage("registering the global launch skill (skills/install.py)")
        installer = APP / "skills" / "install.py"
        if not installer.is_file():
            print(f"  FAIL: not found: {installer}", file=sys.stderr)
            sys.exit(1)
        r = subprocess.run([sys.executable, str(installer)])
        if r.returncode != 0:
            print("  FAIL: skill install failed (see output above)", file=sys.stderr)
            sys.exit(1)
        print("  OK: global skill registered for this clone")

        # Stage 3: prepare a .env template (never clobber an existing, filled .env).
        _stage("preparing .env template")
        env = APP / ".env"
        example = APP / ".env.example"
        if env.exists():
            print(f"  OK: .env already exists, kept as-is: {env}")
        elif example.is_file():
            shutil.copyfile(example, env)
            print(f"  OK: created {env} from .env.example")
        else:
            print("  WARN: .env.example not found; create .env manually")

        # Stage 4: optional claude CLI (AI mode only).
        _stage("checking optional claude CLI (AI mode)")
        if shutil.which("claude"):
            print("  OK: claude CLI found, AI capabilities available")
        else:
            print("  WARN: claude CLI not on PATH; AI capabilities disable, deterministic features still work")

        print()
        print("[setup] done. Next steps:")
        print("  1. In the Discord Developer Portal: create a bot app + token, turn on the Message Content")
        print("     Intent, create a learning server, and invite the bot with the applications.commands scope.")
        print(f"  2. Fill the 4 required keys in {env}")
        print("     (DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID, DISCORD_ALLOWED_USER_ID).")
        print("     A subject is a data-only folder with its own .env; run the bot from that folder so its")
        print("     .env loads, or keep this kit-root .env and pass the subject folder as the mount argument.")
        print(f"  3. Launch:  python \"{APP / 'bot' / 'main.py'}\" <subject-folder>")
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[setup] FAILED (unexpected): {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
