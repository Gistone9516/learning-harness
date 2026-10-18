# Web Gateway (`web-gateway`)

> Conforms to `web-contract.md` (Web SoT). Scope: `tools/gateway/` and the shared host-file resolver
> `tools/hostfiles.py`. Rules: GW-1..GW-18 (18).
> Purpose: serve several web subjects from one machine under one URL prefix (for example
> `https://<domain>/study/<slug>/`) to remote browsers, behind a login, with the AI token kept on the server.
> `tools/serve_host.py` + `start_web.ps1` remain the single-subject, localhost-only path.

---

## 0. Why it exists

The single-subject host cannot be published as is (measured by reading the code, 2026-10-18):

- the host page used root-absolute URLs (`/kit/...`, `/content/...`), and a tunnel that forwards
  `/study/<slug>/...` unchanged gets 404 for all of them;
- the browser called `ai_server` at `http://127.0.0.1:<port>`, which on a phone is the phone itself;
- the AI token was served to any caller as `/local.config.js`. With it, anyone could run the
  subscription `claude` and read local folders through `/repos/load`.

## 1. Behaviour rules

| ID | Rule | Why | Test |
|---|---|---|---|
| GW-1 | Binds `127.0.0.1` only, **exclusively**: a second instance fails to start instead of sharing the port. Remote access is through a tunnel in front of it. | The tunnel is the one public path; nothing else on the LAN should reach the subscription. Windows lets a second socket bind a port marked reusable, and a restart left two gateways listening on 8430, each answering part of the traffic (measured 2026-10-18). | `test_gateway.py` bind default, "second bind refused" |
| GW-2 | Every path under `basePath` needs a valid session, except `<base>/login` (GET form, POST submit), `<base>/logout` and `<base>/health`. Without one an HTML request gets `303` to the login page with `next`, an `/api/` request gets `401` JSON. | Unauthenticated exposure gives away the subscription and local files (§0). | "anonymous page redirects", "anonymous api 401" |
| GW-3 | The AI token never reaches the browser. The gateway reads each subject's `AI_SERVER_TOKEN` from that subject's `.env`, drops any incoming `Authorization` / `X-AI-Token`, and sets `X-AI-Token` on the proxied request. `<base>/<slug>/local.config.js` is generated: `{serverUrl: "<base>/<slug>/api", gated: true, model}`. The subject's own `host/local.config.js` is never served. | §0. A browser that holds no secret cannot leak one. | "local.config has no token", "proxy injects token", "client header dropped" |
| GW-4 | `<base>/<slug>/` serves the same tree as `serve_host.py` (host page, `kit/`, `content/`) through `hostfiles.py`. `<base>/<slug>` redirects (`308`) to the trailing slash; an unknown slug is `404`. | The tunnel does not strip the prefix; one resolver means the two hosts cannot disagree on what is served. | "prefix serves host", "slash redirect", "unknown slug 404" |
| GW-5 | `<base>/<slug>/api/<rest>` is proxied to `http://127.0.0.1:<AI_SERVER_PORT>/<rest>` (method, query, body up to 4 MB, `Content-Type`) **only for the routes the web parts use**: `GET /health`, `GET /sessions`, `POST /ai`, `POST /problems`, and `GET/PUT/DELETE/POST /state/...`. `POST /repos/load` passes only for a subject whose config sets `"allowRepoLoad": true`; anything else is `404`. Status, body and `Content-Type` come back unchanged. Upstream unreachable → `502 {"ok":false,"error":"ai_server unreachable"}`. Timeout 900 s. **A browser that disconnects while it waits closes the upstream connection too.** | `ai_server` stays the only AI and state boundary (Web SoT §2); generation can take minutes. `/repos/load` reads any local folder the server can see, so one stolen session would read the PC's files; the allowlist keeps a session to what the subject's pages need (adversarial review 2026-10-18). A `502` lets the web degrade (Web SoT §7). `ai_server` ends a `claude` child when its caller drops (Web SoT §2, session lifetime); a proxy that keeps waiting hides the drop, so a closed tab would still spend a whole generation (measured 2026-10-18: two aborted concept loads reached no log line and no record). | "proxy round trip", "upstream down 502", "client drop closes upstream" |
| GW-6 | The gateway starts one `bot/ai_server.py <subject>/state` per subject, cwd = the subject folder. The child environment is the gateway's environment **minus** `AI_SERVER_*` and `STATE_ROOT`, **plus** the subject's `.env` values. A child that exits is restarted with backoff (1 s doubling to 60 s). On gateway exit every child is ended with its whole process tree, and on Windows every child is also in a job object closed with the gateway, so a gateway that is killed takes its children (and their `claude` processes) with it. `extraPath` from the config is put in front of `PATH` for the gateway and its children. | `env_load` lets an existing variable win over the file (`bot/env_load.py` docstring), so an inherited port or token from another subject would cross-wire two subjects' state. Tree kill: `proc.kill()` alone leaves `claude.exe` running on Windows (Web SoT §2, measured 2026-10-05). Ending the scheduled task killed only its launcher and left the gateway and both `ai_server`s running with the old code (measured 2026-10-18); the job object makes the gateway's death enough. `extraPath` exists because a task started without a logon may not get the user's `PATH`, where the `claude` CLI lives. | "child env isolation", "duplicate port refused" |
| GW-7 | Startup refuses a config where two subjects share a slug or an `AI_SERVER_PORT`, a slug fails `^[a-z0-9][a-z0-9-]{0,31}$` or is one of the reserved paths `login`, `logout`, `health`, a subject folder lacks `content/app.json`, or a `.env` lacks `AI_SERVER_TOKEN`. | A silent misroute between subjects is worse than not starting. | "config validation" |
| GW-8 | One user. The password is checked against an scrypt hash (`n=2^14, r=8, p=1`, 16-byte salt) with a constant-time compare. The session is a signed cookie `lh_study=<issued>.<expires>.<hmac>` (HMAC-SHA256 with the config `secret`), `Path=<base>`, `HttpOnly`, `SameSite=Lax`, and `Secure` when the request arrived over https (`CF-Visitor` or `X-Forwarded-Proto`). Lifetime `sessionDays` (default 30), re-issued once half of it has passed. | Stateless, so a gateway restart does not log the user out. A cookie scoped to `<base>` never reaches other apps on the same domain, and theirs never reach this one. | "login sets cookie", "tampered cookie rejected", "expired cookie rejected", "sliding reissue" |
| GW-9 | `--set-password` asks for the password twice (no echo), stores the hash and a fresh random `secret`. A new secret invalidates every existing session. | The one way to log out every device; the password is never typed into a file or a command line. | "set-password rotates secret" |
| GW-10 | Login throttle: 5 attempts that did not succeed within 15 minutes from one client, or 30 from all clients together, answer `429` until the window passes. An attempt is counted **before** the password is checked and cleared on success, and at most two password checks run at once. The client is `CF-Connecting-IP` when the peer is loopback (the tunnel), else the peer address; an IPv6 address counts by its /64. | The page is public; this bounds a password guesser. Counting after the check let parallel requests all pass the limit before any failure was recorded, a single IPv6 /64 holds countless addresses, and each scrypt check takes 16 MiB (adversarial review 2026-10-18). | "throttle after 5 failures", "parallel attempts counted", "global cap", "ipv6 /64" |
| GW-11 | A request with a method other than GET/HEAD whose `Origin` header is present and does not match `Host` is refused with `403`. | Cookie authentication needs a CSRF guard; `SameSite=Lax` alone leaves top-level POSTs open. | "cross-origin post 403" |
| GW-12 | `<base>/` lists the subjects (title from each `content/app.json`) with links, and a logout button. | One entry point on a phone. | "index lists subjects" |
| GW-13 | Every response is `Cache-Control: no-store`. The log line is method, path without query, status and duration; never a cookie, token, password or body. | Same as `serve_host.py`: a cached copy hides an edit. Secrets stay out of logs (Web SoT §7). | "no-store header" |
| GW-15 | A `next` target is used only when it is printable ASCII without spaces (and inside `<base>/`, GW-8); header values are never built from unchecked input. | `next` reached the `Location` header raw, so `%0d%0a` split the response and set cookies for the whole domain (adversarial review 2026-10-18). | "next with CRLF refused" |
| GW-16 | A malformed request (bad URL, a cookie with non-ASCII bytes, an unreadable body) answers `400`; a client socket idles at most 60 s; a login body is at most 4 KB. | One process serves every subject; a request that raises, or a client that sends a large Content-Length and nothing else, must not take a worker down or hold it forever. | "malformed cookie 400", "login body cap" |
| GW-17 | The page refers to `host.js`, `host.css` and every `kit/assets/` file with `?v=<content hash>`; a request whose `v` matches the file's current hash is answered with `Cache-Control: private, max-age=31536000, immutable`, anything else stays `no-store` (GW-13). Text responses over 1 KB are gzip-compressed when the request accepts gzip. | Every view switch reloads the page, and over the tunnel a request costs 1.1 to 1.9 s (measured 2026-10-18, routed through Cloudflare LAX), so re-fetching a 256 KB bundle each time is the largest avoidable cost. `private` keeps files that sit behind the login out of Cloudflare's shared cache. A hash, not a timestamp, so a rebuild with the same output keeps the cache. | "versioned assets cached", "stale version not cached", "gzip when accepted" |
| GW-18 | `<base>/<slug>/` is rendered with an inline boot block in place of the `local.config.js` script: `window.LH_LOCAL` (the GW-3 values) and `window.LH_BOOT = {app, files, bundle, state}`, where `app` is `content/app.json`, `files` holds every file a view names (resolved through `hostfiles.py`, Markdown and text as strings), `bundle` is the versioned bundle URL, and `state` is the subject's `/state/_snapshot` (omitted when `ai_server` does not answer within 2 s). JSON in the block escapes `<`, U+2028 and U+2029. `host.js` uses `LH_BOOT` when present and fetches as before otherwise. | Before the first paint the page made about six sequential round trips (page, config, app.json, content files, then outline and indexes); inlining what the server already knows removes all but the page itself and the record reads. Escaping keeps a `</script>` inside content from closing the block. | "boot inline", "boot escapes script close", "boot without snapshot" |
| GW-14 | The gateway code names no subject, domain or path. Slugs, folders, port, `basePath`, title and the auth block come from the config file given by `--config`, which lives outside the kit. | Kit governance (KT-1, KT-2). | `test_subject_agnostic.py` covers `tools/gateway/` |

## 2. Config (`--config <file>`, outside the kit, never committed)

```jsonc
{
  "basePath": "/study",            // no trailing slash
  "port": 8430,
  "title": "Study",                // the index page heading
  "extraPath": ["C:/Users/<user>/AppData/Roaming/npm"],   // GW-6: put in front of PATH (the claude CLI)
  "subjects": [
    { "slug": "saa", "dir": "D:\\path\\to\\subject", "allowRepoLoad": false }   // GW-5; default false
  ],
  "auth": {
    "user": "name",                // shown on the login form only
    "passwordHash": "scrypt$16384$8$1$<salt hex>$<hash hex>",
    "secret": "<64 hex>",
    "sessionDays": 30
  }
}
```
Each subject folder keeps its own `.env` (`AI_SERVER_TOKEN`, `AI_SERVER_PORT`, optional `HOST_PORT` used only by
`start_web.ps1`) and `content/app.json`, exactly as for `serve_host.py`.

## 3. Routes

| Path | Auth | Result |
|---|---|---|
| `GET <base>/health` | none | `{"ok":true}` |
| `GET <base>/login` | none | login form; `POST` checks the password (GW-8, GW-10) and redirects to a safe `next` (same `<base>` only) |
| `POST <base>/logout` | none | clears the cookie, `303` to the login page |
| `GET <base>/` | session | subject index (GW-12) |
| `GET <base>/<slug>/...` | session | host tree via `hostfiles.py` (GW-4) |
| `GET <base>/<slug>/local.config.js` | session | generated runtime config (GW-3) |
| `* <base>/<slug>/api/<rest>` | session | proxy to the subject's `ai_server` (GW-5) |

## 4. Host-file resolver (`tools/hostfiles.py`)

One function decides what a host serves for a subject, used by `serve_host.py` and the gateway:
`resolve(subject_dir, kit_dist, rel_path) -> Path | None`, where `rel_path` is the path below the subject root
(`""`, `index.html`, `host.js`, `host.css`, `kit/<f>`, `content/<f>`). It refuses anything that resolves
outside its root. `local.config.js` is not resolved here: `serve_host.py` reads the subject file, the gateway
generates it (GW-3).

**Content links.** `content/app.json` may name files that live outside `content/`:
`"contentLinks": {"roadmap.md": "../../ROADMAP.md"}` (path relative to `content/`). `content/roadmap.md` then
serves that file. Only names listed there escape `content/`; everything else is confined as before. This lets a
planning document that lives elsewhere stay the single source a part reads, instead of a copy that drifts.

## 5. Running

```
python tools/gateway/gateway.py --config <file> --set-password
python tools/gateway/gateway.py --config <file>
```
Run it as the user who is logged in to the `claude` CLI: the subscription login lives in that user's profile,
so a service running as SYSTEM cannot use it.
