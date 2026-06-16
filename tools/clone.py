#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Clone the core kernel + selected capability bundles from this kit into a consuming project.

The kit (this repo) stays a pristine template. A consuming project copies only the
capabilities it enables, preserving the bot/ + engine/ + bot/harness/ layout so the
cloned tree runs standalone via `python bot/main.py <mount>`.

Usage:
  python tools/clone.py --target <DIR> (--from-config | --caps a,b,c) \
                        [--deck NS] [--env copy|skip] [--dry-run]

- --from-config : read enabled capabilities from <DIR>/config/<deck>.json
- --caps        : explicit comma-separated capability_id list
- --env copy    : also copy the kit .env into the target (Discord token; default skip)
- --dry-run     : print the file plan, copy nothing

Copies: CORE_KERNEL_FILES + package __init__.py markers + each enabled capability's
files + shared bases (deduped, transitive over dep_capabilities). The target's content
(manifest/decks/config/_state) is never touched. The kit is never modified.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

_KIT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_KIT_ROOT, "bot"))

import capability_registry as reg  # pure data module, no side effects


def _read_enabled_from_config(target: str, deck_ns: str | None):
    with open(os.path.join(target, "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    decks = man.get("decks", [])
    if not decks:
        raise SystemExit("manifest.json has no decks")
    if deck_ns is None:
        deck_ns = decks[0].get("namespace")
    entry = next((d for d in decks if d.get("namespace") == deck_ns), decks[0])
    cfg_ref = entry.get("config_ref") or f"config/{deck_ns}.json"
    with open(os.path.join(target, cfg_ref), encoding="utf-8") as f:
        cfg = json.load(f)
    enabled = list(cfg.get("capabilities", {}).get("enabled", []))
    if not enabled:
        enabled = sorted(reg.default_core_ids())
    return set(enabled), deck_ns


def main() -> None:
    ap = argparse.ArgumentParser(description="Clone kit capabilities into a consuming project.")
    ap.add_argument("--target", required=True)
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--caps", help="comma-separated capability_id list")
    grp.add_argument("--from-config", action="store_true", help="read caps from target config")
    ap.add_argument("--deck", default=None)
    ap.add_argument("--env", choices=["copy", "skip"], default="skip")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    target = os.path.abspath(args.target)
    if not os.path.isdir(target):
        raise SystemExit(f"target is not a directory: {target}")

    if args.from_config:
        enabled, _deck = _read_enabled_from_config(target, args.deck)
    else:
        enabled = {s.strip() for s in args.caps.split(",") if s.strip()}

    # Layer-4-always capabilities are always part of the active set.
    enabled |= set(reg.layer4_always())

    unknown = sorted(c for c in enabled if c not in reg.REGISTRY)
    if unknown:
        raise SystemExit(f"unknown capability_id(s): {unknown}")

    copy_set = sorted(
        set(reg.CORE_KERNEL_FILES) | set(reg.CORE_PACKAGE_INITS) | reg.files_for(enabled)
    )

    # Verify every source exists before copying anything (never a partial clone).
    missing = [p for p in copy_set if not os.path.exists(os.path.join(_KIT_ROOT, p))]
    if missing:
        raise SystemExit(f"kit is missing source files, aborting: {missing}")

    print(f"[clone] kit:    {_KIT_ROOT}")
    print(f"[clone] target: {target}")
    print(f"[clone] caps:   {sorted(enabled)}")
    print(f"[clone] files:  {len(copy_set)}")

    copied = 0
    for rel in copy_set:
        src = os.path.join(_KIT_ROOT, rel)
        dst = os.path.join(target, rel)
        if args.dry_run:
            print(f"  [dry] {rel}")
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    if not args.dry_run:
        print(f"[clone] copied {copied} files")

    if args.env == "copy" and not args.dry_run:
        env_src = os.path.join(_KIT_ROOT, ".env")
        if os.path.exists(env_src):
            shutil.copy2(env_src, os.path.join(target, ".env"))
            print("[clone] copied .env")
        else:
            print("[clone] WARN: kit .env not found; skipped")

    if not args.dry_run:
        gi = os.path.join(target, ".gitignore")
        existing = ""
        if os.path.exists(gi):
            with open(gi, encoding="utf-8") as f:
                existing = f.read()
        add = [n for n in ("_state/", ".env", "__pycache__/") if n not in existing]
        if add:
            with open(gi, "a", encoding="utf-8") as f:
                if existing and not existing.endswith("\n"):
                    f.write("\n")
                f.write("\n".join(add) + "\n")
            print(f"[clone] updated .gitignore (+{add})")

    print("[clone] done")


if __name__ == "__main__":
    main()
