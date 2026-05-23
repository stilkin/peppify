# PDF Rendering

## Purpose

Renders a human-readable PDF of an invoice from the same JSON data structure that feeds the UBL generator. Used by the CLI (to embed in UBL), the webapp (for the `Preview PDF` button and for embed on send), and any future callers that need a visual representation. Backed by Jinja2 (`peppol_sender/templates/invoice.html`) + WeasyPrint, with a lazy WeasyPrint import so consumers that never call `render_pdf()` do not need Pango/Cairo installed at the OS level.

## Requirements

### Requirement: Render invoice PDF from JSON

The `render_pdf(invoice: dict) -> bytes` function MUST produce a PDF byte string from a valid invoice dict using a Jinja2 HTML template and WeasyPrint. The WeasyPrint import MUST be lazy (inside the function body) so that importing `peppol_sender.pdf` does not require the WeasyPrint system libraries.

#### Scenario: Valid invoice renders a non-empty PDF

- **WHEN** `render_pdf()` is called with a complete invoice dict (seller, buyer, at least one line, totals)
- **THEN** it returns bytes starting with the `%PDF-` header and at least a few kilobytes long

#### Scenario: Template source

- **WHEN** `render_pdf()` is called
- **THEN** it loads `peppol_sender/templates/invoice.html` via Jinja2 with the pre-computed view model as the rendering context, passes the rendered HTML through WeasyPrint, and returns the PDF bytes

#### Scenario: Minimal invoice still renders

- **WHEN** `render_pdf()` is called with an invoice that omits optional fields (no `due_date`, no `payment_means`, no `service_date` on lines)
- **THEN** the function still returns a valid PDF without raising

#### Scenario: Missing system libraries surface a clear error

- **WHEN** `render_pdf()` is invoked in an environment where WeasyPrint cannot load its system dependencies (Pango, Cairo, libgdk-pixbuf)
- **THEN** a `RuntimeError` is raised with an actionable message that names the missing libraries and points to the README install section — not a raw `ImportError` or low-level library stack trace

### Requirement: View model pre-computes all display values

The renderer MUST pre-compute a view model (all totals, per-line display values, formatted strings) in Python before handing off to the Jinja template. The template MUST remain logic-free beyond simple iteration and conditional blocks.

#### Scenario: Totals match the XML generator

- **WHEN** the view model is built from a given invoice dict
- **THEN** its `subtotal`, `tax_total`, and `grand_total` values equal the values that `generate_ubl()` would emit in `LegalMonetaryTotal/LineExtensionAmount`, `TaxTotal/TaxAmount`, and `LegalMonetaryTotal/PayableAmount` respectively, for the same input, including for mixed-rate invoices (same `(tax_category, tax_percent)` grouping and Decimal rounding)

#### Scenario: Line extension amount override

- **WHEN** a line item supplies an explicit `line_extension_amount` (e.g. for a discounted line)
- **THEN** the view model's `line_total` for that line uses the explicit value, not `quantity * unit_price`

#### Scenario: Payment means absent

- **WHEN** the invoice dict does not contain a `payment_means` key
- **THEN** the view model's `payment_means` field is `None` and the template omits the payment section entirely (no empty heading, no placeholder text)

### Requirement: PDF layout contains required sections

The rendered PDF MUST include the core invoice sections that a human reader expects: header metadata, seller and buyer parties, line items with per-line totals, a totals block, and a payment section when `payment_means` is set.

#### Scenario: All core sections render

- **WHEN** an invoice with all fields populated (including `payment_means`) is rendered
- **THEN** the PDF contains identifiable sections for invoice metadata (number, issue date, due date), a `From` seller block, a `Bill to` buyer block, a line items table with descriptions / quantities / unit prices / line totals, a totals block (subtotal, tax, grand total), and a payment section showing IBAN and BIC

#### Scenario: Payment section omitted when absent

- **WHEN** an invoice without a `payment_means` block is rendered
- **THEN** the payment section is omitted from the PDF (no empty heading, no placeholder text)

#### Scenario: Service date shown inline

- **WHEN** a line item has a `service_date`
- **THEN** the PDF shows the service date as a muted sublabel under the line description

### Requirement: EPC QR Code in payment section

When an invoice is a EUR credit transfer and carries a non-empty IBAN, the rendered PDF's payment section MUST include an EPC QR Code (EPC069-12 version 002) encoding the payee's IBAN, beneficiary name, grand total, and invoice reference, so that a human payer can scan the code with an EU banking app to pre-fill the credit transfer.

Payload construction MUST be implemented in a dedicated module (`peppol_sender/epc_qr.py`) exposing a pure `build_epc_payload(invoice: dict, grand_total: Decimal) -> str | None` function and a `render_qr_svg(payload: str) -> str` function. The payload is a line-delimited UTF-8 string with service tag `BCD`, version `002`, charset `1`, identification `SCT`, optional BIC, beneficiary name, IBAN (whitespace-stripped), amount formatted as `EUR<grand_total>` with two decimals, empty purpose, empty structured reference, and the invoice reference as unstructured remittance — 11 positional fields total, no trailing beneficiary-to-beneficiary line. The QR code MUST be rendered with error correction **level Q** (~25% redundancy).

#### Scenario: EUR credit-transfer invoice shows a QR

- **WHEN** an invoice with `currency: "EUR"` and a `payment_means` block containing a non-empty `iban` is rendered
- **THEN** the rendered PDF's payment section contains an inline SVG QR code, positioned to the right of the IBAN text block, with the caption `Scan with your banking app`

#### Scenario: Payload encodes the expected fields

- **WHEN** `build_epc_payload()` is called on an invoice with seller name `Acme BV`, IBAN `BE68539007547034`, BIC `GEBABEBB`, grand total `120.00`, and invoice number `INV-42`
- **THEN** the returned string's 11 line-delimited fields are `BCD`, `002`, `1`, `SCT`, `GEBABEBB`, `Acme BV`, `BE68539007547034`, `EUR120.00`, empty, empty, `INV-42`

#### Scenario: Non-EUR invoice skips the QR silently

- **WHEN** an invoice with `currency: "USD"` (or any currency other than EUR) and a valid IBAN is rendered
- **THEN** `build_epc_payload()` returns `None`, the view model's `epc_qr_svg` is `None`, and the PDF renders successfully with the existing text-only payment section (no empty container, no error)

#### Scenario: Missing IBAN skips the QR silently

- **WHEN** an invoice has no `payment_means` block, or a `payment_means` block without an `iban` field, or with an empty `iban`
- **THEN** `build_epc_payload()` returns `None` and the PDF renders with no QR code

#### Scenario: Non-credit-transfer payment code skips the QR silently

- **WHEN** an invoice's `payment_means.code` is set to a value outside the credit-transfer set (anything other than `"30"`, `"58"`, or absent)
- **THEN** `build_epc_payload()` returns `None` regardless of IBAN presence

#### Scenario: Payload truncates to fit the 331-byte EPC limit

- **WHEN** the assembled payload would exceed 331 bytes (combined across all fields)
- **THEN** `build_epc_payload()` first truncates the unstructured remittance (invoice reference) to fit; if the payload is still too long, it then truncates the beneficiary name; the returned payload is guaranteed to be ≤ 331 bytes encoded as UTF-8

#### Scenario: BIC is optional per EPC v2

- **WHEN** an invoice's `payment_means` contains an IBAN but no BIC
- **THEN** `build_epc_payload()` emits an empty BIC field (the spec's line 5) and the QR is still produced; v002 makes BIC optional

#### Scenario: QR color theme matches invoice palette

- **WHEN** `render_qr_svg()` is called with a valid payload
- **THEN** the returned SVG uses foreground `#4a2c1d` (warm brown matching `.section-label`) and background `#f7f2e8` (matching the `.payment` block's cream fill), with contrast ≥ 9:1 (WCAG AA comfortable for scanners)

#### Scenario: QR uses level Q error correction

- **WHEN** `render_qr_svg()` generates the SVG
- **THEN** the underlying segno call uses `error="q"` (~25% redundancy), making the QR resilient to light print degradation and leaving headroom for a future optional logo overlay without changing the payload

### Requirement: Translated PDF output per invoice language

The rendered PDF MUST use localized user-facing strings chosen by the invoice's `language` field. Supported languages are English (`en`), Dutch (`nl`), French (`fr`), and German (`de`). An invoice without a `language` field, or with an unrecognized code, renders in English.

Translation MUST be implemented in a dedicated pure module `peppol_sender/i18n.py` exposing `t(lang, key) -> str`, `unit_label(lang, code) -> str`, `format_amount(value: Decimal) -> str`, and `all_labels(lang) -> dict[str, str]`. The module MUST NOT introduce a runtime dependency; translations live in hand-rolled Python dicts. Lookups MUST fall back to English on missing keys, and to the raw key/code when even English is missing.

Monetary amounts in the PDF MUST be formatted in BeNeLux notation (`.` as thousands separator, `,` as decimal separator, always two decimal places) regardless of the selected language. The EPC QR payload is independent of this requirement and continues to emit ASCII `EUR<amount>` per EPC069-12.

Dates in the PDF MUST remain in ISO format (`YYYY-MM-DD`) regardless of the selected language.

#### Scenario: Dutch invoice shows Dutch labels

- **WHEN** an invoice with `language: "nl"` is rendered
- **THEN** the PDF's user-facing labels appear in Dutch (e.g. `Factuur`, `Omschrijving`, `Aantal`, `Eenheid`, `Prijs per eenheid`, `Totaal`, `Subtotaal`, `Btw`, `Te betalen`)

#### Scenario: English invoice unchanged (except number format)

- **WHEN** an invoice with `language: "en"` (or no `language` field) is rendered
- **THEN** labels appear in English (`Description`, `Qty`, `Unit`, etc.) and the PDF layout and content are functionally equivalent to the pre-translation version of the tool, except that monetary amounts switch to BeNeLux notation (e.g. `1.000,00` instead of `1000.00`)

#### Scenario: Unknown language falls back to English

- **WHEN** an invoice with `language: "zz"` (or any code not in the supported set) is rendered
- **THEN** the PDF renders using English labels and unit names without raising an error

#### Scenario: Unit codes render as translated names

- **WHEN** a line item uses unit code `HUR` and the invoice `language` is `nl`
- **THEN** the PDF's line-items table displays `uur` in the unit column, not `HUR`

#### Scenario: Unknown unit codes render as the raw code

- **WHEN** a line item uses a unit code not present in the unit-name dict (e.g. a code outside the `UNIT_CODES` set)
- **THEN** the PDF falls back to displaying the raw code so the output never breaks

#### Scenario: BeNeLux number formatting for all languages

- **WHEN** an invoice with any supported language renders a line total of `1234.56`
- **THEN** the PDF displays `1.234,56` (dot thousands, comma decimals) regardless of the language

#### Scenario: EPC QR payload stays ASCII

- **WHEN** an invoice with `language: "nl"` (or `fr`/`de`) is rendered and has a valid EUR credit-transfer payment means
- **THEN** the embedded EPC QR payload's amount field reads `EUR1234.56` (ASCII), not `EUR1.234,56` — the EPC spec is independent of PDF display language

#### Scenario: Translation dict structural invariant

- **WHEN** the test suite runs
- **THEN** every supported non-English language has the same label key set as English, asserted by a test in `tests/test_i18n.py`, so that no label can be added to the PDF template without translations being provided in every supported language
