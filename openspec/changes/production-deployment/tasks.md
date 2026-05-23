## 1. Gunicorn as an optional dependency

- [x] 1.1 Add `[dependency-groups].prod = ["gunicorn>=23.0"]` to `pyproject.toml` (alongside the existing `dev` group)
- [x] 1.2 Run `uv sync --group prod` and verify `uv.lock` is updated and committed
- [x] 1.3 Verify `uv run gunicorn webapp.app:app -b 127.0.0.1:5000 --workers 2` starts the app, answers `GET /`, and does NOT emit the Werkzeug "development server" warning
- [x] 1.4 Verify that `uv sync` (without the `prod` group) still works and `uv run pytest` passes without gunicorn installed

## 2. Dockerfile

- [x] 2.1 Create `Dockerfile` based on `python:3.12-slim-bookworm`
- [x] 2.2 Install WeasyPrint native deps via apt (`libpango-1.0-0`, `libpangoft2-1.0-0`, `libharfbuzz0b`, `libcairo2`, `libgdk-pixbuf-2.0-0`, `libffi-dev`, `shared-mime-info`, `fonts-dejavu-core` — cross-check against WeasyPrint upstream install docs and trim/extend as needed)
- [x] 2.3 Install `uv` in the image (pinned version, e.g. via the official `ghcr.io/astral-sh/uv` copy-from pattern or `pip install uv==<pin>`)
- [x] 2.4 Set `WORKDIR /app`, copy `pyproject.toml` + `uv.lock` first, run `uv sync --frozen --no-dev --group prod` as a cached layer
- [x] 2.5 Copy application source (`webapp/`, `peppol_sender/`, `schemas/`, `cli.py`) in a later layer so source edits don't invalidate the dependency layer
- [x] 2.6 `EXPOSE 5000` and set `CMD ["uv", "run", "gunicorn", "webapp.app:app", "-b", "0.0.0.0:5000", "--workers", "2", "--access-logfile", "-", "--error-logfile", "-"]`
- [x] 2.7 Create a non-root `appuser` in the image and `USER appuser` before `CMD`

## 3. Dockerignore

- [x] 3.1 Create `.dockerignore` excluding `.venv/`, `.git/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.env`, `tests/`, `docs/`, `openspec/`, `.claude/`, `.opencode/`, `README.md` edit history, and any `*.xml` / `*.pdf` leftovers from local runs
- [x] 3.2 Build the image and confirm the build context is small (< ~10 MB) via `docker build --progress=plain .` output — **verified on `pocito-ws1` 2026-05-23: context = 3.65 MB**

## 4. Build & smoke test

> **Verified on `pocito-ws1` (Docker 29.4.3 / Compose v5.1.3) 2026-05-23.** The initial build FAILED — `uv sync` builds the `peppify` package and hatchling requires the `LICENSE` + `README.md` files named in `pyproject.toml`, but the Dockerfile copied neither. Fixed by adding `LICENSE README.md` to the source-layer `COPY`. All 4.x below verified against the fixed Dockerfile.

- [x] 4.1 `docker build -t peppify:dev .` succeeds on a clean clone — **succeeds; required the LICENSE/README COPY fix (commit 9e31e8f), now verified building from a pristine clone of `origin/development`**
- [x] 4.2 `docker run --rm -p 127.0.0.1:5000:5000 --env-file .env peppify:dev` starts and serves the webapp — **gunicorn 25.3.0, 2 workers, runs as non-root `appuser`**
- [x] 4.3 Hit `GET /` from the host and confirm the index page loads — **HTTP 200, "Peppify — Invoice Composer"**
- [x] 4.4 Hit `GET /api/org-info` (with dummy env vars OK if the endpoint is gated) and confirm the route reaches Flask — **HTTP 200 with live test-server org data**
- [x] 4.5 Render a PDF inside the container via `POST /api/preview-pdf` with `sample_invoice.json` and confirm a valid PDF is returned (proves Pango/Cairo/fontconfig are present) — **HTTP 200, `application/pdf`, 20 KB, `%PDF-1.7`**
- [x] 4.6 Confirm the Werkzeug dev-server warning is absent from `docker logs` — **absent; only gunicorn boot lines**
- [x] 4.7 Record the resulting image size (`docker images peppify:dev`) in the PR description for future reference — **372 MB**

## 5. docker-compose.yml

- [x] 5.1 Create `docker-compose.yml` with one service `webapp` that builds from `.` and maps `"127.0.0.1:5000:5000"` (explicit loopback binding)
- [x] 5.2 Add `env_file: .env` to the service
- [x] 5.3 Add `restart: unless-stopped`
- [x] 5.4 Verify `docker compose up --build` brings the app up and `docker compose down` tears it down cleanly, with no leftover volumes or named networks — **verified: up serves HTTP 200; down removed container + `_default` network, no leftover volumes**
- [ ] 5.5 Confirm from another machine on the LAN that port 5000 is NOT reachable (negative test for the loopback binding) — **binding verified loopback-only (`ss` shows `LISTEN 127.0.0.1:5000`, not `0.0.0.0`); literal cross-machine probe still needs a second host**

## 6. Documentation

- [x] 6.1 Update `README.md` with three labeled sections: **Development**, **Production (Python)**, **Production (Docker)**, each with a copy-pasteable command (placed under the existing `### Web UI` heading inside `## Running the tool`)
- [x] 6.2 Add a **Security** section to `README.md` stating: no built-in auth; default binding is `127.0.0.1`; any non-loopback exposure requires an authenticating reverse proxy
- [x] 6.3 Update `CLAUDE.md` Commands section to include the gunicorn and Docker commands alongside the existing `uv run python webapp/app.py`
- [x] 6.4 Add a reference in `CLAUDE.md` pointing to the README Security section (inline comment on the `docker compose up` command)
- [x] 6.5 Proofread both files and confirm the commands copy-paste cleanly

## 7. Verification & archive

- [x] 7.1 Run the full local checks: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `uv run pytest` — all clean; 178 tests pass, 99.25% coverage
- [x] 7.2 Rebuild the Docker image from a fresh clone of the branch and re-run the smoke test in task 4 to confirm no host-machine contamination — **verified on `pocito-ws1` 2026-05-23: `git clone` of `origin/development` @ 9e31e8f, built clean (372 MB), all 4.x re-passed, runtime user `appuser`**
- [x] 7.3 Run `openspec validate production-deployment --strict` and resolve any findings — passes
- [ ] 7.4 Open PR referencing this change directory; after merge, archive via `/openspec-archive-change` — **PR opened and merged; archive still pending the deferred Docker tasks (3.2, 4.x, 5.4, 5.5, 7.2)**

## Notes

- **Deviation from the original proposal**: gunicorn is added under PEP 735 `[dependency-groups].prod` (matching the existing `dev` group) rather than `[project.optional-dependencies]`. Install flag is `uv sync --group prod`, not `--extra prod`. Spec, design, proposal, and tasks updated accordingly in-flight.
- **Gunicorn path fully verified on dev machine**: `GET /` returns HTTP 200, `POST /api/preview-pdf` returns a valid 28 KB PDF (PDF rendering works under gunicorn workers), zero "development server" warnings in the gunicorn log, clean shutdown.
- **Docker-related tasks (3.2, 4.x, 5.4, 5.5, 7.2) are deferred**, not dropped. They must be ticked off on a host with Docker installed before the change is archived.
