# -*- coding: utf-8 -*-
"""Tests for bot/repo_loader.py: local/remote repo intake for the learner's own project.

Pure helpers (classify_source, repo_title, select_files) are exercised directly; load() is
exercised through asyncio.run since there is no live event loop in a plain pytest function
(mirrors test_ai_server.py's style). Remote-clone tests shell out to a real local git repo
through a file:// URL -- no network -- and are skipped if git is not on PATH.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_server
import repo_loader
import session_guard

_HAS_GIT = __import__("shutil").which("git") is not None


def _write(root, rel, content, encoding="utf-8"):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(content, bytes):
        with open(path, "wb") as f:
            f.write(content)
    else:
        with open(path, "w", encoding=encoding, newline="") as f:
            f.write(content)
    return path


def _init_git_repo(root):
    """git init + one commit, with autocrlf off so the committed bytes are deterministic
    regardless of this machine's global git config (measured: core.autocrlf=true here)."""
    run = lambda *args: subprocess.run(["git", *args], cwd=root, check=True,
                                        capture_output=True, text=True)
    run("init", "-q")
    run("config", "core.autocrlf", "false")
    run("config", "user.email", "test@example.com")
    run("config", "user.name", "test")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    return run("rev-parse", "HEAD").stdout.strip()


# ── classify_source / repo_title (pure) ─────────────────────────────────────────


def test_classify_source():
    assert repo_loader.classify_source("https://github.com/org/name.git") == "remote"
    assert repo_loader.classify_source("http://example.com/x.git") == "remote"
    assert repo_loader.classify_source("ssh://git@example.com/x.git") == "remote"
    assert repo_loader.classify_source("git://example.com/x.git") == "remote"
    assert repo_loader.classify_source("git@github.com:org/name.git") == "remote"
    assert repo_loader.classify_source("file:///tmp/x") == "remote"
    assert repo_loader.classify_source("C:\\Users\\me\\project") == "local"
    assert repo_loader.classify_source("./relative/path") == "local"
    assert repo_loader.classify_source("/home/me/project") == "local"


def test_repo_title_remote_variants():
    assert repo_loader.repo_title("https://github.com/org/name.git", remote=True) == "name"
    assert repo_loader.repo_title("https://github.com/org/name", remote=True) == "name"
    assert repo_loader.repo_title("https://github.com/org/name/", remote=True) == "name"
    assert repo_loader.repo_title("git@github.com:org/name.git", remote=True) == "name"


def test_repo_title_local(tmp_path):
    proj = tmp_path / "my-project"
    proj.mkdir()
    assert repo_loader.repo_title(str(proj), remote=False) == "my-project"
    assert repo_loader.repo_title(str(proj) + os.sep, remote=False) == "my-project"


# ── select_files: local success shape ───────────────────────────────────────────


def test_select_files_sorted_and_bom_stripped(tmp_path):
    root = str(tmp_path)
    _write(root, "b.txt", "second")
    _write(root, "a.txt", "first")
    _write(root, "src/c.txt", "third")
    _write(root, "bom.txt", b"\xef\xbb\xbfwith bom")   # a real BOM prefix, once

    result = repo_loader.select_files(root, None)
    paths = [f["path"] for f in result["files"]]
    assert paths == sorted(paths)
    assert paths == ["a.txt", "b.txt", "bom.txt", "src/c.txt"]

    bom_entry = next(f for f in result["files"] if f["path"] == "bom.txt")
    assert bom_entry["content"] == "with bom"   # BOM stripped, no leading \ufeff


def test_load_local_success_total_bytes(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a.txt", "hello")
    _write(str(root), "sub/b.txt", "world!!")

    out = asyncio.run(repo_loader.load(str(root)))
    assert out["ok"] is True
    assert out["ref"] is None
    assert out["commit"] is None   # not a git repo
    assert [f["path"] for f in out["files"]] == ["a.txt", "sub/b.txt"]
    expected_bytes = len("hello".encode("utf-8")) + len("world!!".encode("utf-8"))
    assert out["total_bytes"] == expected_bytes
    assert out["title"] == "repo"


# ── each skip reason: firing case + a normal file kept alongside ───────────────


def test_ignored_dir_skips_whole_subtree(tmp_path):
    root = str(tmp_path)
    _write(root, ".git/HEAD", "ref: refs/heads/main")
    _write(root, "node_modules/pkg/index.js", "module.exports = 1;")
    _write(root, "keep.txt", "kept")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["ignored_dir"] == 2   # one per pruned dir, not per file inside
    assert [f["path"] for f in result["files"]] == ["keep.txt"]


def test_symlink_file_is_skipped(tmp_path):
    root = str(tmp_path)
    real = _write(root, "real.txt", "actual content")
    link = os.path.join(root, "link.txt")
    try:
        os.symlink(real, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not permitted on this machine")

    result = repo_loader.select_files(root, None)
    assert result["skipped"].get("symlink") == 1
    assert [f["path"] for f in result["files"]] == ["real.txt"]


def test_lockfile_is_skipped(tmp_path):
    root = str(tmp_path)
    _write(root, "package-lock.json", "{}")
    _write(root, "bundle.min.js", "console.log(1)")
    _write(root, "app.js", "console.log(2)")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["lockfile"] == 2
    assert [f["path"] for f in result["files"]] == ["app.js"]


def test_binary_extension_is_skipped(tmp_path):
    root = str(tmp_path)
    _write(root, "logo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 10)
    _write(root, "notes.txt", "plain text")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["binary"] == 1
    assert [f["path"] for f in result["files"]] == ["notes.txt"]


def test_nul_byte_content_is_binary(tmp_path):
    root = str(tmp_path)
    _write(root, "weird.dat", b"abc\x00def")   # no recognized binary extension
    _write(root, "clean.dat", "abcdef")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["binary"] == 1
    assert [f["path"] for f in result["files"]] == ["clean.dat"]


def test_undecodable_utf8_is_binary(tmp_path):
    root = str(tmp_path)
    _write(root, "badenc.dat", b"\xff\xfe\x00\x01not-utf8\xd8")
    _write(root, "goodenc.dat", "utf8 text")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["binary"] == 1
    assert [f["path"] for f in result["files"]] == ["goodenc.dat"]


def test_file_too_large_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setenv("REPO_MAX_FILE_BYTES", "10")
    root = str(tmp_path)
    _write(root, "big.txt", "x" * 100)
    _write(root, "small.txt", "ok")

    result = repo_loader.select_files(root, None)
    assert result["skipped"]["file_too_large"] == 1
    assert [f["path"] for f in result["files"]] == ["small.txt"]


def test_unreadable_file_is_skipped(tmp_path, monkeypatch):
    root = str(tmp_path)
    _write(root, "bad.txt", "secret")
    _write(root, "good.txt", "ok")

    real_open = open

    def fake_open(path, *args, **kwargs):
        if os.path.basename(str(path)) == "bad.txt":
            raise OSError("simulated unreadable")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", fake_open)
    result = repo_loader.select_files(root, None)
    assert result["skipped"]["unreadable"] == 1
    assert [f["path"] for f in result["files"]] == ["good.txt"]


# ── include patterns ─────────────────────────────────────────────────────────────


def test_include_glob(tmp_path):
    root = str(tmp_path)
    _write(root, "src/main.py", "1")
    _write(root, "docs/main.py", "2")
    _write(root, "README.md", "3")

    result = repo_loader.select_files(root, ["src/*.py"])
    assert [f["path"] for f in result["files"]] == ["src/main.py"]
    assert result["skipped"]["not_included"] == 2


def test_include_exact_path(tmp_path):
    root = str(tmp_path)
    _write(root, "README.md", "readme")
    _write(root, "other.md", "other")

    result = repo_loader.select_files(root, ["README.md"])
    assert [f["path"] for f in result["files"]] == ["README.md"]
    assert result["skipped"]["not_included"] == 1


def test_include_bare_directory(tmp_path):
    root = str(tmp_path)
    _write(root, "docs/guide.md", "guide")
    _write(root, "docs/sub/deep.md", "deep")
    _write(root, "docs.txt", "not under docs/")

    result = repo_loader.select_files(root, ["docs"])
    assert sorted(f["path"] for f in result["files"]) == ["docs/guide.md", "docs/sub/deep.md"]
    assert result["skipped"]["not_included"] == 1


def test_include_no_match_is_empty_result(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a.txt", "hi")

    out = asyncio.run(repo_loader.load(str(root), include=["nomatch/*"]))
    assert out["ok"] is False
    assert out["reason"] == "empty"


# ── whole-repo limits: too_large / just-under-limit ─────────────────────────────


def test_too_large_by_file_count(tmp_path, monkeypatch):
    monkeypatch.setenv("REPO_MAX_FILES", "2")
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a/one.txt", "aaaaaaaaaa")
    _write(str(root), "b/two.txt", "b")
    _write(str(root), "c/three.txt", "c")

    out = asyncio.run(repo_loader.load(str(root)))
    assert out["ok"] is False
    assert out["reason"] == "too_large"
    assert out["found"]["files"] == 3
    assert out["limits"]["files"] == 2
    dirs = out["dirs"]
    assert len(dirs) <= 20
    assert dirs == sorted(dirs, key=lambda d: d["bytes"], reverse=True)
    assert dirs[0]["dir"] == "a"   # biggest group first (10 bytes vs 1 byte each)
    assert dirs[0]["files"] == 1 and dirs[0]["bytes"] == 10


def test_too_large_by_total_bytes(tmp_path, monkeypatch):
    monkeypatch.setenv("REPO_MAX_BYTES", "5")
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a.txt", "abcdef")   # 6 bytes > limit of 5

    out = asyncio.run(repo_loader.load(str(root)))
    assert out["ok"] is False
    assert out["reason"] == "too_large"
    assert out["found"]["bytes"] == 6
    assert out["limits"]["bytes"] == 5


def test_dirs_grouping_capped_at_20(tmp_path, monkeypatch):
    monkeypatch.setenv("REPO_MAX_FILES", "5")
    root = tmp_path / "repo"
    root.mkdir()
    for i in range(25):
        _write(str(root), f"d{i:02d}/f.txt", "x")

    out = asyncio.run(repo_loader.load(str(root)))
    assert out["ok"] is False
    assert out["reason"] == "too_large"
    assert len(out["dirs"]) == 20


def test_just_under_limit_succeeds(tmp_path, monkeypatch):
    monkeypatch.setenv("REPO_MAX_FILES", "2")
    monkeypatch.setenv("REPO_MAX_BYTES", "20")
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a.txt", "1234567890")   # 10
    _write(str(root), "b.txt", "1234567890")   # 10, total 20 == limit (not > limit)

    out = asyncio.run(repo_loader.load(str(root)))
    assert out["ok"] is True
    assert out["total_bytes"] == 20


# ── path / source validation errors ─────────────────────────────────────────────


def test_missing_local_path(tmp_path):
    out = asyncio.run(repo_loader.load(str(tmp_path / "does-not-exist")))
    assert out["ok"] is False
    assert out["reason"] == "path"
    assert isinstance(out["error"], str) and out["error"]


def test_local_path_is_a_file_not_a_dir(tmp_path):
    f = tmp_path / "afile.txt"
    f.write_text("x", encoding="utf-8")
    out = asyncio.run(repo_loader.load(str(f)))
    assert out["ok"] is False
    assert out["reason"] == "path"


def test_source_validation_errors():
    for bad_source, bad_ref in [("", None), ("   ", None), ("-x", None), ("repo", "-bad"),
                                 ("repo", "has space")]:
        out = asyncio.run(repo_loader.load(bad_source, ref=bad_ref))
        assert out["ok"] is False
        assert out["reason"] == "source", (bad_source, bad_ref, out)


# ── remote: clone success / failure / timeout ───────────────────────────────────


@pytest.mark.skipif(not _HAS_GIT, reason="git not on PATH")
def test_remote_clone_success_and_cleanup(tmp_path, monkeypatch):
    src = tmp_path / "src"
    src.mkdir()
    _write(str(src), "a.txt", "hello")
    commit = _init_git_repo(str(src))

    created_dirs = []
    real_mkdtemp = tempfile.mkdtemp

    def spy_mkdtemp(*args, **kwargs):
        d = real_mkdtemp(*args, **kwargs)
        created_dirs.append(d)
        return d

    monkeypatch.setattr(repo_loader.tempfile, "mkdtemp", spy_mkdtemp)

    uri = src.as_uri()
    out = asyncio.run(repo_loader.load(uri))

    assert out["ok"] is True, out
    assert out["commit"] == commit
    assert out["title"] == "src"
    a = next(f for f in out["files"] if f["path"] == "a.txt")
    assert a["content"].strip() == "hello"   # .strip(): checkout line-ending is platform config, not ours to assert

    assert len(created_dirs) == 1
    assert not os.path.isdir(created_dirs[0])   # temp clone dir always removed


@pytest.mark.skipif(not _HAS_GIT, reason="git not on PATH")
def test_remote_clone_failure_nonexistent_repo(tmp_path):
    missing = (tmp_path / "definitely-does-not-exist").as_uri()
    out = asyncio.run(repo_loader.load(missing))
    assert out["ok"] is False
    assert out["reason"] == "clone"
    assert out["error"]


def test_remote_clone_timeout(monkeypatch):
    monkeypatch.setenv("REPO_CLONE_TIMEOUT", "0.05")

    class _FakeProc:
        def __init__(self):
            self.returncode = None

        async def communicate(self):
            await asyncio.sleep(5)   # far longer than the 0.05s timeout
            self.returncode = 0
            return b"", b""

        def kill(self):
            self.returncode = -9

        async def wait(self):
            return self.returncode

    async def fake_create_subprocess_exec(*args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(repo_loader.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    out = asyncio.run(repo_loader.load("https://example.invalid/x.git"))
    assert out["ok"] is False
    assert out["reason"] == "clone"
    assert session_guard.active_count() == 0   # the fake proc was killed and reaped, not leaked


# ── no orphan tracked sessions ───────────────────────────────────────────────────


def test_no_orphan_sessions_after_load(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _write(str(root), "a.txt", "hi")

    asyncio.run(repo_loader.load(str(root)))                       # success path
    asyncio.run(repo_loader.load(str(tmp_path / "missing")))       # failure path
    assert session_guard.active_count() == 0


# ── HTTP route: /repos/load ───────────────────────────────────────────────────


async def _request(port, method, path, headers=None, body=b""):
    rd, wr = await asyncio.open_connection("127.0.0.1", port)
    lines = [f"{method} {path} HTTP/1.1", "Host: x", f"Content-Length: {len(body)}", "Connection: close"]
    for k, v in (headers or {}).items():
        lines.append(f"{k}: {v}")
    wr.write(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8") + body)
    await wr.drain()
    resp = await rd.read()
    wr.close()
    head, _, rest = resp.partition(b"\r\n\r\n")
    status = head.split(b"\r\n")[0].decode("latin-1")
    return status, rest


async def _run_route_cases():
    server = await asyncio.start_server(ai_server._make_handler("secret", "*"), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        unauth = await _request(port, "POST", "/repos/load",
                                {"Content-Type": "application/json"}, b'{"source":"x"}')
        missing = await _request(port, "POST", "/repos/load",
                                 {"Content-Type": "application/json", "X-AI-Token": "secret"},
                                 b'{}')
        ok = await _request(port, "POST", "/repos/load",
                            {"Content-Type": "application/json", "X-AI-Token": "secret"},
                            b'{"source":"whatever"}')
    finally:
        server.close()
        await server.wait_closed()
    return unauth, missing, ok


def test_route_gating_and_passthrough(monkeypatch):
    async def fake_load(source, ref=None, include=None):
        return {"ok": True, "title": "t", "source": source, "ref": ref, "commit": None,
                "files": [], "skipped": {}, "total_bytes": 0}

    monkeypatch.setattr(repo_loader, "load", fake_load)
    unauth, missing, ok = asyncio.run(_run_route_cases())

    assert unauth[0].startswith("HTTP/1.1 401")
    assert missing[0].startswith("HTTP/1.1 400")
    assert json.loads(missing[1])["error"] == "missing source"
    assert ok[0].startswith("HTTP/1.1 200")
    data = json.loads(ok[1])
    assert data["ok"] is True and data["source"] == "whatever"
