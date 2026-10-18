# -*- coding: utf-8 -*-
"""Gateway config: load, validate (GW-7) and read each subject's .env (specs/web-gateway.md §2).

The config file lives outside the kit (GW-14); nothing here names a subject, domain or path.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
RESERVED = {"login", "logout", "health"}   # gateway paths a subject would hide behind (GW-7)


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Subject:
    slug: str
    dir: Path
    env: dict[str, str]          # the subject's .env values (token, ports)
    title: str
    allow_repo_load: bool = False  # GW-5: /repos/load reads local folders, so it is off unless asked for

    @property
    def ai_port(self) -> int:
        return int(self.env["AI_SERVER_PORT"])

    @property
    def token(self) -> str:
        return self.env["AI_SERVER_TOKEN"]


@dataclass(frozen=True)
class Auth:
    user: str
    password_hash: str
    secret: str
    session_days: int = 30


@dataclass(frozen=True)
class Config:
    path: Path
    base_path: str
    port: int
    title: str
    subjects: tuple[Subject, ...]
    auth: Auth
    raw: dict = field(repr=False, default_factory=dict)

    def subject(self, slug: str) -> Subject | None:
        for s in self.subjects:
            if s.slug == slug:
                return s
        return None


def read_env(path: Path) -> dict[str, str]:
    """KEY=VALUE lines, # comments, optional quotes. Same reading as tools/start_web.ps1 Read-DotEnv."""
    out: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return out
    for line in lines:
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, v = t.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _subject_title(folder: Path, slug: str) -> str:
    try:
        cfg = json.loads((folder / "content" / "app.json").read_text(encoding="utf-8"))
        title = cfg.get("title") if isinstance(cfg, dict) else None
        return title if isinstance(title, str) and title.strip() else slug
    except (OSError, ValueError):
        return slug


def parse(raw: dict, path: Path) -> Config:
    if not isinstance(raw, dict):
        raise ConfigError("config must be a JSON object")
    base = str(raw.get("basePath", "")).rstrip("/")
    if not base.startswith("/") or "//" in base or len(base) < 2:
        raise ConfigError("basePath must look like /name (no trailing slash)")
    try:
        port = int(raw.get("port", 0))
    except (TypeError, ValueError):
        raise ConfigError("port must be a number")
    if not 0 < port < 65536:
        raise ConfigError("port must be 1-65535")

    auth_raw = raw.get("auth") or {}
    auth = Auth(
        user=str(auth_raw.get("user", "")),
        password_hash=str(auth_raw.get("passwordHash", "")),
        secret=str(auth_raw.get("secret", "")),
        session_days=int(auth_raw.get("sessionDays", 30) or 30),
    )

    subjects: list[Subject] = []
    seen_slugs: set[str] = set()
    seen_ports: dict[int, str] = {}
    for item in raw.get("subjects") or []:
        slug = str((item or {}).get("slug", ""))
        if not SLUG.match(slug) or slug in RESERVED:
            raise ConfigError(f"bad slug: {slug!r}")
        if slug in seen_slugs:
            raise ConfigError(f"duplicate slug: {slug}")
        seen_slugs.add(slug)
        folder = Path(str(item.get("dir", ""))).expanduser()
        if not (folder / "content" / "app.json").is_file():
            raise ConfigError(f"{slug}: content/app.json not found under {folder}")
        env = read_env(folder / ".env")
        if not env.get("AI_SERVER_TOKEN"):
            raise ConfigError(f"{slug}: AI_SERVER_TOKEN missing in .env")
        try:
            ai_port = int(env.get("AI_SERVER_PORT", ""))
        except ValueError:
            raise ConfigError(f"{slug}: AI_SERVER_PORT missing or not a number in .env")
        if ai_port in seen_ports or ai_port == port:
            other = seen_ports.get(ai_port, "the gateway")
            raise ConfigError(f"{slug}: AI_SERVER_PORT {ai_port} already used by {other}")
        seen_ports[ai_port] = slug
        subjects.append(Subject(slug=slug, dir=folder.resolve(), env=env, title=_subject_title(folder, slug),
                                allow_repo_load=item.get("allowRepoLoad") is True))
    if not subjects:
        raise ConfigError("no subjects configured")

    return Config(path=path, base_path=base, port=port, title=str(raw.get("title") or "Study"),
                  subjects=tuple(subjects), auth=auth, raw=raw)


def load(path: Path) -> Config:
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as e:
        raise ConfigError(f"cannot read {path}: {e}")
    except ValueError as e:
        raise ConfigError(f"{path} is not valid JSON: {e}")
    return parse(raw, path)


def save_auth(path: Path, password_hash: str, secret: str) -> None:
    """Rewrite only the auth block (GW-9), keeping every other field as written."""
    raw = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    auth = dict(raw.get("auth") or {})
    auth["passwordHash"] = password_hash
    auth["secret"] = secret
    raw["auth"] = auth
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
