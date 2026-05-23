## MODIFIED Requirements

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

## ADDED Requirements

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
