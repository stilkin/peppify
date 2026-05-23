# Peppyrus API

## Purpose

Client for the Peppyrus Access Point API. Handles packaging invoices into the
required MessageBody format and transmitting them over HTTPS. Idempotent GET
helpers (report, org info, participant lookup, business card search) retry
automatically on transient server errors (5xx) with exponential backoff.
`POST /message` is intentionally **not** retried to avoid duplicate PEPPOL
transmissions — POST is excluded from `urllib3.util.Retry`'s default
`allowed_methods` set.

## Requirements

### Requirement: Package message for transmission

Base64-encodes UBL XML and wraps it in a MessageBody dict matching the Peppyrus OpenAPI schema. The caller supplies the document type string; the module MUST expose constants for both supported BIS Billing 3.0 document types (Invoice and Credit Note).

#### Scenario: Package valid invoice

- **WHEN** `package_message()` is called with invoice XML bytes, sender, recipient, process type, and the invoice document type constant
- **THEN** a dict is returned with keys `sender`, `recipient`, `processType`, `documentType`, and `fileContent` (base64-encoded XML), and `documentType` equals the invoice BIS Billing 3.0 string

#### Scenario: Package valid credit note

- **WHEN** `package_message()` is called with credit-note XML bytes, sender, recipient, process type, and the credit-note document type constant
- **THEN** a dict is returned with the same keys and `documentType` equals `busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1`

#### Scenario: Document type constants exported

- **WHEN** a caller imports `peppol_sender.api`
- **THEN** module-level constants for both the invoice and credit-note BIS Billing 3.0 document type strings are available for direct use (so call sites do not have to duplicate the full string)

### Requirement: Send message to Peppyrus

The client MUST POST the packaged MessageBody to the Peppyrus `/message`
endpoint with `X-Api-Key` authentication, and MUST NOT retry failed POSTs to
avoid duplicate PEPPOL transmissions.

#### Scenario: Successful send

- **WHEN** `send_message()` is called with a valid message body and API key
- **THEN** a dict with `status_code` and `json` (parsed response body) is returned

#### Scenario: Non-JSON response

- **WHEN** the API returns a non-JSON response body
- **THEN** `json` contains `{"error_text": "<raw response text>"}`

#### Scenario: No retry for POST

- **WHEN** `send_message()` receives any failure (5xx, 4xx, or network error)
- **THEN** the request is NOT retried and the response (or exception) is returned immediately, because retrying a POST could create duplicate PEPPOL invoices

### Requirement: Retrieve message report

The client MUST fetch validation and transmission rules for a previously sent
message via `GET /message/{id}/report`, retrying transient failures as an
idempotent GET.

#### Scenario: Fetch report

- **WHEN** `get_report()` is called with a message ID and API key
- **THEN** a dict with `status_code` and `json` (parsed report) is returned

#### Scenario: Retry on server error

- **WHEN** `get_report()` receives a 5xx response or a network error
- **THEN** the request is retried up to 3 times with exponential backoff

### Requirement: Retrieve organization info

The client MUST fetch the authenticated organization's details from
`GET /organization/info`. The response includes name, address, VAT, and
country — used by the webapp to auto-populate the seller card on page load.

#### Scenario: Fetch organization info

- **WHEN** `get_org_info()` is called with a valid API key
- **THEN** a dict with `status_code` and `json` (organization details) is returned

### Requirement: Look up PEPPOL participant

The client MUST resolve a VAT number + country code to a PEPPOL participant
identifier via `GET /peppol/bestMatch`. Used by the webapp's buyer lookup flow.

#### Scenario: Look up by VAT number

- **WHEN** `lookup_participant()` is called with a VAT number, country code, and API key
- **THEN** a dict with `status_code` and `json` (participant ID and services) is returned

### Requirement: Fetch business card

The client MUST fetch the PEPPOL directory business card for a participant ID
via `GET /peppol/search?participantId=...`. Used to enrich a looked-up buyer with
directory data (name, country, geo info).

#### Scenario: Fetch business card

- **WHEN** `search_business_card()` is called with a participant ID and API key
- **THEN** a dict with `status_code` and `json` (business card data) is returned

### Requirement: CLI send subcommand

The `send` subcommand MUST validate, package, and transmit a UBL document. It MUST auto-detect the document type from the XML root element and select the matching Peppyrus document-type string — no `--type` flag is needed. It MUST require `PEPPYRUS_API_KEY` and `PEPPOL_SENDER_ID` environment variables.

#### Scenario: Send an invoice

- **WHEN** `cli.py send --file invoice.xml --recipient <ID>` is run against an XML file whose root is `<Invoice>`
- **THEN** the file is validated, packaged with the invoice document type constant, sent, and the HTTP status code and response are printed

#### Scenario: Send a credit note

- **WHEN** `cli.py send --file credit_note.xml --recipient <ID>` is run against an XML file whose root is `<CreditNote>`
- **THEN** the file is validated, packaged with the credit-note document type constant, sent, and the HTTP status code and response are printed

#### Scenario: Abort on unknown root element

- **WHEN** `cli.py send --file doc.xml` is run against an XML file whose root is neither `<Invoice>` nor `<CreditNote>`
- **THEN** the `LOCAL-UNKNOWN-ROOT` FATAL rule is raised by the validator and the send is aborted with the fatal rules printed

#### Scenario: Abort on FATAL validation

- **WHEN** the document has any FATAL validation rule (structural or XSD)
- **THEN** the send is aborted and the fatal rules are printed

#### Scenario: Missing credentials

- **WHEN** `PEPPYRUS_API_KEY` or `PEPPOL_SENDER_ID` is not set
- **THEN** an error message is printed and no API call is made

### Requirement: CLI report subcommand

The CLI MUST provide a `report` subcommand to fetch and display message reports.

#### Scenario: Fetch report by message ID

- **WHEN** `cli.py report --id <message-id>` is run with valid credentials
- **THEN** the validation and transmission rules from the report are printed

#### Scenario: Missing credentials

- **WHEN** `PEPPYRUS_API_KEY` is not set
- **THEN** an error message is printed and no API call is made
