# deployment Specification

## Purpose

How the webapp is packaged and launched for production: gunicorn as an optional
`prod` dependency, a Dockerfile bundling Python + pinned deps + WeasyPrint's native
libraries, and a docker-compose file with a loopback-only default binding. Also
covers the security contract — the app has no authentication, so it must stay bound
to `127.0.0.1` or sit behind an authenticating reverse proxy — and the documented
*Develop* / *Production (Python)* / *Production (Docker)* run modes.
## Requirements
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

The project README SHALL document three run modes — *Develop*, *Run with Python (production)*, *Run with Docker (production)* — and SHALL include a Security section that states: the webapp has **no authentication by default**; the default network binding is `127.0.0.1`; an **optional single-password login gate** (enabled by setting `APP_PASSWORD_HASH`) is the sanctioned way to expose the webapp on a non-loopback interface for single-tenant LAN use; and that without the gate, exposing the webapp beyond loopback requires an authenticating reverse proxy. The Security section SHALL also state the plain-HTTP caveat: over plain HTTP the login password and session cookie travel in cleartext, so a TLS-terminating reverse proxy is recommended on untrusted networks.

#### Scenario: Three run modes are documented

- **WHEN** a reader opens `README.md`
- **THEN** they find, in order, a labeled section for each of: (a) development using `uv run python webapp/app.py`, (b) production using gunicorn under `uv`, and (c) production using Docker / `docker compose up`, each with a copy-pasteable command

#### Scenario: Security note is present and unambiguous

- **WHEN** a reader opens `README.md`
- **THEN** they find a Security section (or equivalent callout) stating that the webapp has no built-in authentication by default, that the default binding is `127.0.0.1`, that setting `APP_PASSWORD_HASH` enables an optional login gate which permits binding to a non-loopback interface for single-tenant use, and that without the gate any non-loopback exposure requires an authenticating reverse proxy

#### Scenario: Plain-HTTP caveat is documented

- **WHEN** a reader opens the README Security section
- **THEN** it notes that over plain HTTP the login password and session cookie are sent in cleartext (so the gate is suitable for a trusted LAN but a TLS-terminating reverse proxy is recommended for untrusted networks)

#### Scenario: CLAUDE.md mirrors the run modes and gate

- **WHEN** a contributor (or Claude Code session) reads `CLAUDE.md`
- **THEN** the Commands section lists the gunicorn and Docker run modes alongside the existing `uv run python webapp/app.py` dev command, references the README Security note, and mentions the optional login gate and the `BIND_HOST` / `BIND_PORT` / `APP_PASSWORD_HASH` environment variables

### Requirement: Configurable network binding

The webapp's host-facing bind address SHALL be configurable via the `BIND_HOST` and `BIND_PORT` environment variables, defaulting to `127.0.0.1` and `5000`. The default SHALL remain loopback-only so that an unconfigured deployment is not exposed beyond the local machine. The configuration SHALL apply to the development server, to bare-metal gunicorn (via a `gunicorn.conf.py` that reads the environment), and to the Docker host-port mapping in `docker-compose.yml` (via environment interpolation). Multiple single-tenant deployments SHALL be able to coexist on one host by using distinct `BIND_PORT` and `COMPOSE_PROJECT_NAME` values.

#### Scenario: Default binding remains loopback-only

- **WHEN** a user starts the webapp without setting `BIND_HOST` or `BIND_PORT`
- **THEN** the app binds to `127.0.0.1:5000` and is not reachable from other machines on the LAN

#### Scenario: Override to a LAN-reachable address

- **WHEN** a user sets `BIND_HOST=0.0.0.0` (and optionally `BIND_PORT`) and starts the webapp
- **THEN** the app binds to that address/port and is reachable from other machines on the LAN

#### Scenario: gunicorn honors the environment

- **WHEN** a user runs `uv run gunicorn webapp.app:app` (with no `-b` flag) and the project ships `gunicorn.conf.py`
- **THEN** gunicorn binds to `BIND_HOST:BIND_PORT` from the environment, defaulting to `127.0.0.1:5000`

#### Scenario: Docker host mapping is configurable

- **WHEN** a user sets `BIND_HOST` / `BIND_PORT` in `.env` and runs `docker compose up`
- **THEN** the host-side port mapping uses those values (defaulting to `127.0.0.1:5000`) while the container continues to serve on its internal port `5000`

#### Scenario: Two deployments coexist on one host

- **WHEN** a user runs two deployments from separate directories, each with its own `.env` setting a distinct `BIND_PORT` and `COMPOSE_PROJECT_NAME`
- **THEN** both come up without port, container-name, volume, or network collisions

