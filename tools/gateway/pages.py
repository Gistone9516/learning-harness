# -*- coding: utf-8 -*-
"""Server-rendered pages of the gateway: login, subject index, not found (specs/web-gateway.md GW-2, GW-12).

They render before any kit bundle is reachable, so they carry their own small stylesheet. The token names
copy the kit's (web/src/styles/tokens.css) so the two read as one product.
"""
from __future__ import annotations

from html import escape

from config import Config

_CSS = """
:root{color-scheme:light dark;--bg:#f6f7f9;--surface:#fff;--line:#e3e6eb;--line-strong:#c9ced6;--ink:#1d2330;
--ink-mid:#4b5563;--ink-faint:#6b7280;--primary:#2f6fdf;--primary-strong:#1f56b8;--primary-line:#9dbbf2;
--on-primary:#fff;--bad:#b42318;--bad-soft:#fdecea;--bad-line:#f2b8b5;--r:12px;--r-sm:8px;
--shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--line:#2a313c;--line-strong:#3a4350;
--ink:#e6edf3;--ink-mid:#b1bac4;--ink-faint:#8b949e;--primary:#6f9eef;--primary-strong:#9dbbf2;
--primary-line:#3b5c99;--on-primary:#0d1117;--bad:#ff8a80;--bad-soft:#3a1d1b;--bad-line:#6e2d29;
--shadow:0 1px 2px rgba(0,0,0,.4)}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--ink);
font:16px/1.55 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:16px}
.center{display:flex;align-items:center;justify-content:center}
.card{width:min(360px,100%);background:var(--surface);border:1px solid var(--line);border-radius:var(--r);
box-shadow:var(--shadow);padding:28px 24px}
.wrap{max-width:560px;margin:48px auto}
h1{font-size:1.35rem;margin:0 0 4px}
p.sub{color:var(--ink-mid);margin:0 0 20px}
label{display:block;font-weight:600;margin:0 0 6px}
input[type=password]{width:100%;height:44px;font-size:16px;padding:0 12px;border:1px solid var(--line-strong);
border-radius:var(--r-sm);background:var(--surface);color:var(--ink)}
button{height:44px;font-size:16px;border-radius:var(--r-sm);cursor:pointer;padding:0 16px}
.primary{width:100%;margin-top:16px;border:0;background:var(--primary);color:var(--on-primary);font-weight:600}
.primary:hover{background:var(--primary-strong)}
.ghost{border:1px solid var(--line-strong);background:transparent;color:var(--ink)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
button:disabled,input:disabled{opacity:.55;cursor:not-allowed}
.err{background:var(--bad-soft);border:1px solid var(--bad-line);color:var(--bad);border-radius:var(--r-sm);
padding:10px 12px;margin:0 0 16px}
header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
a.item{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:0 18px;
background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);box-shadow:var(--shadow);
color:var(--ink);text-decoration:none;font-weight:600}
a.item:hover{border-color:var(--primary-line)}
.chev{color:var(--ink-faint);font-size:1.3rem}
"""

_ERRORS = {
    "wrong": "비밀번호가 맞지 않습니다.",
    "throttled": "시도 횟수가 많습니다. 15분 뒤에 다시 시도해 주세요.",
}


def _page(title: str, body: str, body_class: str = "") -> str:
    cls = f' class="{body_class}"' if body_class else ""
    return ("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<meta name=\"color-scheme\" content=\"light dark\">"
            f"<title>{escape(title)}</title><style>{_CSS}</style></head><body{cls}>{body}</body></html>")


def login_page(cfg: Config, nxt: str, error: str | None = None) -> str:
    base = escape(cfg.base_path)
    locked = error == "throttled"
    err = f'<div class="err" role="alert">{escape(_ERRORS.get(error, ""))}</div>' if error else ""
    dis = " disabled" if locked else ""
    body = (
        '<main class="card">'
        f"<h1>{escape(cfg.title)}</h1><p class=\"sub\">계속하려면 로그인하세요.</p>{err}"
        f'<form method="post" action="{base}/login" id="f">'
        f'<input type="hidden" name="next" value="{escape(nxt)}">'
        f'<input type="text" name="username" autocomplete="username" value="{escape(cfg.auth.user)}" hidden readonly>'
        '<label for="pw">비밀번호</label>'
        f'<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus{dis}>'
        f'<button class="primary" type="submit"{dis}>로그인</button></form>'
        "<script>document.getElementById('f').addEventListener('submit',function(){"
        "var b=this.querySelector('button');setTimeout(function(){b.disabled=true;b.textContent='확인 중…';},0);});"
        "</script></main>"
    )
    return _page("로그인", body, "center")


def index_page(cfg: Config) -> str:
    base = escape(cfg.base_path)
    items = "".join(
        f'<li><a class="item" href="{base}/{escape(s.slug)}/">{escape(s.title)}'
        '<span class="chev" aria-hidden="true">›</span></a></li>'
        for s in cfg.subjects
    )
    body = (
        '<main class="wrap"><header>'
        f"<h1>{escape(cfg.title)}</h1>"
        f'<form method="post" action="{base}/logout"><button class="ghost" type="submit">로그아웃</button></form>'
        "</header><p class=\"sub\">공부할 과목을 고르세요.</p>"
        f"<nav><ul>{items}</ul></nav></main>"
    )
    return _page(cfg.title, body)


def not_found_page(cfg: Config) -> str:
    base = escape(cfg.base_path)
    body = (f'<main class="wrap"><h1>찾을 수 없습니다</h1><p class="sub">없는 과목입니다.</p>'
            f'<a class="item" href="{base}/">과목 목록으로<span class="chev" aria-hidden="true">›</span></a></main>')
    return _page("찾을 수 없습니다", body)
