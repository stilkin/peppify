## Context

Peppify's webapp is a Flask app (`webapp/app.py`) with a bottom-of-file `app.run(host="127.0.0.1", port=5000, debug=debug)` block, which uses Werkzeug's built-in development server. Launching it prints the well-known `WARNING: This is a development server...` message. The app is stateless (all user state lives in browser localStorage), it reads configuration from `.env`, and it depends on WeasyPrint — which needs native Pango/Cairo/GLib/fonts libraries — for PDF rendering.

The target audiences are (a) a solo self-employed user running it on a personal Windows/macOS/Linux laptop and (b) an SME running it on an internal Linux server. A small cloud deployment is possible but not the primary case, and the app has no built-in authentication, so exposing it on a public interface is unsafe regardless of which run mode is used.

Current dev command: `uv run python webapp/app.py`.

## Goals / Non-Goals

**Goals:**
- Silence the Werkzeug dev-server warning by shipping a documented production WSGI server (gunicorn).
- Offer a zero-install path via a Docker image so users do not have to set up Python, `uv`, or WeasyPrint's native libraries manually.
- Keep the dev workflow (`uv run python webapp/app.py`, `uv run pytest`, `uv run ruff ...`) untouched.
- Ship a safe default: the container binds to `127.0.0.1` on the host, matching the current dev-server behavior.
- Document the no-auth constraint so users running in any environment understand the network-exposure contract.

**Non-Goals:**
- Webapp authentication (future change).
- HTTPS termination or reverse-proxy configuration — users who need TLS bring their own Caddy/Traefik/nginx (future change, possibly documented as a recipe).
- Desktop-app packaging (PyInstaller / Briefcase).
- Publishing prebuilt images to GHCR or Docker Hub — users build locally. Can be added in a later change.
- Switching away from Flask or rewriting `webapp/app.py`.
- Horizontal scaling, multi-host orchestration, Kubernetes manifests.

## Decisions

**1. Gunicorn over Waitress / uWSGI / Hypercorn.**
Gunicorn is the de-facto WSGI server in the Python/Flask ecosystem, pure-`pip`-installable, and works the same inside and outside Docker. Waitress is a reasonable pure-Python / Windows-friendly alternative but is less commonly recognized; uWSGI has harder native build deps and a reputation for configuration pain; Hypercorn is ASGI-first and overkill for a sync Flask app. Gunicorn wins on "least surprise" for the documentation-driven UX we want.

**2. PEP 735 dependency group `prod`, not a core dependency.**
Add gunicorn under `[dependency-groups].prod` in `pyproject.toml`, matching the existing `dev` group style (the repo already uses PEP 735 dependency-groups rather than `[project.optional-dependencies]`). Rationale: tests, linting, and the dev server do not need gunicorn, and we do not want to bloat the default `uv sync` for contributors. The Docker image installs with `uv sync --frozen --no-dev --group prod`; local prod users run `uv sync --group prod`. Alternatives considered: (a) make gunicorn a core dep — rejected because it's unnecessary weight for the common case; (b) use `[project.optional-dependencies]` — rejected for consistency with the existing `dev` group.

**3. `python:3.12-slim` base image, not `alpine` or `distroless`.**
WeasyPrint depends on Pango, Cairo, GDK-PixBuf, GLib, and a working fontconfig + at least one font package. On Alpine these exist but the `musl` runtime occasionally produces subtle rendering differences and harder-to-debug segfaults with Cairo; `slim` (Debian) matches WeasyPrint's upstream-documented install instructions verbatim. `distroless` doesn't ship the shared libraries WeasyPrint needs. The size penalty of `slim` vs. `alpine` (~30–50 MB) is not worth the debugging risk for a PDF-heavy app.

**4. Install `uv` in the image and run `uv sync --frozen`, rather than exporting a `requirements.txt`.**
Keeps the lockfile (`uv.lock`) as the single source of truth and mirrors how contributors install locally. The image does a two-stage-style layer cache: copy `pyproject.toml` + `uv.lock` first, run `uv sync`, then copy source — so source edits don't invalidate the dependency layer. A true multi-stage build (builder → runtime) is tempting but adds complexity for limited savings when the runtime already needs all the WeasyPrint native libs present. We use a single-stage build for now; revisit if image size becomes a pain point.

**5. Bind to `127.0.0.1:5000` on the host by default via `docker-compose.yml`.**
The container itself listens on `0.0.0.0:5000` internally (it has to, so the host can reach it), but the compose port mapping is `"127.0.0.1:5000:5000"` — not `"5000:5000"`. This means out-of-the-box the webapp is only reachable from the host, matching today's dev-server behavior. A user who wants LAN or public exposure must consciously change the binding *and* read the security note telling them to put auth in front of it. Alternatives considered: bind to `0.0.0.0` with a big warning — rejected because defaults should be safe, not loud.

**6. Gunicorn configuration: `--workers 2 --bind 0.0.0.0:5000 --access-logfile - --error-logfile -`.**
Two workers handles concurrent users for a small-business invoicing tool without overcommitting RAM (WeasyPrint + Pango hold a fair amount of shared state per worker). Logs go to stdout/stderr so `docker logs` / systemd journal / gunicorn-in-foreground all work the same way. The worker count is not tunable via env var in this change — it's hardcoded in the Dockerfile CMD and the documented command — to keep scope tight. Users who need more can override `CMD` or the documented command.

**7. Do not change `webapp/app.py`.**
Gunicorn imports `webapp.app:app` directly. The `if __name__ == "__main__": app.run(...)` block at the bottom is only executed when the file is run as a script (dev workflow) and is a no-op under gunicorn, so we leave it alone. Alternative considered: move the app construction into a factory function — rejected as gratuitous churn; the current module-level `app = Flask(__name__)` works fine for gunicorn.

**8. `.env` is mounted, not baked in.**
The Docker image contains no credentials. `docker-compose.yml` uses `env_file: .env` so the user's `PEPPYRUS_API_KEY`, `PEPPOL_SENDER_ID`, and `PEPPYRUS_BASE_URL` stay on the host. The image itself is safe to share.

**9. Security note lives in README, not as a runtime check.**
We do not add a "refuse to start if bound to 0.0.0.0 without auth" runtime check. Such a check would be easy to bypass, would false-positive inside containers (where `0.0.0.0` is normal), and would feel paternalistic. A clear, one-paragraph Security section in README — referenced from CLAUDE.md — is the right mechanism.

## Risks / Trade-offs

- **WeasyPrint native deps in the Dockerfile are fragile across Debian releases.** → Pin the base image to a specific tag (`python:3.12-slim-bookworm`), list the apt packages exhaustively per WeasyPrint's official install docs, and include a smoke test in the implementation tasks that renders a PDF inside the built container before we declare the change done.
- **Docker Desktop friction on Windows/macOS for the solo-freelancer audience.** → Acknowledge in README that tier 1 (gunicorn directly under `uv`) exists precisely for users who find Docker heavy, and that tier 2 is optional. We do not force a single path.
- **No auth on the webapp is a real footgun if someone ignores the security note and binds to `0.0.0.0`.** → The default compose binding is `127.0.0.1`, the README Security section is unavoidable in the run-mode documentation, and CLAUDE.md mirrors it so future contributors (and Claude) stay aware. Still a residual risk; a follow-up change should add authentication.
- **Gunicorn worker count (2) may be wrong for someone rendering many concurrent PDFs.** → Documented as a known limitation; users can override `CMD` in a derived image or pass a different command when running `docker run` directly. Tuning is deferred.
- **Image size (~400–500 MB with Pango + Cairo + fonts).** → Accepted. This is an invoicing tool deployed once per site, not a microservice pulled thousands of times per day. Multi-stage build can be revisited later if it matters.
- **`uv.lock` drift between what devs use and what the image builds.** → `uv sync --frozen` in the Dockerfile means the image fails fast if the lockfile is inconsistent, so CI/devs notice immediately.
