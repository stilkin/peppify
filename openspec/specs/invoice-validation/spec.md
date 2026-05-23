# Invoice Validation

## Purpose

Performs structural validation (required EN-16931 element presence) and XSD
validation against the official UBL 2.1 schema.

## Requirements

### Requirement: Basic structural validation

The validator MUST check for all mandatory EN-16931 elements and return a list of validation rule dicts. Each rule has keys: `id`, `type` (FATAL or WARNING), `location`, `message`. The required-element list MUST be selected from the XML root tag: `<Invoice>` uses the invoice list (including `InvoiceTypeCode` and `InvoiceLine`); `<CreditNote>` uses the credit-note list (including `CreditNoteTypeCode` and `CreditNoteLine`). All other required elements (`CustomizationID`, `ProfileID`, `ID`, `IssueDate`, `DocumentCurrencyCode`, `AccountingSupplierParty`, `AccountingCustomerParty`, `TaxTotal`, `LegalMonetaryTotal`) apply to both document types.

#### Scenario: Valid invoice passes

- **WHEN** `validate_basic()` is called on XML whose root is `<Invoice>` and contains all required invoice elements
- **THEN** an empty list of rules is returned

#### Scenario: Valid credit note passes

- **WHEN** `validate_basic()` is called on XML whose root is `<CreditNote>` and contains all required credit-note elements
- **THEN** an empty list of rules is returned

#### Scenario: Invoice missing InvoiceTypeCode

- **WHEN** an invoice XML is missing `InvoiceTypeCode`
- **THEN** a rule dict with `type: FATAL` and `id: LOCAL-MISSING-InvoiceTypeCode` is returned

#### Scenario: Credit note missing CreditNoteTypeCode

- **WHEN** a credit-note XML is missing `CreditNoteTypeCode`
- **THEN** a rule dict with `type: FATAL` and `id: LOCAL-MISSING-CreditNoteTypeCode` is returned

#### Scenario: Credit note missing CreditNoteLine

- **WHEN** a credit-note XML is missing `CreditNoteLine`
- **THEN** a rule dict with `type: FATAL` and `id: LOCAL-MISSING-CreditNoteLine` is returned

#### Scenario: Unknown root element

- **WHEN** `validate_basic()` is called on XML whose root is neither `<Invoice>` nor `<CreditNote>`
- **THEN** a single FATAL rule with `id: LOCAL-UNKNOWN-ROOT` and a descriptive message is returned, and no other required-element checks run

#### Scenario: Unparseable XML

- **WHEN** XML bytes cannot be parsed
- **THEN** a single rule dict with `id: LOCAL-XML-PARSE` and `type: FATAL` is returned

### Requirement: XSD validation

The system MUST validate UBL XML against the official UBL 2.1 XSD schema matching its document type. Invoices are validated against `schemas/xsd/maindoc/UBL-Invoice-2.1.xsd`; credit notes against `schemas/xsd/maindoc/UBL-CreditNote-2.1.xsd`. The schema is loaded lazily and cached per document type (so each schema file is parsed at most once per process).

#### Scenario: Valid UBL invoice

- **WHEN** `validate_xsd()` is called on a structurally valid UBL 2.1 Invoice
- **THEN** an empty list of rules is returned and the invoice XSD is used

#### Scenario: Valid UBL credit note

- **WHEN** `validate_xsd()` is called on a structurally valid UBL 2.1 Credit Note
- **THEN** an empty list of rules is returned and the CreditNote XSD is used

#### Scenario: XSD validation failure (invoice)

- **WHEN** an invoice XML violates the UBL 2.1 Invoice schema
- **THEN** a list of FATAL rules with `id: XSD-VALIDATION` is returned

#### Scenario: XSD validation failure (credit note)

- **WHEN** a credit-note XML violates the UBL 2.1 CreditNote schema
- **THEN** a list of FATAL rules with `id: XSD-VALIDATION` is returned

#### Scenario: Schema caching per document type

- **WHEN** `validate_xsd()` is called repeatedly on a mix of invoices and credit notes in the same process
- **THEN** each schema file is loaded and parsed at most once (verified by `functools.cache` on the schema loader)

### Requirement: Local BR-50 check

The validator MUST emit a local FATAL rule when a credit-transfer `PaymentMeansCode` (`30` or `58`) is used without a non-empty `PayeeFinancialAccount/ID` (IBAN). This mirrors PEPPOL BIS Billing 3.0 rule BR-50 and shifts the server-side check left into `validate_basic`.

#### Scenario: Credit transfer without IBAN triggers BR-50

- **WHEN** `validate_basic()` is called on invoice XML containing `PaymentMeansCode` of `30` or `58` and no `PayeeFinancialAccount/ID` (or an empty one)
- **THEN** a FATAL rule with `id: LOCAL-BR-50` is returned whose `location` points at the missing IBAN element (`/*:Invoice/*:PaymentMeans/*:PayeeFinancialAccount/*:ID`)

#### Scenario: Credit transfer with IBAN passes

- **WHEN** `validate_basic()` is called on XML containing `PaymentMeansCode` of `30` and a non-empty `PayeeFinancialAccount/ID`
- **THEN** no `LOCAL-BR-50` rule is returned

#### Scenario: BR-50 does not apply to non-credit-transfer codes

- **WHEN** `validate_basic()` is called on XML whose `PaymentMeansCode` is not `30` or `58` (e.g. `10` cash, `20` cheque, `49` direct debit)
- **THEN** no `LOCAL-BR-50` rule is returned regardless of IBAN presence

#### Scenario: BR-50 does not apply when PaymentMeans is absent

- **WHEN** `validate_basic()` is called on XML that contains no `cac:PaymentMeans` element at all
- **THEN** no `LOCAL-BR-50` rule is returned (BR-50 is only triggered by the explicit presence of a credit-transfer code)

### Requirement: CLI validate subcommand

The `validate` subcommand MUST read an XML file and run both structural and XSD checks. The document type MUST be detected from the XML root element; no flag is required.

#### Scenario: Validate passing invoice

- **WHEN** `cli.py validate --file invoice.xml` is run on a valid invoice
- **THEN** the output is `OK: validation passed (no rules)`

#### Scenario: Validate passing credit note

- **WHEN** `cli.py validate --file credit_note.xml` is run on a valid credit note
- **THEN** the output is `OK: validation passed (no rules)` and the CreditNote schema was used

#### Scenario: Validate failing document

- **WHEN** `cli.py validate --file doc.xml` is run on an invalid document (of either type)
- **THEN** each triggered rule from both validators is printed
