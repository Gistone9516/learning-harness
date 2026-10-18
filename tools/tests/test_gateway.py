# -*- coding: utf-8 -*-
"""Gateway rules GW-1..GW-13 (specs/web-gateway.md), against a real handler and a fake upstream ai_server."""
from __future__ import annotations

import http.client
import http.server
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS / "gateway"))
sys.path.insert(0, str(TOOLS))

import app  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
import hostfiles  # noqa: E402
from children import child_env  # noqa: E402

PASSWORD = "correct horse battery"
TOKEN = "subject-token-abc"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Upstream(http.server.BaseHTTPRequestHandler):
    """Echoes what it received, so tests can see the token and path the gateway forwarded."""

    def log_message(self, *a):
        pass

    def _echo(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode("utf-8") if n else ""
        out = json.dumps({"path": self.path, "method": self.command, "token": self.headers.get("X-AI-Token"),
                          "auth": self.headers.get("Authorization"), "body": body}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def _route(self):
        if self.path.startswith("/ai?slow"):
            return self._slow()
        return self._echo()

    def _slow(self):
        """Wait (up to 10 s) until the caller closes the connection, then record that it did."""
        import select as _select
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        sock = self.connection
        for _ in range(100):
            r, _, _ = _select.select([sock], [], [], 0.1)
            if r and sock.recv(1, socket.MSG_PEEK) == b"":
                DROPPED.set()
                return
        self._echo()

    do_GET = do_POST = do_PUT = do_DELETE = _route


DROPPED = threading.Event()


def _subject(root: Path, slug: str, ai_port: int, title: str) -> Path:
    d = root / slug
    (d / "content").mkdir(parents=True)
    (d / "content" / "app.json").write_text(json.dumps({"title": title, "views": [],
                                                        "contentLinks": {"plan.md": "../PLAN.md"}}), encoding="utf-8")
    (d / "content" / "data.json").write_text('{"x": 1}', encoding="utf-8")
    (d / "PLAN.md").write_text("# plan", encoding="utf-8")
    (d / "secret.txt").write_text("nope", encoding="utf-8")
    (d / "host").mkdir()
    (d / "host" / "local.config.js").write_text(f'window.LH_LOCAL={{token:"{TOKEN}"}};', encoding="utf-8")
    (d / ".env").write_text(f"AI_SERVER_TOKEN={TOKEN}\nAI_SERVER_PORT={ai_port}\n", encoding="utf-8")
    return d


@pytest.fixture()
def gw(tmp_path):
    up_port = _free_port()
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", up_port), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    dead_port = _free_port()
    s1 = _subject(tmp_path, "alpha", up_port, "Alpha")
    s2 = _subject(tmp_path, "beta", dead_port, "Beta")
    dist = tmp_path / "dist" / "assets"
    dist.mkdir(parents=True)
    (dist / "index.js").write_text("// bundle", encoding="utf-8")
    raw = {"basePath": "/study", "port": 1, "title": "T",
           "subjects": [{"slug": "alpha", "dir": str(s1)}, {"slug": "beta", "dir": str(s2)}],
           "auth": {"user": "me", "passwordHash": auth.hash_password(PASSWORD), "secret": auth.new_secret(),
                    "sessionDays": 30}}
    cfg = config.parse(raw, tmp_path / "gw.json")
    port = _free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port),
                                            app.make_handler(cfg, tmp_path / "dist", auth.Throttle()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield {"port": port, "cfg": cfg}
    httpd.shutdown()
    upstream.shutdown()


def req(gw, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", gw["port"], timeout=10)
    h = {"Host": f"127.0.0.1:{gw['port']}"}
    h.update(headers or {})
    data = body.encode("utf-8") if isinstance(body, str) else body
    conn.request(method, path, body=data, headers=h)
    res = conn.getresponse()
    out = res.read()
    conn.close()
    return res, out


def login(gw, password=PASSWORD, extra=None):
    body = f"password={quote(password)}&next=%2Fstudy%2F"
    return req(gw, "POST", "/study/login", body, {"Content-Type": "application/x-www-form-urlencoded", **(extra or {})})


def cookie_of(res) -> str:
    raw = res.getheader("Set-Cookie") or ""
    return raw.split(";", 1)[0]


def signed(gw):
    res, _ = login(gw)
    assert res.status == 303
    return {"Cookie": cookie_of(res)}


# GW-2
def test_anonymous_page_redirects(gw):
    res, _ = req(gw, "GET", "/study/alpha/")
    assert res.status == 303
    assert res.getheader("Location").startswith("/study/login?next=%2Fstudy%2Falpha%2F")


def test_anonymous_api_401(gw):
    res, out = req(gw, "POST", "/study/alpha/api/ai", "{}")
    assert res.status == 401 and json.loads(out)["ok"] is False


def test_health_needs_no_login(gw):
    res, out = req(gw, "GET", "/study/health")
    assert res.status == 200 and json.loads(out) == {"ok": True}


# GW-8
def test_login_sets_cookie(gw):
    res, _ = login(gw)
    assert res.status == 303 and res.getheader("Location") == "/study/"
    c = res.getheader("Set-Cookie")
    assert c.startswith(auth.COOKIE + "=") and "Path=/study" in c and "HttpOnly" in c and "SameSite=Lax" in c
    assert "Secure" not in c
    res, _ = login(gw, extra={"CF-Visitor": '{"scheme":"https"}', "CF-Connecting-IP": "203.0.113.9"})
    assert "Secure" in res.getheader("Set-Cookie")


def test_wrong_password_401(gw):
    res, out = login(gw, "nope")
    assert res.status == 401 and "비밀번호가 맞지 않습니다" in out.decode("utf-8")
    assert res.getheader("Set-Cookie") is None


def test_tampered_cookie_rejected(gw):
    h = signed(gw)
    bad = h["Cookie"][:-1] + ("0" if h["Cookie"][-1] != "0" else "1")
    res, _ = req(gw, "GET", "/study/", headers={"Cookie": bad})
    assert res.status == 303


def test_expired_and_sliding_cookie():
    secret = auth.new_secret()
    v = auth.issue(secret, 30, now=1_000_000)
    assert auth.check(secret, v, now=1_000_000 + 86400) == (True, False)
    assert auth.check(secret, v, now=1_000_000 + 16 * 86400) == (True, True)
    assert auth.check(secret, v, now=1_000_000 + 31 * 86400) == (False, False)
    assert auth.check(auth.new_secret(), v, now=1_000_000) == (False, False)


def test_safe_next_stays_inside():
    assert app.safe_next("/study", "/study/alpha/") == "/study/alpha/"
    for bad in ("https://evil.example/", "//evil.example/study/", "/other/", "/study\\x", None):
        assert app.safe_next("/study", bad) == "/study/"


# GW-9
def test_set_password_rotates_secret(tmp_path):
    p = tmp_path / "gw.json"
    p.write_text(json.dumps({"basePath": "/study", "auth": {"user": "me", "secret": "old"}}), encoding="utf-8")
    config.save_auth(p, auth.hash_password("pw123456"), auth.new_secret())
    raw = json.loads(p.read_text(encoding="utf-8"))
    assert raw["auth"]["secret"] != "old" and raw["auth"]["user"] == "me" and raw["basePath"] == "/study"
    assert auth.verify_password("pw123456", raw["auth"]["passwordHash"])
    assert not auth.verify_password("pw1234567", raw["auth"]["passwordHash"])


# GW-10
def test_throttle_after_5_failures(gw):
    ip = {"CF-Connecting-IP": "198.51.100.7"}
    for _ in range(5):
        assert login(gw, "x", ip)[0].status == 401
    assert login(gw, PASSWORD, ip)[0].status == 429
    assert login(gw, PASSWORD, {"CF-Connecting-IP": "198.51.100.8"})[0].status == 303


# GW-11
def test_cross_origin_post_403(gw):
    h = signed(gw)
    res, _ = req(gw, "POST", "/study/alpha/api/ai", "{}", {**h, "Origin": "https://evil.example"})
    assert res.status == 403
    res, _ = req(gw, "POST", "/study/alpha/api/ai", "{}", {**h, "Origin": f"http://127.0.0.1:{gw['port']}"})
    assert res.status == 200


# GW-3
def test_local_config_has_no_token(gw):
    res, out = req(gw, "GET", "/study/alpha/local.config.js", headers=signed(gw))
    text = out.decode("utf-8")
    assert res.status == 200 and TOKEN not in text
    assert '"serverUrl": "/study/alpha/api"' in text and '"gated": true' in text


def test_proxy_injects_token_and_drops_client_header(gw):
    h = {**signed(gw), "X-AI-Token": "client-guess", "Authorization": "Bearer client-guess",
         "Content-Type": "application/json"}
    res, out = req(gw, "POST", "/study/alpha/api/ai?x=1", '{"prompt":"hi"}', h)
    echo = json.loads(out)
    assert res.status == 200
    assert echo == {"path": "/ai?x=1", "method": "POST", "token": TOKEN, "auth": None, "body": '{"prompt":"hi"}'}
    res, out = req(gw, "GET", "/study/alpha/api/state/doc/outline", headers=signed(gw))
    assert json.loads(out)["path"] == "/state/doc/outline"


# GW-5
def test_upstream_down_502(gw):
    res, out = req(gw, "GET", "/study/beta/api/health", headers=signed(gw))
    assert res.status == 502 and json.loads(out)["error"] == "ai_server unreachable"


# GW-4
def test_prefix_serves_host_tree(gw):
    h = signed(gw)
    res, out = req(gw, "GET", "/study/alpha/", headers=h)
    assert res.status == 200 and b'src="host.js"' in out
    res, out = req(gw, "GET", "/study/alpha/content/data.json", headers=h)
    assert res.status == 200 and json.loads(out) == {"x": 1}
    res, out = req(gw, "GET", "/study/alpha/kit/assets/index.js", headers=h)
    assert res.status == 200 and res.getheader("Content-Type").startswith("text/javascript")
    res, out = req(gw, "GET", "/study/alpha/content/plan.md", headers=h)
    assert res.status == 200 and out == b"# plan"


def test_traversal_and_subject_files_refused(gw):
    h = signed(gw)
    for p in ("/study/alpha/content/..%2Fsecret.txt", "/study/alpha/content/../secret.txt",
              "/study/alpha/host/local.config.js", "/study/alpha/.env", "/study/alpha/kit/..%2F..%2Falpha%2F.env"):
        res, out = req(gw, "GET", p, headers=h)
        assert res.status == 404, p
        assert TOKEN.encode() not in out


def test_slash_redirect_and_unknown_slug(gw):
    h = signed(gw)
    res, _ = req(gw, "GET", "/study/alpha", headers=h)
    assert res.status == 308 and res.getheader("Location") == "/study/alpha/"
    res, _ = req(gw, "GET", "/study", headers=h)
    assert res.status == 308 and res.getheader("Location") == "/study/"
    res, _ = req(gw, "GET", "/study/nope/", headers=h)
    assert res.status == 404


# GW-12, GW-13
def test_index_lists_subjects_and_no_store(gw):
    res, out = req(gw, "GET", "/study/", headers=signed(gw))
    html = out.decode("utf-8")
    assert res.status == 200 and 'href="/study/alpha/"' in html and "Beta" in html and "로그아웃" in html
    assert res.getheader("Cache-Control") == "no-store"


def test_logout_clears_cookie(gw):
    res, _ = req(gw, "POST", "/study/logout", "", signed(gw))
    assert res.status == 303 and "Max-Age=0" in res.getheader("Set-Cookie")


# GW-6, GW-7
def test_child_env_isolation():
    base = {"PATH": "p", "AI_SERVER_PORT": "1111", "AI_SERVER_TOKEN": "other", "STATE_ROOT": "x", "HOME": "h"}
    env = child_env(base, {"AI_SERVER_TOKEN": "mine", "AI_SERVER_PORT": "2222"})
    assert env["AI_SERVER_PORT"] == "2222" and env["AI_SERVER_TOKEN"] == "mine" and "STATE_ROOT" not in env
    assert env["PATH"] == "p" and env["AI_SERVER_HOST"] == "127.0.0.1"
    env = child_env(base, {"AI_SERVER_TOKEN": "mine"})
    assert "AI_SERVER_PORT" not in env


def test_config_validation(tmp_path):
    a = _subject(tmp_path, "a", 9001, "A")
    b = _subject(tmp_path, "b", 9001, "B")
    ok = {"basePath": "/study", "port": 8430, "subjects": [{"slug": "a", "dir": str(a)}]}
    assert config.parse(ok, tmp_path / "c.json").subjects[0].title == "A"
    bad_cases = [
        {**ok, "subjects": [{"slug": "a", "dir": str(a)}, {"slug": "b", "dir": str(b)}]},   # same AI port
        {**ok, "subjects": [{"slug": "a", "dir": str(a)}, {"slug": "a", "dir": str(a)}]},   # same slug
        {**ok, "subjects": [{"slug": "A!", "dir": str(a)}]},
        {**ok, "subjects": [{"slug": "a", "dir": str(tmp_path / "missing")}]},
        {**ok, "basePath": "study/"},
        {**ok, "port": 9001, "subjects": [{"slug": "a", "dir": str(a)}]},
        {**ok, "subjects": []},
    ]
    for raw in bad_cases:
        with pytest.raises(config.ConfigError):
            config.parse(raw, tmp_path / "c.json")
    (b / ".env").write_text("AI_SERVER_PORT=9002\n", encoding="utf-8")
    with pytest.raises(config.ConfigError):
        config.parse({**ok, "subjects": [{"slug": "b", "dir": str(b)}]}, tmp_path / "c.json")


# GW-1
def test_gateway_binds_loopback_only():
    src = (TOOLS / "gateway" / "gateway.py").read_text(encoding="utf-8")
    assert 'ThreadingHTTPServer(("127.0.0.1", cfg.port)' in src


# hostfiles shared with serve_host (§4)
def test_hostfiles_resolve(tmp_path):
    s = _subject(tmp_path, "s", 9100, "S")
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    assert hostfiles.resolve(s, dist, "") == hostfiles.WEBHOST / "index.html"
    assert hostfiles.resolve(s, dist, "host.js") == hostfiles.WEBHOST / "host.js"
    assert hostfiles.resolve(s, dist, "content/plan.md") == (s / "PLAN.md").resolve()
    assert hostfiles.resolve(s, dist, "content/../secret.txt") is None
    assert hostfiles.resolve(s, dist, "local.config.js") is None
    assert hostfiles.resolve(s, dist, "other/x") is None

# GW-5: a browser that leaves takes the upstream call with it
def test_client_drop_closes_upstream(gw):
    DROPPED.clear()
    cookie = signed(gw)["Cookie"]
    crlf = chr(13) + chr(10)
    head = [f"POST /study/alpha/api/ai?slow=1 HTTP/1.1", f"Host: 127.0.0.1:{gw['port']}", f"Cookie: {cookie}",
            "Content-Type: application/json", "Content-Length: 2"]
    sock = socket.create_connection(("127.0.0.1", gw["port"]))
    sock.sendall((crlf.join(head) + crlf + crlf + "{}").encode("ascii"))
    time.sleep(1.0)
    sock.close()
    assert DROPPED.wait(5), "upstream connection stayed open after the client left"


def test_staying_client_is_not_a_drop(gw):
    """The other branch: a client that waits gets its answer, and nothing is recorded as dropped."""
    DROPPED.clear()
    res, out = req(gw, "POST", "/study/alpha/api/ai", "{}", {**signed(gw), "Content-Type": "application/json"})
    assert res.status == 200 and json.loads(out)["path"] == "/ai" and not DROPPED.is_set()


# GW-5: only the routes the pages use
def test_api_allowlist(gw):
    h = {**signed(gw), "Content-Type": "application/json"}
    assert req(gw, "POST", "/study/alpha/api/repos/load", '{"source":"C:/"}', h)[0].status == 404
    assert req(gw, "GET", "/study/alpha/api/ai", headers=h)[0].status == 404
    assert req(gw, "POST", "/study/alpha/api/other", "{}", h)[0].status == 404
    for method, path in (("GET", "/study/alpha/api/sessions"), ("PUT", "/study/alpha/api/state/doc/x"),
                         ("DELETE", "/study/alpha/api/state/c/x"), ("POST", "/study/alpha/api/problems")):
        assert req(gw, method, path, "{}", h)[0].status == 200, path


def test_repo_load_only_when_allowed():
    alpha = config.Subject(slug="a", dir=Path("."), env={}, title="a")
    allowed = config.Subject(slug="a", dir=Path("."), env={}, title="a", allow_repo_load=True)
    assert not app.api_allowed(alpha, "POST", "/repos/load")
    assert app.api_allowed(allowed, "POST", "/repos/load")
    assert app.api_allowed(alpha, "GET", "/state/doc/outline?x=1")


# GW-15
def test_next_with_crlf_refused(gw):
    crlf = chr(13) + chr(10)
    for bad in ("/study/" + crlf + "Set-Cookie: a=b", "/study/ x", "/study/" + chr(0x7f), "/study/" + chr(0xe9)):
        assert app.safe_next("/study", bad) == "/study/"
    res, _ = req(gw, "GET", "/study/login?next=/study/%0d%0aSet-Cookie:%20a=b", headers=signed(gw))
    assert res.status == 303 and res.getheader("Location") == "/study/"
    assert all("a=b" not in v for k, v in res.getheaders() if k.lower() == "set-cookie")


# GW-10
def test_parallel_attempts_are_counted_before_the_check():
    t = auth.Throttle(limit=5)
    assert [t.attempt("198.51.100.1", now=0) for _ in range(7)] == [True] * 5 + [False] * 2
    assert t.attempt("198.51.100.1", now=15 * 60 + 1)


def test_global_cap_and_ipv6_block():
    t = auth.Throttle(limit=5, global_limit=8)
    for i in range(8):
        assert t.attempt(f"203.0.113.{i}", now=0)
    assert not t.attempt("203.0.113.200", now=0)
    v6 = auth.Throttle(limit=2)
    assert v6.attempt("2001:db8:1:2::1", now=0) and v6.attempt("2001:db8:1:2:ffff::9", now=0)
    assert not v6.attempt("2001:db8:1:2::abcd", now=0)
    assert v6.attempt("2001:db8:1:3::1", now=0)
    assert auth.client_key("::ffff:192.0.2.5") == "192.0.2.5"


def test_success_clears_the_client():
    t = auth.Throttle(limit=2)
    assert t.attempt("192.0.2.9", now=0)
    t.succeeded("192.0.2.9")
    assert t.attempt("192.0.2.9", now=0) and t.attempt("192.0.2.9", now=0)


# GW-16
def test_malformed_requests(gw):
    res, _ = req(gw, "GET", "/study/", headers={"Cookie": auth.COOKIE + "=1.2." + chr(0xe9)})
    assert res.status == 303
    assert auth.check(auth.new_secret(), "1.2." + chr(0xe9)) == (False, False)
    sock = socket.create_connection(("127.0.0.1", gw["port"]))
    crlf = chr(13) + chr(10)
    sock.sendall(("GET //[ HTTP/1.1" + crlf + "Host: x" + crlf + crlf).encode("ascii"))
    data = sock.recv(200)
    sock.close()
    assert data.split(b" ")[1] in (b"400", b"404")


def test_login_body_cap(gw):
    big = f"password={quote(PASSWORD)}&pad=" + "x" * 5000   # the right password, but over 4 KB
    res, _ = req(gw, "POST", "/study/login", big, {"Content-Type": "application/x-www-form-urlencoded"})
    assert res.status == 401


def test_reserved_slugs_refused(tmp_path):
    d = _subject(tmp_path, "login", 9300, "L")
    with pytest.raises(config.ConfigError):
        config.parse({"basePath": "/study", "port": 8430, "subjects": [{"slug": "login", "dir": str(d)}]}, tmp_path / "c.json")

