<p align="center">
  <img src="docs/peppify_logo.png" alt="Peppify" width="436" />
</p>

<p align="center">
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm_NC_1.0-blue" alt="License"></a>
  <a href="https://docs.astral.sh/ruff/"><img src="https://img.shields.io/badge/code_style-ruff-D7FF64?logo=ruff&logoColor=D7FF64" alt="Ruff"></a>
  <a href="https://mypy-lang.org/"><img src="https://img.shields.io/badge/type_checked-mypy-blue" alt="mypy"></a>
  <a href="https://ko-fi.com/stilkin"><img src="https://img.shields.io/badge/Ko--fi-F16061?logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</p>

---

A small tool for generating [EN-16931](https://peppol.org/what-is-peppol/peppol-document-specifications/) compliant UBL 2.1 invoices and sending them to the [PEPPOL](https://peppol.org/) e-invoicing network through the [Peppyrus](https://peppyrus.be/) Access Point API. Ships as both a **command-line tool** and a **single-page web UI**.

## What it does

- **Create** EN-16931 compliant UBL 2.1 XML from a simple JSON input (or a web form)
- **Render** a human-readable PDF "visual representation" of the invoice and embed it inside the UBL XML (PEPPOL BIS Billing 3.0 rule R008) so receivers' accountancy software has something to show end users. The PDF is translated per-invoice into one of four languages (**EN / NL / FR / DE**) with human-readable unit names and BeNeLux number formatting (`1.234,56`), and includes an **EPC QR Code** (SEPA / Girocode) on EUR credit-transfer invoices so the recipient can scan it with their banking app to pre-fill IBAN, beneficiary, amount, and reference
- **Validate** the XML against the official UBL 2.1 XSD schemas
- **Send** it to the PEPPOL network via Peppyrus, with automatic retry on transient failures
- **Fetch reports** (validation + transmission rules) for sent messages

Designed for a small business that needs to issue invoices themselves, not for enterprise volume. Supports VAT-exempt businesses (tax categories `E` / `O`) and emits structured payment details (`cac:PaymentMeans` with IBAN / BIC) so receivers' bookkeeping software can auto-reconcile — bank details live in the structured `payment_means` block, **not** in the free-form `payment_terms` note.

## Quick start (Docker)

The fastest way to run the web UI. The Docker image bundles Python and every native library, so you need nothing on the host but Docker itself.

```bash
cp .env.example .env          # then fill in your Peppyrus credentials (see Configuration)
docker compose up --build
# open http://127.0.0.1:5000
```

It binds to `127.0.0.1` and runs under gunicorn. For other ways to run, see [Run modes](#run-modes); to run the CLI or the web UI without Docker, see [Installation](#installation).

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PEPPYRUS_API_KEY` | Yes | Your Peppyrus API key (test and production are separate keys) |
| `PEPPOL_SENDER_ID` | Yes | Your PEPPOL participant ID (e.g. `0208:0674415660`) |
| `PEPPYRUS_BASE_URL` | No | API base URL. Defaults to the test endpoint `https://api.test.peppyrus.be/v1`. Set to `https://api.peppyrus.be/v1` for production. |

Your API key is read once at process start and stays server-side. The web UI never exposes it to the browser.

## Run modes

The web UI can be served three ways — all bind to `127.0.0.1` by default. **Docker is the recommended path** (see [Quick start](#quick-start-docker)). Full detail and a reverse-proxy note are in [`docs/deployment.md`](docs/deployment.md).

**Development** — Flask dev server (prints a Werkzeug warning; fine for local iteration):

```bash
uv run python webapp/app.py
```

**Production (Python)** — gunicorn, no dev-server warning:

```bash
uv sync --group prod
uv run gunicorn webapp.app:app -b 127.0.0.1:5000 --workers 2
```

**Production (Docker)** — recommended:

```bash
docker compose up --build
```

## Installation

Running the CLI or the web UI **without** Docker needs Python 3.10+, [`uv`](https://docs.astral.sh/uv/), and WeasyPrint's native libraries (Pango, Cairo, libgdk-pixbuf) at the OS level. See [`docs/installation.md`](docs/installation.md) for the per-platform setup. (The Docker image above needs none of this.)

## Using the tool

Peppify works as a command-line tool and a single-page web form. See [`docs/usage.md`](docs/usage.md) for the CLI commands (`create` / `validate` / `send` / `report`) and a tour of the web UI, and [`docs/invoice-json-schema.md`](docs/invoice-json-schema.md) for the full JSON input format.

## Security

The webapp has **no authentication by default**. Anyone who can reach the HTTP port can create, validate, and send invoices signed with your Peppyrus API key. All run modes bind to `127.0.0.1` out of the box, so by default it is only reachable from the machine it runs on.

**Optional login gate.** Setting `APP_PASSWORD_HASH` in `.env` enables a single-password login gate over the whole web UI. With the gate enabled you can bind to a non-loopback address (`BIND_HOST=0.0.0.0`) for **single-tenant LAN use** — e.g. reaching a headless workstation from another device. Generate the hash (store the hash, never the plaintext) with:

```bash
uv run python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your-password'))"
```

The bind address is configurable via `BIND_HOST` / `BIND_PORT` (default `127.0.0.1:5000`); these apply to the dev server, bare-metal gunicorn (via `gunicorn.conf.py`), and the Docker host-port mapping. Multiple deployments can coexist on one host with distinct `BIND_PORT` and `COMPOSE_PROJECT_NAME` values. If you bind to a non-loopback interface **without** setting `APP_PASSWORD_HASH`, the app logs a prominent startup warning but still starts.

**Plain-HTTP caveat.** Over plain HTTP the login password and session cookie travel in **cleartext**. The gate is suitable for a *trusted* LAN; on an untrusted network put a **TLS-terminating reverse proxy** (Caddy, Traefik, nginx) in front, or set `SESSION_COOKIE_SECURE=true` once HTTPS is in place. Without the gate, any non-loopback exposure still **requires** an authenticating reverse proxy.

## Limitations

- **No local Schematron / EN-16931 business rule validation.** The tool runs structural checks and XSD validation locally, but Schematron rules (e.g. `BR-CL-14`, `BR-CL-23`, `BR-CO-26`) are caught server-side by Peppyrus after transmission. You can retrieve the report with `cli.py report --id ...` or see the result inline in the web UI.
- **Credit notes are CLI-only.** `cli.py create --type credit-note` and `cli.py send` produce and transmit compliant UBL 2.1 Credit Notes (EN-16931 / PEPPOL BIS Billing 3.0). The web UI does not yet offer a credit-note form — use the CLI until the follow-up change lands.
- **Debit notes and other UBL document types** are not supported.
- **API retry is limited** to 3 attempts on 5xx errors with exponential backoff; there's no persistent retry queue.
- **Single-user assumption** — the web UI has no authentication. The API key in `.env` belongs to one organisation and localStorage state is per-browser.

## Contributing

See [`docs/development.md`](docs/development.md) for project structure, the tech stack, linting, testing, and dependency management.

## Support

If you enjoy Peppify and want to support its development, consider buying me a drink:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/stilkin)

Your support helps me continue developing and improving Peppify!

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
