# -*- coding: utf-8 -*-
"""Login for the gateway (specs/web-gateway.md GW-8..GW-10): password hash, signed session cookie, throttle.

Pure functions plus one small in-memory throttle; no I/O, so every rule is testable without a server.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import secrets
import threading
import time

COOKIE = "lh_study"
_N, _R, _P = 2 ** 14, 8, 1
_DKLEN = 32
# Each scrypt check takes about 16 MiB; parallel guesses must not turn into a memory spike (GW-10).
CHECKS = threading.BoundedSemaphore(2)


# ── password (GW-8, GW-9) ───────────────────────────────────────────────────────────

def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt if salt is not None else secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt_hex, dk_hex = stored.split("$")
        if kind != "scrypt":
            return False
        with CHECKS:
            dk = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                                n=int(n), r=int(r), p=int(p), dklen=len(dk_hex) // 2)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex().encode("ascii"), dk_hex.encode("ascii", "replace"))


def new_secret() -> str:
    return secrets.token_hex(32)


# ── session cookie (GW-8) ───────────────────────────────────────────────────────────

def _sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def issue(secret: str, days: int, now: float | None = None) -> str:
    issued = int(now if now is not None else time.time())
    expires = issued + days * 86400
    payload = f"{issued}.{expires}"
    return f"{payload}.{_sign(secret, payload)}"


def check(secret: str, value: str | None, now: float | None = None) -> tuple[bool, bool]:
    """(valid, should_reissue). Reissue once half of the lifetime has passed (sliding session)."""
    if not value or not secret:
        return False, False
    try:
        issued_s, expires_s, sig = value.split(".")
        issued, expires = int(issued_s), int(expires_s)
        # Bytes on both sides: a str with non-ASCII characters makes compare_digest raise (GW-16).
        if not hmac.compare_digest(_sign(secret, f"{issued}.{expires}").encode("ascii"), sig.encode("utf-8")):
            return False, False
    except (ValueError, TypeError):
        return False, False
    t = now if now is not None else time.time()
    if t >= expires or issued > t + 60:
        return False, False
    return True, t - issued >= (expires - issued) / 2


def cookie_header(base_path: str, value: str, days: int, secure: bool) -> str:
    parts = [f"{COOKIE}={value}", f"Path={base_path}", f"Max-Age={days * 86400}", "HttpOnly", "SameSite=Lax"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_header(base_path: str, secure: bool) -> str:
    parts = [f"{COOKIE}=", f"Path={base_path}", "Max-Age=0", "HttpOnly", "SameSite=Lax"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def read_cookie(header: str | None) -> str | None:
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return None


# ── throttle (GW-10) ────────────────────────────────────────────────────────────────

def client_key(addr: str) -> str:
    """An IPv6 address counts by its /64, since one host holds the whole block; anything else as given."""
    try:
        ip = ipaddress.ip_address(addr.strip())
    except ValueError:
        return addr.strip()
    if ip.version == 6:
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


class Throttle:
    """Attempts are counted before the password is checked, so parallel guesses cannot all slip under the limit."""

    def __init__(self, limit: int = 5, window_s: float = 15 * 60, global_limit: int = 30):
        self.limit = limit
        self.window_s = window_s
        self.global_limit = global_limit
        self._tries: dict[str, list[float]] = {}
        self._all: list[float] = []
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        cut = now - self.window_s
        self._all = [t for t in self._all if t > cut]
        for k in list(self._tries):
            kept = [t for t in self._tries[k] if t > cut]
            if kept:
                self._tries[k] = kept
            else:
                del self._tries[k]

    def attempt(self, client: str, now: float | None = None) -> bool:
        """Record one attempt; False (and nothing recorded) when the client or everyone is over the limit."""
        t = now if now is not None else time.time()
        key = client_key(client)
        with self._lock:
            self._prune(t)
            if len(self._tries.get(key, [])) >= self.limit or len(self._all) >= self.global_limit:
                return False
            self._tries.setdefault(key, []).append(t)
            self._all.append(t)
            return True

    def succeeded(self, client: str) -> None:
        """A correct password: that attempt was not a guess, so it leaves both counts."""
        key = client_key(client)
        with self._lock:
            tries = self._tries.get(key)
            if tries:
                last = tries.pop()
                if last in self._all:
                    self._all.remove(last)
                self._tries.pop(key, None)
