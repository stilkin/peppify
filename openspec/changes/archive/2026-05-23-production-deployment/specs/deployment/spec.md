## ADDED Requirements

### Requirement: Production WSGI server (gunicorn)

The project SHALL provide gunicorn as an installable optional dependency and document a production launch command that runs the Flask webapp without the Werkzeug development-server warning.

#### Scenario: Installing the prod extra
- **WHEN** a user runs `uv sync --group prod` in the project root
- **THEN** gunicorn is installed into the project's virtual environment and available on `PATH` as `gunicorn` when the venv is active (or via `uv run gunicorn`)

#### Scenario: Launching the webapp under gunicorn
- **WHEN** a user with the `prod` extra installed runs `uv run gunicorn webapp.app:app -b 127.0.0.1:5000 --workers 2`
- **THEN** the Flask app at `webapp/app.py` is served by gunicorn, the Werkzeug `WARNING: This is a development server` message is not emitted, and the app responds to HTTP requests on `127.0.0.1:5000`

#### Scenario: Dev workflow is unchanged
- **WHEN** a user runs `uv run python webapp/app.py` without the `prod` extra installed
- **THEN** the Flask development server still starts exactly as it does today (this requirement does not remove or modify the existing dev command)

#### Scenario: Tests do not require gunicorn
- **WHEN** a user runs `uv sync` (without `--group prod`) and then `uv run pytest`
- **THEN** the test suite runs to completion without requiring gunicorn to be installed

### Requirement: Docker image for zero-install deployment

The project SHALL provide a `Dockerfile` that produces a runnable image containing Python, the pinned project dependencies (including the `prod` extra), and all native libraries required by WeasyPrint to render PDFs.

#### Scenario: Building the image
- **WHEN** a user runs `docker build -t peppify .` in the project root
- **THEN** the build succeeds without network errors and produces an image tagged `peppify`

#### Scenario: Running the image
- **WHEN** a user runs `docker run --rm -p 127.0.0.1:5000:5000 --env-file .env peppify`
- **THEN** the container starts gunicorn serving `webapp.app:app` on port 5000 inside the container, the port is reachable only from the host loopback, and HTTP requests to `http://127.0.0.1:5000/` receive a response from the webapp

#### Scenario: PDF rendering inside the container
- **WHEN** the running container receives a request that triggers PDF rendering (e.g. `POST /api/preview-pdf` with a valid invoice JSON)
- **THEN** WeasyPrint successfully renders the PDF without raising an error about missing Pango, Cairo, GLib, or fontconfig libraries

#### Scenario: No secrets baked into the image
- **WHEN** a user inspects the built image (e.g. `docker history peppify`, `docker run --rm peppify cat /app/.env`)
- **THEN** the image contains no `.env` file and no Peppyrus API keys; credentials are supplied at runtime via `--env-file` or compose `env_file`

#### Scenario: Reproducible dependency installation
- **WHEN** the image is built from an unchanged `pyproject.toml` and `uv.lock`
- **THEN** dependency installation uses `uv sync --frozen` so the resolved versions match the lockfile exactly, and the build fails loudly if the lockfile is inconsistent with `pyproject.toml`

### Requirement: docker-compose with safe default network binding

The project SHALL provide a `docker-compose.yml` that launches the image with a loopback-only host port mapping by default.

#### Scenario: Default binding is loopback only
- **WHEN** a user runs `docker compose up` using the shipped `docker-compose.yml` without modification
- **THEN** the webapp is reachable at `http://127.0.0.1:5000` from the host and is NOT reachable from other machines on the LAN or from the public internet

#### Scenario: Environment variables sourced from .env
- **WHEN** a user places their `PEPPYRUS_API_KEY`, `PEPPOL_SENDER_ID`, and `PEPPYRUS_BASE_URL` in a project-root `.env` file and runs `docker compose up`
- **THEN** those variables are passed into the container via `env_file: .env` and are visible to the webapp process

#### Scenario: Stopping the service
- **WHEN** a user runs `docker compose down`
- **THEN** the container stops and is removed, and no persistent volumes or named networks are left behind (the webapp is stateless; all user state is in the browser)

### Requirement: Documented run modes and security contract

The project README SHALL document three run modes — *Develop*, *Run with Python (production)*, *Run with Docker (production)* — and SHALL include a Security section that states the webapp has no authentication and MUST be bound to `127.0.0.1` or placed behind an authenticating reverse proxy if exposed beyond the local machine.

#### Scenario: Three run modes are documented
- **WHEN** a reader opens `README.md`
- **THEN** they find, in order, a labeled section for each of: (a) development using `uv run python webapp/app.py`, (b) production using gunicorn under `uv`, and (c) production using Docker / `docker compose up`, each with a copy-pasteable command

#### Scenario: Security note is present and unambiguous
- **WHEN** a reader opens `README.md`
- **THEN** they find a Security section (or equivalent callout) stating that the webapp has no built-in authentication, that the default binding is `127.0.0.1`, and that exposing the webapp on any non-loopback interface requires an authenticating reverse proxy in front of it

#### Scenario: CLAUDE.md mirrors the new run modes
- **WHEN** a contributor (or Claude Code session) reads `CLAUDE.md`
- **THEN** the Commands section lists the gunicorn and Docker run modes alongside the existing `uv run python webapp/app.py` dev command, and references the README Security note
