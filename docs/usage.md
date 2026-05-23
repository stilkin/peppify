# Usage

Peppify ships as a **command-line tool** and a **single-page web UI**. This guide covers both. For
the JSON invoice format, see [`invoice-json-schema.md`](invoice-json-schema.md). To get the app
running, see [Installation](installation.md) (CLI / local) and [Deployment](deployment.md) (web UI).

## Command-line

Prefix these with `uv run` (which transparently uses `.venv`), or activate the venv first with
`. .venv/bin/activate` and drop the prefix.

```bash
# 1. Generate UBL XML from a JSON invoice (embeds a rendered PDF by default)
uv run python cli.py create --input sample_invoice.json --out invoice.xml

# 1b. XML-only output (skip the embedded PDF)
uv run python cli.py create --input sample_invoice.json --out invoice.xml --no-pdf

# 1c. Override the PDF language (en / nl / fr / de — falls back to invoice JSON or 'en')
uv run python cli.py create --input sample_invoice.json --out invoice.xml --language nl

# 1d. Generate a UBL Credit Note instead of an Invoice
uv run python cli.py create --type credit-note --input credit_note.json --out cn.xml --no-pdf

# 2. Validate it — works on both invoices and credit notes (document type auto-detected)
uv run python cli.py validate --file invoice.xml

# 3. Send it to a recipient on the PEPPOL network — document type auto-detected from the XML root
uv run python cli.py send --file invoice.xml --recipient 0208:be0674415660

# 4. Fetch the validation/transmission report for a sent message
uv run python cli.py report --id <MESSAGE_ID>
```

The `send` command runs validation first and refuses to transmit if any FATAL rules are triggered.
Idempotent API calls (report, lookup) retry automatically on 5xx errors with exponential backoff;
the actual `POST /message` is **not** retried to avoid duplicate transmissions.

See [`invoice-json-schema.md`](invoice-json-schema.md) for the full JSON input format.

## Web UI

Single-page invoice form with:

- **Seller auto-fill** from Peppyrus `/organization/info`
- **Buyer lookup** by VAT number, enriched with PEPPOL directory data
- **Recent customers** and **line item templates** stored in localStorage (overwrite-on-update), with a small `×` next to the Recent dropdown to delete a single saved customer
- **Line items** with optional **per-line service date** (UBL `cac:InvoicePeriod`)
- **Live totals** as you type; strict unit and VAT category dropdowns
- **Auto-incrementing invoice number**
- **New invoice** button (`＋`) in the header — wipes the current draft and starts fresh while keeping all saved state; silent when the previous draft was already sent, confirms otherwise
- **PDF language selector** next to the Currency field — pick EN / NL / FR / DE per invoice. The chosen language is saved on the customer record so the next invoice to the same customer auto-fills it, and a `Default PDF language` in Settings is the fallback for new customers
- **Settings modal** for defaults (currency, default PDF language, due-date offset, payment terms, tax category, **embed PDF on/off**), your **bank account** (IBAN, BIC, account holder — emitted as structured `cac:PaymentMeans` on every invoice to satisfy PEPPOL rule BR-50), and your personal contact info (name, email, phone). A **Danger zone** at the bottom offers a one-click factory reset that wipes every Peppify key from localStorage
- **Preview PDF** button — see the human-readable representation that will be embedded in the invoice before you send it
- **Guarded Send** — the `Send invoice` button stays disabled until you click `Validate` and no FATAL rules remain; rules are shown inline and block transmission either way
- **Recipient derived from the buyer** — the outgoing PEPPOL `recipient` is built on the fly from the buyer's `Scheme` + `Endpoint ID` fields, so you only enter the identifier once

All persistent state lives in the browser. The Flask server is stateless beyond the environment variables.

> **Credit notes are CLI-only.** The web UI does not yet offer a credit-note form — use
> `cli.py create --type credit-note` (see above) until the follow-up change lands.
