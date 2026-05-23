# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Peppify is a minimal Python scaffold for generating UBL 2.1 invoices from JSON, validating them, and sending them to the Peppyrus Access Point API (PEPPOL-compliant e-invoicing service).

## Commands

Dependencies are managed with `uv` (declared in `pyproject.toml`, pinned in
`uv.lock`). Prefix every command with `uv run` or activate the venv first
(`. .venv/bin/activate`).

```bash
# Setup
uv sync                               # creates .venv, installs runtime + dev deps

# Copy and fill in environment variables
cp .env.example .env

# Generate UBL XML from invoice JSON (embeds a rendered PDF by default)
uv run python cli.py create --input sample_invoice.json --out invoice.xml

# XML-only output (skip the embedded PDF)
uv run python cli.py create --input sample_invoice.json --out invoice.xml --no-pdf

# Generate a UBL Credit Note (EN-16931 / BIS Billing 3.0)
uv run python cli.py create --type credit-note --input credit_note.json --out cn.xml --no-pdf

# Validate an invoice or credit-note XML (document type auto-detected from root element)
uv run python cli.py validate --file invoice.xml

# Send invoice or credit note to Peppyrus API (document type auto-detected from root element)
uv run python cli.py send --file invoice.xml --recipient <RECIPIENT_ID>

# Fetch validation/transmission report for a sent message
uv run python cli.py report --id <MESSAGE_ID>

# Run the web UI (http://127.0.0.1:5000)
uv run python webapp/app.py                                      # dev server (prints Werkzeug warning)
uv run gunicorn webapp.app:app --workers 2                       # prod; binds BIND_HOST:BIND_PORT via gunicorn.conf.py; needs `uv sync --group prod`
docker compose up --build                                        # prod, containerized (see README "Security")
# Optional login gate: set APP_PASSWORD_HASH in .env to require a password; then BIND_HOST=0.0.0.0
# exposes the UI on the LAN for single-tenant use (see README "Security"). Bind via BIND_HOST/BIND_PORT.

# Lint and format
uv run ruff check .          # lint (add --fix for auto-fix)
uv run ruff format .         # format

# Type checking
uv run mypy .

# Tests
uv run pytest                    # run all tests
uv run pytest -k test_name       # run a single test by name
uv run pytest tests/test_ubl.py  # run a single test file

# Pre-commit hooks (ruff + mypy, installed via `uv run pre-commit install`)
uv run pre-commit run --all-files
```

## Architecture

The project follows a functional pipeline: **JSON → UBL XML → Validation → API transmission**.

- **`cli.py`** — CLI entry point with subcommands: `create` (takes `--type {invoice,credit-note}`), `validate`, `send` (auto-detects document type from the XML root), `report`. Imports `INVOICE_DOCUMENT_TYPE`, `CREDIT_NOTE_DOCUMENT_TYPE`, and `PROCESS_TYPE` constants from `peppol_sender.api`; `_detect_document_type()` maps an XML root to the right Peppyrus document-type string.
- **`peppol_sender/ubl.py`** — exposes two public entry points: `generate_ubl(invoice, *, embed_pdf=False) -> bytes` for invoices and `generate_credit_note(data, *, embed_pdf=False) -> bytes` for credit notes. Both are thin wrappers around a shared private `_build_document()` helper that is parameterised on the default namespace, root element tag, type-code element + default + JSON key, line-adder callback, and `supports_due_date` flag (Invoice schema allows `cbc:DueDate`; CreditNote schema does not). Line items are rendered by a shared `_add_document_line(parent, line, currency, *, line_tag, qty_tag)` helper wrapped by `_add_invoice_line` (`InvoiceLine` / `InvoicedQuantity`) and `_add_credit_note_line` (`CreditNoteLine` / `CreditedQuantity`). Party, tax-total, payment-means, and legal-monetary-total helpers are document-type agnostic and reused as-is. Optional top-level `billing_reference` (BT-25 / BT-26) is emitted by `_add_billing_reference` for either document type when the input dict provides an `{"id": str, "issue_date": str}` block, positioned before `AdditionalDocumentReference` per UBL xs:sequence. When `embed_pdf=True`, a PDF is rendered via `peppol_sender.pdf` and embedded as a `cac:AdditionalDocumentReference` (PEPPOL BIS Billing 3.0 R008 visual representation). Library default is `embed_pdf=False` so the existing test suite stays fast and byte-stable; CLI `create` and webapp `/api/validate`+`/api/send` pass `embed_pdf=True` explicitly. Byte-identity of the invoice output is protected by the reference fixture at `tests/fixtures/reference_invoice.xml` and the `test_generate_ubl_output_byte_identical_to_reference` guard — do not regenerate the fixture casually.
- **`peppol_sender/pdf.py`** — `render_pdf(invoice: dict) -> bytes` renders a human-readable PDF using Jinja2 (`peppol_sender/templates/invoice.html`) + WeasyPrint. `_build_view_model()` pre-computes all display values (totals use the same tax-group Decimal rounding as `ubl.py` so the PDF and XML totals are cross-checkable via the `_parse_benelux` helper in `tests/test_pdf.py`), reads `invoice["language"]` to build a translated `labels` dict via `i18n.all_labels()`, replaces raw UN/ECE unit codes with translated names via `i18n.unit_label()`, and formats all monetary strings in BeNeLux notation (`1.234,56`) via `i18n.format_amount()`. Also attaches an EPC QR SVG via `epc_qr.build_epc_payload` + `render_qr_svg` when the invoice is a EUR credit transfer with an IBAN. WeasyPrint is lazy-imported so Pango/Cairo are only required at render time.
- **`peppol_sender/i18n.py`** — pure module with hand-rolled translation dicts for four languages (EN / NL / FR / DE) covering PDF labels and UN/ECE unit codes, plus `t(lang, key)`, `unit_label(lang, code)`, `all_labels(lang)`, and `format_amount(value)`. Every lookup has a two-level fallback (language → English → raw key/code) so the PDF never breaks on missing data. A structural test in `tests/test_i18n.py` enforces that all non-EN dicts have the same key set as EN — adding a new label to English without translating it to the others fails CI. The UI, validator messages, and CLI output remain English by design; only the PDF is translated.
- **`peppol_sender/epc_qr.py`** — pure module that builds an EPC069-12 v002 payload (SEPA QR / Girocode) from an invoice dict and renders it as an inline SVG via `segno` (level-Q error correction, themed colors, CSS-sizable). Gates on currency, IBAN, and payment-means code; silently returns `None` for ineligible invoices. Truncates beneficiary name / reference if the payload would exceed the 331-byte EPC hard limit.
- **`peppol_sender/validator.py`** — document-type aware structural and XSD validation. `validate_basic()` and `validate_xsd()` both dispatch on the XML root element: `<Invoice>` → `UBL-Invoice-2.1.xsd` + invoice required-element list; `<CreditNote>` → `UBL-CreditNote-2.1.xsd` + credit-note list. Unknown roots return a single `LOCAL-UNKNOWN-ROOT` FATAL rule without running the other checks. Required-element dispatch lives in `_required_for(root_tag)`; XSD caching in `_schema_for(root_tag)` (decorated with `@functools.cache` so each schema file is parsed at most once per process). Also applies BR-50 (IBAN required for credit transfer) and LOCAL-F001 (date format) rules — both are document-type agnostic and parameterise location strings by the detected root tag so error reports read `/*:CreditNote/...` when appropriate.
- **`peppol_sender/api.py`** — Peppyrus API client. Exposes three module-level constants as the single source of truth for BIS Billing 3.0 identifiers: `INVOICE_DOCUMENT_TYPE`, `CREDIT_NOTE_DOCUMENT_TYPE`, and `PROCESS_TYPE`. Idempotent GET helpers retry transient 5xx failures (3 attempts, exponential backoff via `urllib3.Retry`); `send_message()` POSTs are intentionally **not** retried to avoid duplicate PEPPOL transmissions (POST is not in `urllib3`'s default `allowed_methods`). Functions: `package_message()`, `send_message()`, `get_report()`, `get_org_info()`, `lookup_participant()`, `search_business_card()`
- **`webapp/`** — Flask single-page invoice form. `app.py` exposes `/`, `/api/org-info`, `/api/lookup`, `/api/business-card`, `/api/validate`, `/api/send`, `/api/preview-pdf`, plus `/login` + `/logout` when the optional login gate is enabled. Templates in `templates/` (`index.html`, `login.html`), vanilla JS + CSS in `static/`. The gate is opt-in: set `APP_PASSWORD_HASH` and a `before_request` hook requires an authenticated session on every route except login/logout/static (page routes redirect to `/login`, `/api/*` returns 401); with no hash set, behavior is unchanged. When gated, `POST /api/send` also requires a per-session CSRF token echoed via the `X-CSRFToken` header (the SPA reads it from the `<meta name="csrf-token">` tag); other endpoints rely on `SameSite=Lax`. `warn_if_exposed()` logs a startup warning on a non-loopback `BIND_HOST` with no gate. State (recent customers, line templates, defaults, last invoice number, seller bank account, seller contact, embed-PDF preference) lives in browser localStorage under the `peppol_*` keys defined in `LS_KEYS` at the top of `app.js`. The PEPPOL recipient is derived at send time from the buyer's `endpoint_scheme` + `endpoint_id` — there is no separate `#recipient` input in the form. Header has two `.icon-btn` buttons: `＋` (New invoice — clears the current draft, keeps all stored state, confirms only when the draft has unsent edits via the `invoiceSent` module flag) and `⚙` (Settings modal). The Recent-customers dropdown has an inline `×` for single-entry deletion. The Settings modal contains a `Danger zone` section below Save/Cancel with a factory-reset button that wipes every `LS_KEYS` value and reloads the page.

## Key Design Decisions

- Each module exports a small number of public functions; no classes or complex abstractions. `ubl.py` is the one exception — it has two public entry points (`generate_ubl`, `generate_credit_note`) sharing a private `_build_document` helper
- UBL generator uses `cbc:`/`cac:` namespaces with strict element ordering (XSD `xs:sequence`). Default namespace is re-registered per call (Invoice-2 vs CreditNote-2) — safe because gunicorn sync workers handle one request per process at a time
- Tax calculation groups line items by `(tax_category, tax_percent)`; supports VAT-exempt (E/O)
- `validate_basic()` dispatches on the XML root tag: invoices need `InvoiceTypeCode` + `InvoiceLine`, credit notes need `CreditNoteTypeCode` + `CreditNoteLine`, and both need the 9 shared elements (`CustomizationID`, `ProfileID`, `ID`, `IssueDate`, `DocumentCurrencyCode`, `AccountingSupplierParty`, `AccountingCustomerParty`, `TaxTotal`, `LegalMonetaryTotal`). Unknown roots fail fast with `LOCAL-UNKNOWN-ROOT`
- Validation returns structured rule dicts with `id`, `type` (FATAL/WARNING), `location`, `message`
- CLI refuses to send if any FATAL validation rules are triggered; `cli.py send` auto-detects the Peppyrus document-type string from the XML root
- UBL XML is base64-encoded inside JSON for API transmission
- Configuration via `.env` files (PEPPYRUS_API_KEY, PEPPOL_SENDER_ID, PEPPYRUS_BASE_URL; optional webapp vars: APP_PASSWORD_HASH enables the login gate, SECRET_KEY signs sessions, BIND_HOST/BIND_PORT set the bind address, SESSION_COOKIE_SECURE for TLS)

## Reference

- Peppyrus OpenAPI spec: `docs/openapi_peppyrus.json`
- Invoice JSON schema reference: `docs/invoice-json-schema.md`
- Test endpoint: `https://api.test.peppyrus.be/v1`
