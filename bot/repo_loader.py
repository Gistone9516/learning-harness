# -*- coding: utf-8 -*-
"""Loads a learner-given git repo (remote URL or local folder) as plain-text file contents.

Replaces the old flow where an AI generated a whole project live: the learner now supplies a repo
and the system annotates existing code instead. The browser cannot read a disk or run git, and the
claude CLI this kit drives (see ai.py) runs with tools disabled, so this module is the only place
that touches the filesystem or spawns `git` -- it reads the repo, filters out anything that is not
useful learner-facing source, and hands the result back to ai_server as one JSON blob small enough
to survive a single /ai call (server body cap `_MAX_BODY` = 4MB in ai_server.py).

Flow:  POST /repos/load (ai_server.py) -> load() -> {ok, files:[{path, content}], ...}
       -> browser folds `files` into one /ai prompt and stores the result as a project record.

Remote sources are cloned shallow into a throwaway temp directory (always removed, even on
failure or timeout) and never left running past the call, mirroring the no-orphan-process
guarantee session_guard.py gives every `claude -p` child (SRS C9).
"""
from __future__ import annotations

import asyncio
import collections
import fnmatch
import logging
import os
import re
import shutil
import stat
import sys
import tempfile
from typing import Any

import session_guard

log = logging.getLogger(__name__)

# A ref/source starting with "-" could be smuggled into `git clone` as a flag; validate first so
# nothing user-supplied ever reaches the argv as anything but a value (the "--" before the repo
# argument in the clone command is the second half of this defence).
_REF_RE = re.compile(r"^[A-Za-z0-9._/-]+$")

# file:// is listed so tests (and an operator) can point at a local repo through the clone path
# without a real network fetch.
_REMOTE_PREFIXES = ("http://", "https://", "ssh://", "git://", "git@", "file://")

_IGNORED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "bower_components", ".venv", "venv",
    "__pycache__", ".mypy_cache", ".pytest_cache", ".tox", "dist", "build", "out",
    "target", "vendor", ".next", ".nuxt", ".svelte-kit", "coverage", ".idea",
    ".vscode", ".gradle", ".terraform",
}

_LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock",
    "Cargo.lock", "composer.lock", "Gemfile.lock", "go.sum",
}
_LOCK_SUFFIXES = (".min.js", ".min.css", ".map")

_BINARY_EXTS = {
    # images
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif", ".avif", ".psd", ".heic",
    # fonts
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # audio / video
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv",
    # archives
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war", ".ear",
    # documents / office
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".hwp", ".hwpx", ".odt", ".ods", ".odp",
    # compiled / native binaries
    ".exe", ".dll", ".so", ".dylib", ".class", ".pyc", ".pyo", ".pyd", ".o", ".a", ".lib", ".bin", ".obj", ".wasm",
    # data
    ".db", ".sqlite", ".sqlite3",
}

_BINARY_SNIFF_BYTES = 8192


# ── pure helpers (separately testable) ──────────────────────────────────────────────


def classify_source(source: str) -> str:
    """'remote' when `source` looks like a URL/SSH ref, else 'local' (a filesystem path)."""
    low = source.strip().lower()
    for prefix in _REMOTE_PREFIXES:
        if low.startswith(prefix):
            return "remote"
    return "local"


def repo_title(source: str, *, remote: bool) -> str:
    """Human-facing project title: last path segment of a URL, or the local folder's basename."""
    if not remote:
        path = os.path.normpath(os.path.expanduser(source))
        base = os.path.basename(path.rstrip(os.sep))
        return base or path

    s = source.strip().rstrip("/")
    # scp-like "git@host:org/name(.git)" has no "://"; the segment after the last ':' is the path.
    if "://" not in s and "@" in s and ":" in s:
        s = s.rsplit(":", 1)[-1]
    tail = s.rsplit("/", 1)[-1]
    if tail.endswith(".git"):
        tail = tail[:-4]
    return tail or s


def _strip_pattern(p: str) -> str:
    p = p.strip()
    if p.startswith("./"):
        return p[2:]
    if p.startswith("/"):
        return p[1:]
    return p


def _matches_include(rel_posix: str, patterns: list[str]) -> bool:
    for p in patterns:
        if not p:
            continue
        if fnmatch.fnmatchcase(rel_posix, p):
            return True
        if rel_posix == p:
            return True
        if rel_posix.startswith(p.rstrip("/") + "/"):  # bare directory name -> everything under it
            return True
    return False


def select_files(root: str, include: list[str] | None) -> dict:
    """Walk `root` and classify every file. Synchronous; callers wanting an event loop should
    run this via asyncio.to_thread (it can be slow on a large tree).

    Returns {"files": [{"path": posix_rel, "content": str}] (sorted by path),
             "skipped": {reason: count}}.
    """
    max_file_bytes = int(os.environ.get("REPO_MAX_FILE_BYTES", "200000"))
    patterns = [_strip_pattern(p) for p in (include or []) if isinstance(p, str) and p.strip()]

    files: list[dict[str, str]] = []
    skipped: collections.Counter = collections.Counter()

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        kept_dirs = []
        for d in dirnames:
            if d in _IGNORED_DIRS:
                skipped["ignored_dir"] += 1
                continue
            kept_dirs.append(d)
        dirnames[:] = kept_dirs  # prune in place so os.walk never descends into them

        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel_posix = os.path.relpath(full, root).replace(os.sep, "/")

            if os.path.islink(full):
                skipped["symlink"] += 1
                continue

            if fn in _LOCKFILES or fn.endswith(_LOCK_SUFFIXES):
                skipped["lockfile"] += 1
                continue

            ext = os.path.splitext(fn)[1].lower()
            if ext in _BINARY_EXTS:
                skipped["binary"] += 1
                continue

            # Before any read: the scope exists for repositories too large to take whole, and
            # checking it after reading would still open every file the learner excluded.
            if patterns and not _matches_include(rel_posix, patterns):
                skipped["not_included"] += 1
                continue

            try:
                with open(full, "rb") as f:
                    sniff = f.read(_BINARY_SNIFF_BYTES)
                    if b"\x00" in sniff:
                        skipped["binary"] += 1
                        continue
                    size = os.fstat(f.fileno()).st_size
                    if size > max_file_bytes:
                        skipped["file_too_large"] += 1
                        continue
                    raw = sniff + f.read()
            except OSError:
                skipped["unreadable"] += 1
                continue

            try:
                content = raw.decode("utf-8-sig")  # also strips a leading BOM
            except UnicodeDecodeError:
                skipped["binary"] += 1
                continue

            files.append({"path": rel_posix, "content": content})

    files.sort(key=lambda f: f["path"])
    return {"files": files, "skipped": dict(skipped)}


# ── result builders ──────────────────────────────────────────────────────────────


def _fail(reason: str, error: str, **extra: Any) -> dict:
    out: dict[str, Any] = {"ok": False, "reason": reason, "error": error}
    out.update(extra)
    return out


def _validate(source: Any, ref: Any) -> str | None:
    """Korean error message if `source`/`ref` fail validation, else None."""
    if not isinstance(source, str) or not source.strip():
        return "소스가 비어 있습니다."
    if source.strip().startswith("-"):
        return "소스 값이 올바르지 않습니다."
    if ref is not None:
        if not isinstance(ref, str) or ref.startswith("-") or not _REF_RE.match(ref):
            return "ref 형식이 올바르지 않습니다."
    return None


def _group_dirs(files: list[dict]) -> list[dict]:
    """Group kept files by their first path segment, for the too_large error's breakdown."""
    groups: dict[str, dict[str, int]] = {}
    for f in files:
        path = f["path"]
        seg = path.split("/", 1)[0] if "/" in path else "."
        g = groups.setdefault(seg, {"files": 0, "bytes": 0})
        g["files"] += 1
        g["bytes"] += len(f["content"].encode("utf-8"))
    rows = [{"dir": k, "files": v["files"], "bytes": v["bytes"]} for k, v in groups.items()]
    rows.sort(key=lambda r: r["bytes"], reverse=True)
    return rows[:20]


async def _finish(root: str, *, source: str, ref: str | None, commit: str | None,
                   include: list[str] | None, title: str) -> dict:
    """Shared tail of local/remote loading: select files, then apply the whole-repo limits."""
    sel = await asyncio.to_thread(select_files, root, include)
    files = sel["files"]
    skipped = {k: v for k, v in sel["skipped"].items() if v > 0}

    max_files = int(os.environ.get("REPO_MAX_FILES", "300"))
    max_bytes = int(os.environ.get("REPO_MAX_BYTES", "1500000"))

    file_count = len(files)
    total_bytes = sum(len(f["content"].encode("utf-8")) for f in files)

    if file_count > max_files or total_bytes > max_bytes:
        return _fail(
            "too_large",
            f"저장소가 큽니다 (파일 {file_count}개, {total_bytes // 1024}KB). 볼 파일 범위를 좁혀 주세요.",
            found={"files": file_count, "bytes": total_bytes},
            limits={"files": max_files, "bytes": max_bytes},
            dirs=_group_dirs(files),
        )

    if file_count == 0:
        return _fail("empty", "가져올 수 있는 파일이 없습니다 (모든 파일이 필터링되었습니다).")

    return {
        "ok": True,
        "title": title,
        "source": source,
        "ref": ref,
        "commit": commit,
        "files": files,
        "skipped": skipped,
        "total_bytes": total_bytes,
    }


async def _rev_parse_head(path: str) -> str | None:
    """Best-effort `git -C <path> rev-parse HEAD`. Never raises; None on any failure."""
    async with session_guard.track(kind="repo-rev-parse") as slot:
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", path, "rev-parse", "HEAD",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
        except Exception:  # noqa: BLE001 - git missing or unusable is not fatal here
            return None
        slot.attach(proc)
        try:
            out, _err = await asyncio.wait_for(proc.communicate(), timeout=10)
        except Exception:  # noqa: BLE001 - timeout or pipe error: no commit, not a load failure
            return None
    if proc.returncode != 0:
        return None
    sha = out.decode("utf-8", errors="replace").strip()
    return sha or None


def _safe_rmtree(path: str) -> None:
    """Remove a temp clone dir. Never raises -- cleanup must not turn into the caller's error.

    Windows leaves files under a fresh clone's .git/objects read-only, so a plain rmtree hits
    PermissionError; the handler chmods the offending path and retries. A clone can also land
    deeper than MAX_PATH (260 chars) on Windows, so the walk uses the \\\\?\\-prefixed absolute
    path, which lifts that limit.
    """
    if not path or not os.path.isdir(path):
        return

    def _onerror(func, p, _exc_info):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except Exception:  # noqa: BLE001 - best effort; a leaked temp dir is not fatal
            pass

    target = path
    if sys.platform == "win32" and not path.startswith("\\\\?\\"):
        target = "\\\\?\\" + os.path.abspath(path)

    try:
        shutil.rmtree(target, onerror=_onerror)
    except Exception as e:  # noqa: BLE001
        log.warning("temp repo cleanup failed for %s: %s", path, e)


# ── local / remote loaders ──────────────────────────────────────────────────────


async def _load_local(source: str, include: list[str] | None) -> dict:
    path = os.path.normpath(os.path.expanduser(source))
    if not os.path.isdir(path):
        if os.path.exists(path):
            return _fail("path", "지정한 경로는 폴더가 아닙니다.")
        return _fail("path", "지정한 경로를 찾을 수 없습니다.")

    commit = await _rev_parse_head(path)
    return await _finish(path, source=source, ref=None, commit=commit,
                          include=include, title=repo_title(source, remote=False))


async def _load_remote(source: str, ref: str | None, include: list[str] | None) -> dict:
    tmp_root = tempfile.mkdtemp(prefix="repo_loader_")
    clone_dir = os.path.join(tmp_root, "repo")
    try:
        cmd = ["git", "-c", "core.longpaths=true", "clone", "--depth", "1",
               "--single-branch", "--no-tags"]
        if ref:
            cmd += ["--branch", ref]
        cmd += ["--", source, clone_dir]

        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"  # a private repo must fail fast, not hang on a prompt
        # GIT_TERMINAL_PROMPT does not reach ssh, which asks its own host-key and passphrase
        # questions on the terminal and would sit there until the timeout. An operator's own
        # GIT_SSH_COMMAND wins, so a configured key setup is not overridden.
        env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        timeout = float(os.environ.get("REPO_CLONE_TIMEOUT", "120"))

        # The guard owns the child from here on: killed and reaped on every exit path
        # (normal, timeout, exception), so no orphan git process survives (SRS C9).
        async with session_guard.track(kind="repo-clone") as slot:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
                )
            except FileNotFoundError:
                return _fail("clone", "git 실행 파일을 찾을 수 없습니다.")
            slot.attach(proc)
            try:
                _out, err_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                return _fail("clone", f"저장소를 받아오는 데 시간이 너무 오래 걸립니다 ({timeout:.0f}초 제한 초과).")

        if proc.returncode != 0:
            msg = err_bytes.decode("utf-8", errors="replace").strip()[:300]
            return _fail("clone", f"저장소를 받아오지 못했습니다: {msg}")

        commit = await _rev_parse_head(clone_dir)
        return await _finish(clone_dir, source=source, ref=ref, commit=commit,
                              include=include, title=repo_title(source, remote=True))
    finally:
        _safe_rmtree(tmp_root)


# ── public API ────────────────────────────────────────────────────────────────


async def load(source: str, ref: str | None = None, include: list[str] | None = None) -> dict:
    """Load a repo (remote URL or local path) into filtered, size-capped file contents.

    See the module docstring for the flow and repo_loader's contract for the exact result shapes.
    """
    err = _validate(source, ref)
    if err:
        return _fail("source", err)

    safe_include = [p for p in include if isinstance(p, str)] if isinstance(include, list) else None

    if classify_source(source) == "remote":
        return await _load_remote(source, ref, safe_include)
    return await _load_local(source, safe_include)
