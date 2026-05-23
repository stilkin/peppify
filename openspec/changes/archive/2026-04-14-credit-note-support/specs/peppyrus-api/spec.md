# Peppyrus API

## MODIFIED Requirements

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
