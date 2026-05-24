## 1. Configuration & environment

- [x] 1.1 Add `APP_PASSWORD_HASH`, `SECRET_KEY`, `BIND_HOST`, `BIND_PORT` to `.env.example` with comments, including a one-liner for generating the password hash (`python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('...'))"`)
- [x] 1.2 In `webapp/app.py`, read `BIND_HOST` (default `127.0.0.1`) and `BIND_PORT` (default `5000`) in the `if __name__ == "__main__"` dev-server block
- [x] 1.3 Add `gunicorn.conf.py` that sets `bind = f"{BIND_HOST}:{BIND_PORT}"` from the environment (default `127.0.0.1:5000`), so bare-metal `uv run gunicorn webapp.app:app` honors it
- [x] 1.4 Configure `app.secret_key` from `SECRET_KEY`; if absent, generate a random key (`secrets.token_hex`) at startup and log a WARNING that sessions/CSRF tokens will not survive a restart

## 2. Login gate

- [x] 2.1 Add a helper that reports whether the gate is enabled (`APP_PASSWORD_HASH` present and non-empty)
- [x] 2.2 Add a `before_request` hook that, when the gate is enabled, requires an authenticated session for all routes except `/login`, `/logout`, and `/static/*` — page routes redirect to `/login`, `/api/*` returns `401`
- [x] 2.3 Add `GET /login` (render the login page) and `POST /login` (verify the password with `check_password_hash`, set the session, redirect to `/`); reject incorrect passwords without establishing a session
- [x] 2.4 Add `POST /logout` (or `GET /logout`) that clears the session and returns to the login page
- [x] 2.5 Set session cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` off by default (document how to enable behind TLS)
- [x] 2.6 Confirm the gate-disabled path: with no `APP_PASSWORD_HASH`, no `before_request` enforcement and no login routes effect — behavior identical to today

## 3. CSRF protection on send

- [x] 3.1 Issue a per-session CSRF token and expose it to the SPA (e.g. a `<meta name="csrf-token">` in the page, or returned on login)
- [x] 3.2 When the gate is enabled, enforce a valid CSRF token on `POST /api/send` (read from an `X-CSRFToken` header); reject missing/invalid tokens with `400`/`403` and make no Peppyrus call
- [x] 3.3 Update `webapp/static/app.js` to send the CSRF token header on the `/api/send` request
- [x] 3.4 Confirm the gate-disabled path skips CSRF entirely (backward compatible)

## 4. Startup safety warning

- [x] 4.1 At startup, if `BIND_HOST` resolves to a non-loopback address and `APP_PASSWORD_HASH` is unset, log a prominent WARNING that the webapp is exposed without authentication (warn, do not refuse)

## 5. Login UI

- [x] 5.1 Add a login template (single password field, submit button) reusing the existing CSS where possible
- [x] 5.2 Show a logout control in the app header **only** when the gate is enabled
- [x] 5.3 Display a clear error on failed login without leaking whether the field was empty vs. wrong

## 6. Multiple deployments & compose

- [x] 6.1 Parameterize `docker-compose.yml` host port mapping: `"${BIND_HOST:-127.0.0.1}:${BIND_PORT:-5000}:5000"` (container-internal port stays `5000`; `CMD -b 0.0.0.0:5000` unchanged)
- [x] 6.2 Document `COMPOSE_PROJECT_NAME` per deployment and verify two deployments on distinct `BIND_PORT`s coexist without container/volume/network collisions (verified on a Docker host: two stacks `gt-a`/`gt-b` on ports 5055/5056 came up with separate containers, networks, and no collisions)
- [x] 6.3 Pass the new env vars through `env_file: .env` so the compose interpolation and container both see them

## 7. Documentation

- [x] 7.1 Rewrite the README **Security** section: optional login gate (how to enable), configurable binding, the gate-enables-LAN-exposure contract, and the plain-HTTP cleartext caveat with TLS reverse proxy as the upgrade path
- [x] 7.2 Update `CLAUDE.md`: note the optional gate + the new env vars, and keep the Security reference current
- [x] 7.3 Cross-check `docs/deployment.md` "Exposing beyond localhost" so it reflects the gate as an alternative to the reverse proxy

## 8. Tests

- [x] 8.1 Regression: with no `APP_PASSWORD_HASH`, all existing endpoints are reachable without auth and the current test suite passes unchanged
- [x] 8.2 Gate enabled: unauthenticated `/` redirects to login, unauthenticated `/api/*` returns `401`; correct password establishes a session and unlocks routes; incorrect password is rejected
- [x] 8.3 Logout clears the session
- [x] 8.4 CSRF: gated `POST /api/send` requires a valid token (missing/invalid → rejected, no Peppyrus call); gate-disabled send is unaffected
- [x] 8.5 Startup warning is emitted when `BIND_HOST` is non-loopback and no password is set, and not emitted otherwise
- [x] 8.6 `BIND_HOST` / `BIND_PORT` are honored by the dev-server block

## 9. Verification & archive

- [x] 9.1 Run local checks: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `uv run pytest`
- [x] 9.2 Manual end-to-end: enable the gate, bind to the LAN on the headless box, log in from another device, send a test invoice — gate behavior verified on a Docker host over the LAN IP via curl (unauth redirect to /login, /static reachable, wrong password 401, `$$`-escaped hash accepted → login 302, CSRF enforced on /api/send), and confirmed in real use: the operator logs in from a browser on another LAN device and the deployed instance loads org/seller data. (Multi-worker session bug found here and fixed via gunicorn `--preload`.)
- [x] 9.3 Run `openspec validate webapp-login-gate --strict` and resolve findings
- [x] 9.4 Open a PR referencing this change; after merge, archive
