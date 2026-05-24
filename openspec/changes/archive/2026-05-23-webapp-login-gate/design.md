## Context

Peppify's webapp (`webapp/app.py`) is a stateless Flask app: all user state lives in browser localStorage, configuration comes from `.env`, and the Peppyrus API key is read once at startup and never sent to the browser. The `production-deployment` change established a safe default — bind to `127.0.0.1`, no authentication — and documented that any non-loopback exposure requires an authenticating reverse proxy.

That contract is a poor fit for one real deployment: a **headless workstation** (no attached screen, so `http://localhost` on the box is unreachable in a browser) that the owner wants to reach from a phone / laptop on the **LAN**. Standing up a reverse proxy with TLS for a single-tenant personal install is more friction than the use case justifies.

The owner is comfortable with a deliberate, narrow trade: a **login gate over plain HTTP on a trusted LAN**, accepting that the gate is an access-control convenience (keeps casual / unauthorized LAN users from sending invoices) rather than a hardened boundary against a network-sniffing adversary. The mitigating fact: the Peppyrus key never leaves the server, so a sniffed session means "someone could send while the session is valid," not "someone stole the API key."

## Goals / Non-Goals

**Goals:**

- An **opt-in** login gate that, when enabled, protects every webapp route behind a single shared password, and when disabled leaves today's behavior (and the test suite) completely unchanged.
- Make the bind host/port **configurable** so a headless box can bind to the LAN and so multiple single-tenant deployments can run on one host.
- Keep the Peppyrus key exactly where it is — `.env`, server-side.
- Document the security trade honestly (plain-HTTP cleartext caveat; TLS reverse proxy as the upgrade path).

**Non-Goals:**

- Multi-user accounts, a user database, password reset, RTBF, retention — strictly **one tenant per deployment**, one shared password.
- Storing Peppyrus credentials in the UI or a client/server vault (the earlier zero-knowledge / Web-Crypto discussion) — deferred; the key stays in `.env`.
- HTTPS / TLS termination inside the app — bring-your-own reverse proxy if the network is untrusted.
- A token-authenticated HTTP API for the `/api/*` endpoints. The CLI is the programmatic interface. **Rationale captured for the future:** CSRF only threatens *ambient* (cookie) credentials, so a header-authenticated API client is inherently CSRF-immune; if such an API is ever added, it gets its own header-credential lane and is exempted from the browser CSRF check — it does not conflict with this design.

## Decisions

**1. Single shared password, no username.**
One tenant per deployment ⇒ realistically one login. A username adds nothing. The login form is a single password field. The password is stored **hashed** (`APP_PASSWORD_HASH`, via Werkzeug `generate_password_hash`) rather than plaintext: `.env` already holds the Peppyrus key, but a hash means a leaked `.env` does not hand over a reusable plaintext password (people reuse passwords). Operators generate the hash with a one-liner (documented in `.env.example`).

**2. Presence of `APP_PASSWORD_HASH` is the on/off switch.**
No separate `ENABLE_AUTH` flag. If the hash is set, the gate is on; if not, the app behaves exactly as today. This keeps the loopback dev/default path and the existing tests working with zero configuration, and makes "I exposed it but forgot to set a password" detectable (see decision 5).

**3. `SECRET_KEY` from env, else auto-generate + warn.**
Flask needs a `SECRET_KEY` to sign the session cookie (and CSRF token). Read it from the environment; if absent, generate a random one at startup and log a warning that sessions will not survive a restart. This keeps the app working out-of-the-box (no hard requirement to set it) while making the trade-off visible. Cookie flags: `HttpOnly` + `SameSite=Lax`; `Secure` is **off** by default because the gate is expected to run over plain HTTP (a `Secure` cookie would not be sent over HTTP and would silently break login) — it can be enabled when behind TLS.

**4. CSRF only on `/api/send`, only when gated.**
CSRF attacks ride an authenticated session, so CSRF protection is meaningful only when the gate is on. Among the endpoints, `/api/send` is the one that is irreversible and has real-world cost (it transmits a legally-binding invoice and may incur charges), so it gets an explicit CSRF token (issued into the session, echoed by the SPA via an `X-CSRFToken` header). The other state-changing endpoints (`/api/validate`, `/api/preview-pdf`) are idempotent / side-effect-free and rely on `SameSite=Lax`. When the gate is off there is no session to protect and the endpoints behave as today.

**5. Warn, do not refuse, on unguarded non-loopback binding.**
If `BIND_HOST` is non-loopback and no `APP_PASSWORD_HASH` is set, log a prominent startup warning. Refusing to start would be safer but risks locking someone out of their own headless box mid-setup; a loud warning is the friendlier guard that still surfaces the footgun.

**6. `BIND_HOST` / `BIND_PORT` mean "host-facing address."**
- **Dev server** and **bare-metal gunicorn** bind directly to `BIND_HOST:BIND_PORT` (default `127.0.0.1:5000`). gunicorn picks this up via a new `gunicorn.conf.py` that reads the environment, so `uv run gunicorn webapp.app:app` (no `-b`) honors it.
- **Docker**: the container's internal gunicorn keeps binding `0.0.0.0:5000` (so the port mapping works) — the existing `CMD -b 0.0.0.0:5000` overrides the conf file. The **host-side** mapping is what `BIND_HOST` / `BIND_PORT` control, via compose interpolation: `"${BIND_HOST:-127.0.0.1}:${BIND_PORT:-5000}:5000"`. So in both worlds `BIND_HOST:BIND_PORT` is consistently "where it's reachable from the host's network perspective."
- **Multiple deployments per host**: each lives in its own directory with its own `.env` carrying a distinct `BIND_PORT` and `COMPOSE_PROJECT_NAME` (the latter so container/volume/network names don't collide). The container-internal port stays `5000` everywhere.

**7. Route protection via a `before_request` hook.**
A single `before_request` checks, when the gate is enabled, that the session is authenticated; it exempts the login/logout routes and `/static/*` (so the login page can render its CSS/JS). Unauthenticated requests to a page route redirect to the login page; unauthenticated `/api/*` requests return `401` so the SPA can react. This is less error-prone than decorating every route individually and guarantees new routes are protected by default.
