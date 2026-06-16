"""
build_index.py - Generate index.json from the harness file headers.

Parses every harness/**/*.py module docstring (the WHAT / DEPS / PERMS / USAGE /
SAFETY / INTENTS fields plus heavy/niche markers) into a machine-readable
manifest, and checks the README index against the actual files on disk.

An AI (or any tooling) can read index.json to select capabilities reliably
instead of parsing the Markdown README.

Run: python harness/build_index.py
"""

import os
import re
import json

HARNESS = os.path.dirname(os.path.abspath(__file__))


def parse_header(path):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    m = re.match(r'\s*(?:r|u)?"""(.*?)"""', src, re.S)
    doc = m.group(1) if m else ""

    def field(name):
        mm = re.search(rf'^\s*{name}\s*:\s*(.+)$', doc, re.M)
        return mm.group(1).strip() if mm else ""

    deps = field("DEPS")
    intents_raw = field("INTENTS")
    intents = [x.strip() for x in re.split(r"[,/]", intents_raw) if x.strip()] if intents_raw else []
    pip = [pkg for pkg in ("matplotlib", "PyNaCl", "Pillow", "numpy") if pkg.lower() in deps.lower()]
    low = doc.lower()
    flags = []
    if "heavy" in low:
        flags.append("heavy")
    if "niche" in low:
        flags.append("niche")
    if "non-mainstream" in low or "non-core" in low:
        flags.append("non-mainstream")
    return {
        "what": field("WHAT"),
        "deps": deps,
        "perms": field("PERMS"),
        "intents": intents,
        "pip": pip,
        "flags": flags,
    }


def build():
    files = []
    for root, _, fs in os.walk(HARNESS):
        for f in sorted(fs):
            if not f.endswith(".py") or f == "build_index.py":
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, HARNESS).replace(os.sep, "/")
            cat = rel.split("/")[0]
            tier = "community" if cat == "community" else "main"
            files.append({"path": rel, "category": cat, "tier": tier, **parse_header(full)})
    return files


def read_version():
    vp = os.path.join(HARNESS, "VERSION")
    if os.path.exists(vp):
        with open(vp) as f:
            return f.read().strip()
    return "0.0.0"


def check_readme(files):
    with open(os.path.join(HARNESS, "README.md"), encoding="utf-8") as f:
        readme = f.read()
    listed = set(re.findall(r"`([a-z]+/[a-z_]+\.py)`", readme))
    actual = {f["path"] for f in files}
    return sorted(listed - actual), sorted(actual - listed)


def main():
    files = build()
    index = {"version": read_version(), "count": len(files), "files": files}
    with open(os.path.join(HARNESS, "index.json"), "w", encoding="utf-8") as fp:
        json.dump(index, fp, ensure_ascii=False, indent=2)
    miss_readme, miss_files = check_readme(files)
    print(f"index.json written: {len(files)} files, version {index['version']}")
    print("listed in README but missing on disk:", miss_readme or "none")
    print("on disk but missing from README:", miss_files or "none")


if __name__ == "__main__":
    main()
