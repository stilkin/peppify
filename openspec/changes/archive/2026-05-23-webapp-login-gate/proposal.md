## Why

The `production-deployment` change shipped a safe loopback-only default and explicitly deferred "Webapp authentication" to a future change. **This is that change.**

Concrete driver: the target user runs Peppify permanently on a **headless workstation** (no screen, so `http://localhost` on the box itself is not usable) and wants to reach the web UI from other devices on the LAN — without leaving invoice-sending wide open to everyone on the network. Today the only sanctioned way to expose the webapp beyond `127.0.0.1` is an authenticating reverse proxy, which is heavier setup than a single-tenant install warrants.

An **optional, single-password login gate** lets a one-tenant-per-deployment install bind to the LAN and keep casual / unauthorized users out, while the Peppyrus API key stays server-side in `.env` exactly as today. The gate is opt-in: with no password configured, the app behaves identically to the current loopback default, so the dev workflow and the test suite are untouched.

## What Changes

- Add an **optional single-password login gate** to the Flask webapp, enabled by the presence of `APP_PASSWORD_HASH` in the environment. When set, every route except the login page and static assets requires an authenticated session (a server-signed cookie). When unset, no authentication is enforced — current behavior.
- Session signing uses Flask's `SECRET_KEY`, read from the environment; if absent, a random key is generated at startup and a warning is logged (consequence: sessions and CSRF tokens reset on restart → re-login).
- Add **CSRF protection to `POST /api/send`** when the gate is enabled — the one irreversible, real-world-cost action. Other endpoints rely on `SameSite` session cookies; `send` gets explicit token protection.
- Emit a **prominent startup warning** when the app is bound to a non-loopback interface with no password set (the "exposed with no gate" footgun). Warn, do not refuse.
- Make the **network binding configurable** via `BIND_HOST` / `BIND_PORT` (default `127.0.0.1:5000`), wired through the dev server, a new `gunicorn.conf.py`, and `docker-compose.yml` host-port interpolation — plus `COMPOSE_PROJECT_NAME` guidance so multiple single-tenant deployments coexist on one host without port / container / volume collisions.
- Update the **`deployment` security contract**, the README **Security** section, and `CLAUDE.md`: exposure beyond loopback is now sanctioned when the gate is enabled, with the plain-HTTP caveat documented (over plain HTTP the password and session cookie travel in cleartext — fine for a trusted LAN; use a TLS-terminating reverse proxy for stronger protection).

Explicitly **out of scope** (each a possible future change):

- **Multi-user accounts**, a user database, RTBF, or retention policy — this is *one tenant per deployment*, one shared password. No server-side user data beyond the password hash and signing key (both in `.env`).
- **Storing Peppyrus credentials in the UI or a vault** — the API key stays in `.env`, server-side, read once at startup.
- **HTTPS / TLS termination** — still bring-your-own reverse proxy. The gate alone enables LAN exposure on a *trusted* network; TLS remains the recommendation for untrusted ones.
- **A token-authenticated HTTP API** for scripting the `/api/*` endpoints — the **CLI remains the programmatic interface** and is entirely unaffected by the gate. If such an API is added later, it would authenticate via a request **header** (inherently CSRF-immune), kept separate from the browser session lane.

## Capabilities

### Modified Capabilities

- `deployment`: the "Documented run modes and security contract" requirement is updated — non-loopback exposure is now sanctioned when the login gate is enabled, and the network binding becomes configurable. A new requirement covers the configurable binding.

### New Capabilities

<!-- The auth gate and login page are new behaviors layered onto the existing webapp-api / webapp-ui capabilities. -->

- `webapp-api`: optional login gate (session auth, route protection, CSRF on send, startup warning).
- `webapp-ui`: a login page presented when the gate is enabled.

## Impact

- **New dependencies**: none required — Flask sessions + Werkzeug `generate_password_hash` / `check_password_hash` are already available; CSRF is a session-token + header check. (Design may opt into `flask-wtf` if it proves cleaner, but no new hard dependency is assumed.)
- **New files**: `gunicorn.conf.py` (env-driven bind), a login template, minimal login CSS/JS hooks.
- **Modified files**: `webapp/app.py` (gate, session, CSRF, route protection, configurable bind, startup warning), `docker-compose.yml` (env-interpolated host port + project name), `.env.example` (new vars), `README.md` (Security), `CLAUDE.md` (run modes / security / env vars).
- **Backward compatible**: with no `APP_PASSWORD_HASH` set, behavior is byte-for-byte today's; existing tests run unchanged.
- **CLI unaffected**: `cli.py` talks to Peppyrus directly and never touches the webapp, so the gate does not change programmatic invoicing.
- **New env vars**: `APP_PASSWORD_HASH` (optional — enables gate), `SECRET_KEY` (optional — else auto-generated + warning), `BIND_HOST` (default `127.0.0.1`), `BIND_PORT` (default `5000`), `COMPOSE_PROJECT_NAME` (Docker, per-deployment).
