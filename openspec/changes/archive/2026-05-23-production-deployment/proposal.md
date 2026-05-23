## Why

The Flask webapp currently starts with Werkzeug's development server, which prints `WARNING: This is a development server. Do not use it in a production deployment.` on every launch. The target audiences — solo freelancers running this on their own laptop and SMEs running it on an internal server — need a documented, low-friction way to run the webapp that (a) silences the warning with a real WSGI server and (b) does not require them to manually install Python, `uv`, and WeasyPrint's native dependencies (Pango, Cairo, fonts).

## What Changes

- Add **gunicorn** under a new PEP 735 `[dependency-groups].prod` entry in `pyproject.toml` (alongside the existing `dev` group), and document a production launch command for users who already have a working Python environment.
- Add a **Dockerfile** based on `python:3.12-slim-bookworm` that installs WeasyPrint's native libraries, runs `uv sync --frozen --no-dev --group prod`, and uses gunicorn as the container entrypoint.
- Add a **`.dockerignore`** to keep the build context small.
- Add a **`docker-compose.yml`** that wires the image to an `.env` file and binds the webapp to `127.0.0.1:5000` by default (not `0.0.0.0`), so the out-of-the-box configuration is safe on a machine without a reverse proxy.
- Update **README.md** with three clearly-labeled run modes — *Develop*, *Run with Python (production)*, *Run with Docker (production)* — and a short **Security** note stating that the webapp has no authentication and must be bound to localhost or placed behind an authenticating reverse proxy if exposed beyond the local machine.
- Update **CLAUDE.md** to reference the new run modes alongside the existing `uv run python webapp/app.py` dev command.

Explicitly **out of scope** for this change: webapp authentication, HTTPS / reverse proxy configuration, desktop-app packaging (PyInstaller / Briefcase), and publishing prebuilt images to GHCR. Each of these is a separate future change.

## Capabilities

### New Capabilities
- `deployment`: How the webapp is packaged and launched for production use — covers the gunicorn command, the Docker image, the compose file, and the security contract around network binding.

### Modified Capabilities
<!-- None. The Flask routes, PDF rendering, UBL generation, validation, and API client are unchanged. This change only affects how the existing webapp-api/webapp-ui capabilities are *launched*, not what they do. -->

## Impact

- **New dependencies**: `gunicorn` (optional, `prod` extra only — dev workflow and tests are unaffected).
- **New files**: `Dockerfile`, `.dockerignore`, `docker-compose.yml`.
- **Modified files**: `pyproject.toml` (add optional-dependency group), `README.md` (run modes + security note), `CLAUDE.md` (run-mode reference).
- **Unchanged**: `webapp/app.py` Flask code, `peppol_sender/*`, CLI, tests, validator, API client. The `if __name__ == "__main__"` block in `webapp/app.py` is retained for the dev workflow; gunicorn imports the `app` object directly and does not execute it.
- **Runtime surface**: The default Docker binding is `127.0.0.1:5000` on the host, matching the current dev server behavior, so no new network exposure is introduced by default.
- **CI**: No changes required for this proposal. A future change may add a `docker build` smoke test.
