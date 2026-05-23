# Deployment — running the web UI

Three ways to run the Flask web UI, from most to least recommended. All of them bind the app to
`127.0.0.1` by default; read [Exposing beyond localhost](#exposing-beyond-localhost) before changing that.

For the CLI (no server needed), see [Usage](usage.md).

## Production (Docker) — recommended

The image bundles Python, the pinned dependencies, and all native libraries required for PDF
rendering — no host install beyond Docker itself.

```bash
cp .env.example .env   # fill in PEPPYRUS_* values
docker compose up --build
# open http://127.0.0.1:5000
```

The compose file binds the app to `127.0.0.1` on the host and runs it under gunicorn as a non-root
user. Stop it with `docker compose down` — the container is stateless (all user state lives in the
browser), so nothing is left behind.

## Production (Python)

If you already have a local Python environment (see [Installation](installation.md)), serve the same
app with gunicorn directly:

```bash
uv sync --group prod
uv run gunicorn webapp.app:app -b 127.0.0.1:5000 --workers 2
# open http://127.0.0.1:5000
```

Served by gunicorn — no dev-server warning. Requires the system-level Pango/Cairo libraries
WeasyPrint needs (see [Installation → System prerequisites](installation.md#system-prerequisites-weasyprint)).

## Development

Flask's built-in dev server. Fine for local iteration; prints a Werkzeug warning because it is not a
production server.

```bash
uv run python webapp/app.py
# open http://127.0.0.1:5000
```

## Exposing beyond localhost

The webapp has **no authentication by default** (see the [Security](../README.md#security) note).
All run modes above bind to `127.0.0.1`, so out of the box the app is only reachable from the
machine it runs on. There are two sanctioned ways to expose it:

1. **Optional login gate (single-tenant LAN).** Set `APP_PASSWORD_HASH` in `.env` to enable a
   single-password gate over the whole UI, then set `BIND_HOST=0.0.0.0` (and optionally `BIND_PORT`)
   to reach it from other devices on a *trusted* LAN — e.g. a headless workstation. Generate the hash
   with:

   ```bash
   uv run python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your-password'))"
   ```

   `BIND_HOST` / `BIND_PORT` are honored by the dev server, bare-metal gunicorn (via
   `gunicorn.conf.py`), and the Docker host-port mapping. Run multiple deployments on one host by
   giving each its own directory with a distinct `BIND_PORT` and `COMPOSE_PROJECT_NAME`. Binding to a
   non-loopback address **without** `APP_PASSWORD_HASH` logs a loud startup warning (but still starts).

   Over plain HTTP the password and session cookie are sent in **cleartext**. Fine for a trusted LAN;
   on an untrusted network add a TLS-terminating reverse proxy and set `SESSION_COOKIE_SECURE=true`.

2. **Authenticating reverse proxy.** For internet exposure or stronger guarantees, put a reverse proxy
   (Caddy, Traefik, nginx + basic-auth, your SSO of choice) in front. This is **required** for any
   non-loopback exposure when the login gate is not enabled.
