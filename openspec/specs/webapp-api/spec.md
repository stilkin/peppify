# Webapp API

## Purpose

The Flask backend for the single-page invoice form: serves the page and exposes JSON endpoints for organization info, buyer lookup, business-card enrichment, validation, send, and PDF preview. Stateless beyond the `.env` credentials.

## Requirements

### Requirement: Serve invoice form

The Flask backend MUST serve the single-page invoice form.

#### Scenario: GET /

- **WHEN** a browser requests `GET /`
- **THEN** the invoice form HTML page is returned

### Requirement: Proxy organization info

The Flask backend MUST proxy Peppyrus organization API calls to keep the API key server-side.

#### Scenario: GET /api/org-info

- **WHEN** the frontend requests `/api/org-info`
- **THEN** the backend calls Peppyrus `/organization/info` with the server-side API key and returns the organization details as JSON

### Requirement: Proxy participant lookup

The Flask backend MUST proxy PEPPOL participant lookups.

#### Scenario: GET /api/lookup with VAT number

- **WHEN** the frontend requests `/api/lookup?vatNumber=...&countryCode=...`
- **THEN** the backend calls Peppyrus `/peppol/bestMatch` and returns the participant details as JSON

#### Scenario: GET /api/business-card by participant ID

- **WHEN** the frontend requests `/api/business-card?participantId=...`
- **THEN** the backend calls Peppyrus `/peppol/search?participantId=...` and returns the matching business card data as JSON

### Requirement: Validate and send invoice

The Flask backend MUST accept invoice data, generate UBL XML, validate, and optionally send.

#### Scenario: POST /api/validate

- **WHEN** the frontend POSTs invoice JSON to `/api/validate`
- **THEN** the backend generates UBL XML, runs basic + XSD validation, and returns the list of rules as JSON

#### Scenario: POST /api/send

- **WHEN** the frontend POSTs invoice JSON to `/api/send`
- **THEN** the backend generates UBL XML (with a rendered PDF embedded as a `cac:AdditionalDocumentReference` when the request's `embed_pdf` flag is enabled), validates it, and if no FATAL rules exist, sends it via Peppyrus and returns the response

### Requirement: PDF preview endpoint

The Flask backend MUST expose a route that renders the current invoice JSON as a PDF and returns the bytes. This route is used by the webapp's `Preview PDF` button and is separate from the validate / send routes.

#### Scenario: POST /api/preview-pdf returns a PDF

- **WHEN** the frontend POSTs invoice JSON to `/api/preview-pdf`
- **THEN** the backend calls `render_pdf()` and returns the resulting bytes with `Content-Type: application/pdf` and a `Content-Disposition` header whose filename is `<invoice_number>.pdf`

#### Scenario: Preview endpoint does not transmit via Peppyrus

- **WHEN** `/api/preview-pdf` is called
- **THEN** no Peppyrus API call is made — only `render_pdf()` is invoked

#### Scenario: Preview error handling

- **WHEN** `render_pdf()` raises a `RuntimeError` (e.g. missing WeasyPrint system libraries)
- **THEN** the route returns an HTTP 500 with a JSON body containing an `error` field whose message is actionable, not a raw stack trace
