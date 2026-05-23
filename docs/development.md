# Development

## Tech stack

| Layer | Stack |
|---|---|
| Language | Python 3.10+ |
| Package manager | [`uv`](https://docs.astral.sh/uv/) (venv + pip + lockfile in one tool) |
| HTTP client | `requests` + `urllib3.Retry` adapter |
| Configuration | `python-dotenv` |
| XSD validation | `xmlschema` (pure Python) with a cached schema instance |
| PDF rendering | [WeasyPrint](https://weasyprint.org/) + Jinja2 (HTML template → PDF) |
| Web UI backend | Flask 3 |
| Web UI frontend | Jinja2 templates + vanilla JS + CSS (no build step, no framework) |
| State (web UI) | browser localStorage — no server-side database |
| Bundled schemas | Official OASIS UBL 2.1 XSD files in `schemas/xsd/` |

PEPPOL BIS Billing 3.0 process type and document type strings are sourced from the Peppyrus OpenAPI spec in [`openapi_peppyrus.json`](openapi_peppyrus.json).

## Project structure

```text
cli.py                     CLI entry point (create, validate, send, report)
peppol_sender/
  ubl.py                   EN-16931 compliant UBL 2.1 XML generation
  pdf.py                   Jinja2 + WeasyPrint invoice PDF renderer
  validator.py             Structural + XSD validation, local BR-50 + LOCAL-F001 rules
  api.py                   Peppyrus API client with retry
  templates/invoice.html   PDF template used by pdf.py
webapp/
  app.py                   Flask app and routes
  templates/index.html     Single-page invoice form
  static/                  CSS + vanilla JS (localStorage-backed state)
  static/fonts/            Self-hosted Fraunces / Spectral / JetBrains Mono
  static/fonts.css         Generated @font-face rules for the bundled fonts
tests/                     pytest suite (unit + Flask test client)
schemas/xsd/               Official UBL 2.1 XSD schemas (OASIS)
docs/
  installation.md          Local install (uv, WeasyPrint native libs)
  deployment.md            Run modes (Docker, gunicorn, dev server)
  usage.md                 CLI + web UI guide
  invoice-json-schema.md   Full JSON input reference
  openapi_peppyrus.json    Peppyrus OpenAPI 3.0 specification
openspec/                  Spec-driven change history (archived)
```

## Lint, format, and test

```bash
uv run ruff check .                  # lint
uv run ruff format .                 # format
uv run mypy .                        # type check
uv run pytest                        # run the test suite
uv run pytest -k test_name           # run a single test by name
uv run pytest tests/test_ubl.py      # run a single test file
uv run pre-commit run --all-files    # run all pre-commit hooks
```

## Dependencies

Dependencies are declared in `pyproject.toml` under `[project]` (runtime) and `[dependency-groups]` (dev). `uv.lock` pins exact versions for reproducible installs. Update the lock with `uv lock --upgrade` or pick a single package with `uv lock --upgrade-package <name>`.

Pre-commit hooks (Ruff + MyPy) are installed via `uv run pre-commit install`. Coverage is enforced at 80% via `--cov-fail-under=80` in `pyproject.toml` (currently ~99%).
