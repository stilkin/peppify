# Invoice JSON schema

Reference for the JSON input accepted by `cli.py create` and the webapp's
`/api/validate` and `/api/send` routes.

See [`sample_invoice.json`](../sample_invoice.json) for a complete, working example.

## Example

```json
{
  "invoice_number": "INV-2025-001",
  "issue_date": "2025-11-29",
  "due_date": "2025-12-29",
  "invoice_type_code": "380",
  "currency": "EUR",
  "payment_terms": "Net 21 days",
  "payment_means": {
    "code": "30",
    "iban": "BE68539007547034",
    "bic": "BBRUBEBB",
    "account_name": "ACME Consulting BV",
    "payment_id": "INV-2025-001"
  },
  "seller": {
    "name": "ACME Consulting",
    "registration_name": "ACME Consulting BV",
    "endpoint_id": "0123456789",
    "endpoint_scheme": "0208",
    "vat": "BE0123456789",
    "legal_id": "0123456789",
    "legal_id_scheme": "0208",
    "country": "BE",
    "street": "Main Street 1",
    "city": "Brussels",
    "postal_code": "1000",
    "contact_name": "Jane Doe",
    "contact_email": "jane@example.be",
    "contact_phone": "+32 14 00 00 00"
  },
  "buyer": {
    "name": "Client Corp",
    "registration_name": "Client Corp BV",
    "endpoint_id": "987654321",
    "endpoint_scheme": "0208",
    "vat": "NL987654321B01",
    "legal_id": "987654321",
    "country": "NL",
    "street": "Client Ave 42",
    "city": "Amsterdam",
    "postal_code": "1011"
  },
  "lines": [
    {
      "id": "1",
      "description": "Consulting service",
      "quantity": 1,
      "unit": "HUR",
      "unit_price": 1000.00,
      "tax_category": "E",
      "tax_percent": 0,
      "service_date": "2025-11-20"
    }
  ]
}
```

## Top-level fields

| Field | Type | Description |
|---|---|---|
| `invoice_number` | string | Invoice identifier |
| `issue_date` | string | ISO 8601 date (YYYY-MM-DD); defaults to today |
| `due_date` | string | Payment due date (optional) |
| `invoice_type_code` | string | UBL type code (default: `380` = commercial invoice) |
| `currency` | string | ISO 4217 currency code (e.g. `EUR`) |
| `language` | string | PDF display language (optional): `en`, `nl`, `fr`, or `de`. Default `en`. Affects the rendered PDF only — translated labels and human-readable unit names. The underlying UBL XML and the EPC QR payload are unaffected. Unknown codes fall back to English |
| `payment_terms` | string | Free-text payment terms; multi-line supported. Do **not** put the IBAN here — use `payment_means` |
| `payment_means` | object | Structured bank payment details (optional). See [Payment means](#payment-means) |

## Party fields (`seller` and `buyer`)

| Field | Type | UBL / EN-16931 | Description |
|---|---|---|---|
| `name` | string | BT-28 / BT-45 | Trading name |
| `registration_name` | string | BT-27 / BT-44 | Legal registration name (defaults to `name`) |
| `endpoint_id` | string | BT-34 / BT-49 | Electronic address (e.g. enterprise number, no country prefix) |
| `endpoint_scheme` | string | `@schemeID` | Endpoint scheme ID (default: `0208` for Belgian CBE) |
| `vat` | string | BT-31 / BT-48 | VAT identifier (e.g. `BE0674415660`) |
| `legal_id` | string | BT-30 / BT-47 | Legal registration identifier (usually the enterprise number) |
| `legal_id_scheme` | string | `@schemeID` | Optional scheme ID for `legal_id` (e.g. `0208` for Belgium) |
| `country` | string | BT-40 / BT-55 | ISO 3166-1 alpha-2 country code (uppercase) |
| `street` | string | BT-35 / BT-50 | Street address (optional) |
| `city` | string | BT-37 / BT-52 | City (optional) |
| `postal_code` | string | BT-38 / BT-53 | Postal code (optional) |
| `contact_name` | string | BT-41 / BT-56 | Contact person name (optional) |
| `contact_email` | string | BT-43 / BT-58 | Contact email (optional) |
| `contact_phone` | string | BT-42 / BT-57 | Contact phone (optional) |

## Line item fields (`lines[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | Line item identifier |
| `description` | string | Item description |
| `quantity` | number | Quantity |
| `unit` | string | UN/CEFACT Rec. 20 unit code (default: `EA`) — e.g. `HUR`, `DAY`, `KGM`, `LTR` |
| `unit_price` | number | Price per unit |
| `line_extension_amount` | number | Optional; defaults to `quantity * unit_price` |
| `tax_category` | string | VAT category: `S`, `E`, `O`, `Z`, `AE`, `K`, `G`, `L`, `M` |
| `tax_percent` | number | VAT rate (use `0` for exempt categories) |
| `service_date` | string | Optional service date (BT-134/135) — emitted as a single-day `InvoicePeriod` |
| `service_start_date` | string | Optional period start date (alternative to `service_date`) |
| `service_end_date` | string | Optional period end date |

## VAT category codes

| Code | Meaning |
|---|---|
| `S` | Standard rate |
| `E` | Exempt from VAT |
| `O` | Not subject to VAT |
| `Z` | Zero rated |
| `AE` | Reverse charge |
| `K` | Intra-EU supply |
| `G` | Export |
| `L` | Canary Islands (IGIC) |
| `M` | Ceuta / Melilla (IPSI) |

For VAT-exempt small businesses, use `E` (or `O`) with `tax_percent: 0`. The
generator automatically adds a `TaxExemptionReason` element when either of
these categories is used.

## Payment means

Structured bank account details emitted as `cac:PaymentMeans` (BT-81..86).
Required for any invoice intended to be paid by credit transfer: PEPPOL rule
**BR-50** mandates an IBAN when `PaymentMeansCode` is `30` or `58`. Put the IBAN
here, not in `payment_terms`.

| Field | Type | UBL / EN-16931 | Description |
|---|---|---|---|
| `code` | string | BT-81 | UNCL4461 payment means code; defaults to `30` (credit transfer). `58` = SEPA credit transfer |
| `iban` | string | BT-84 | IBAN of the payee account |
| `bic` | string | BT-86 | BIC / SWIFT code of the payee account (optional) |
| `account_name` | string | BT-85 | Account holder name (defaults to `seller.name`) |
| `payment_id` | string | BT-83 | Structured remittance reference (defaults to `invoice_number`) |

If `payment_means` is omitted entirely, no `cac:PaymentMeans` element is emitted
and BR-50 does not fire — use this for invoices paid by other means (cash,
direct debit) where structured bank details are not relevant.

## Credit notes

The same JSON schema also feeds `generate_credit_note()` and `cli.py create --type credit-note`. A credit note is structurally almost identical to an invoice under PEPPOL BIS Billing 3.0 — the same seller, buyer, payment_means, and lines fields apply unchanged. The differences:

| Invoice field | Credit note equivalent |
|---|---|
| `invoice_type_code` (default `380`) | `credit_note_type_code` (default `381`, UN/CEFACT commercial credit note) |
| `due_date` (optional) | **Not allowed** — UBL CreditNote-2.1 schema has no `DueDate` element. Payment timing for a credit note goes under `payment_means` if needed. |
| Root element `<Invoice>` / line element `<cac:InvoiceLine>` / `<cbc:InvoicedQuantity>` | `<CreditNote>` / `<cac:CreditNoteLine>` / `<cbc:CreditedQuantity>` — handled automatically by `generate_credit_note()` |

In addition, credit notes **strongly should** carry an optional top-level `billing_reference` block identifying the invoice being corrected:

```json
"billing_reference": {
    "id": "INV-2025-001",
    "issue_date": "2025-01-15"
}
```

This becomes `cac:BillingReference/cac:InvoiceDocumentReference` in the UBL output (BT-25 / BT-26 on EN-16931). PEPPOL transmission does not strictly require it, but downstream accounting systems expect a credit note to name the document it corrects. The same field is also accepted on regular invoices for corrective-invoice series use cases; in both cases it is optional and omitted from the XML when absent.

A full `sample_credit_note.json` can be derived from `sample_invoice.json` by removing `invoice_type_code` and `due_date`, adding `credit_note_type_code` and `billing_reference`, and changing `invoice_number` to a `CN-...` prefix.

## PDF rendering

The same invoice JSON feeds the PDF renderer (`peppol_sender.pdf.render_pdf`) as well as the UBL generator. The CLI `create` subcommand and the webapp's `/api/validate`/`/api/send` routes embed the rendered PDF inside the UBL XML as a `cac:AdditionalDocumentReference` (PEPPOL BIS Billing 3.0 rule R008 "visual representation"). Pass `--no-pdf` to `cli.py create` for XML-only output. No new JSON fields are required — the PDF is derived entirely from the fields documented above.

**Credit notes**: the PDF template is document-type aware. When the JSON contains `credit_note_type_code` (i.e. when rendered via `generate_credit_note(..., embed_pdf=True)` or `cli.py create --type credit-note`), the heading renders as the translated "Credit Note" label (Creditnota / Note de crédit / Gutschrift) instead of "Invoice".

## Notes

- All optional fields can be omitted entirely — they are simply not emitted in the XML.
- ISO country codes (`country`, `seller.country`, `buyer.country`) must be uppercase to satisfy PEPPOL rule `BR-CL-14`.
- Unit codes must be valid UN/CEFACT Rec. 20 codes to satisfy `BR-CL-23`. The webapp uses a strict dropdown of 16 common codes; the CLI accepts any string but only valid codes will pass Peppyrus's server-side validation.
