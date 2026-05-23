# UBL Generation

## MODIFIED Requirements

### Requirement: Generate UBL invoice from JSON

The generator MUST produce a fully EN-16931 compliant UBL 2.1 Invoice **or Credit Note** XML from a JSON invoice data structure, including all mandatory fields required by PEPPOL BIS Billing 3.0. `generate_ubl()` produces an Invoice; `generate_credit_note()` produces a Credit Note. Party, tax, and monetary subtrees are structurally identical between the two document types and MUST be produced by the same shared helpers.

#### Scenario: EN-16931 document-level fields (invoice)

- **WHEN** a valid invoice dict is provided to `generate_ubl()`
- **THEN** the generated XML has `<Invoice>` as the root element and includes `CustomizationID`, `ProfileID`, `ID`, `IssueDate`, `InvoiceTypeCode`, and `DocumentCurrencyCode` in correct UBL sequence order

#### Scenario: EN-16931 document-level fields (credit note)

- **WHEN** a valid credit-note dict is provided to `generate_credit_note()`
- **THEN** the generated XML has `<CreditNote>` as the root element and includes `CustomizationID`, `ProfileID`, `ID`, `IssueDate`, `CreditNoteTypeCode`, and `DocumentCurrencyCode` in correct UBL sequence order

#### Scenario: Default credit-note type code

- **WHEN** `generate_credit_note()` is called with a dict that omits `credit_note_type_code`
- **THEN** `CreditNoteTypeCode` defaults to `"381"` (UN/CEFACT commercial credit note)

#### Scenario: Line items use correct wrapper element

- **WHEN** an Invoice is generated
- **THEN** each line item is emitted as `<InvoiceLine>`
- **AND WHEN** a Credit Note is generated
- **THEN** each line item is emitted as `<CreditNoteLine>` with the same internal element ordering and content

#### Scenario: Shared party, tax, and monetary subtrees

- **WHEN** an Invoice and a Credit Note are generated from equivalent JSON (same seller, buyer, line items, tax categories)
- **THEN** the `AccountingSupplierParty`, `AccountingCustomerParty`, `TaxTotal`, and `LegalMonetaryTotal` subtrees are structurally identical between the two outputs (same helpers, same element ordering)

#### Scenario: Due date and payment terms

- **WHEN** the dict contains `due_date` and optionally `payment_terms`
- **THEN** `DueDate` and `PaymentTerms/Note` elements are included in the XML for both document types

#### Scenario: Seller party with full details

- **WHEN** the dict contains `seller` with `name`, `endpoint_id`, `endpoint_scheme`, `country`, and optionally `street`, `city`, `postal_code`, `vat`
- **THEN** `AccountingSupplierParty` includes `EndpointID` (with `@schemeID`), `PostalAddress` (with `Country/IdentificationCode`), `PartyLegalEntity/RegistrationName`, and optional `PartyTaxScheme`

#### Scenario: Buyer party with full details

- **WHEN** the dict contains `buyer` with the same fields as seller
- **THEN** `AccountingCustomerParty` includes the same subtree structure

#### Scenario: Legal registration identifier (BT-30/BT-47)

- **WHEN** a party dict contains `legal_id` and optionally `legal_id_scheme`
- **THEN** the `PartyLegalEntity` element includes `CompanyID` with the legal identifier as text and (if present) `legal_id_scheme` as the `@schemeID` attribute

#### Scenario: Party contact information (BT-41..43 / BT-56..58)

- **WHEN** a party dict contains any of `contact_name`, `contact_email`, or `contact_phone`
- **THEN** the party subtree includes a `cac:Contact` element after `PartyLegalEntity`, containing only the fields that are set — `cbc:Name`, `cbc:Telephone`, `cbc:ElectronicMail` — in UBL sequence order

#### Scenario: Legal monetary totals

- **WHEN** the document has one or more line items
- **THEN** `LegalMonetaryTotal` is generated with `LineExtensionAmount`, `TaxExclusiveAmount`, `TaxInclusiveAmount`, and `PayableAmount`

#### Scenario: Tax total for VAT-exempt business

- **WHEN** line items use tax category `E` or `O` with percent `0`
- **THEN** `TaxTotal` is generated with `TaxAmount` of `0.00`, a `TaxSubtotal` with the category code, and `TaxExemptionReason`

#### Scenario: Tax total with standard VAT

- **WHEN** line items have a `tax_percent` greater than zero
- **THEN** `TaxTotal` is generated with calculated tax amounts grouped by tax category and rate

#### Scenario: Line item tax classification

- **WHEN** a line item is provided
- **THEN** the line's `Item` element includes `ClassifiedTaxCategory` with `ID`, `Percent`, and `TaxScheme/ID` set to `VAT` — for both `InvoiceLine` and `CreditNoteLine`

#### Scenario: Line service date — single day (BT-134/BT-135)

- **WHEN** a line item contains `service_date`
- **THEN** the line element includes `cac:InvoicePeriod` after `LineExtensionAmount` with `StartDate` and `EndDate` both set to that value (satisfying `BR-CO-25`)

#### Scenario: Line service date — range

- **WHEN** a line item contains `service_start_date` and `service_end_date`
- **THEN** the line element includes `cac:InvoicePeriod` with the provided distinct start and end dates

#### Scenario: Line extension amount defaults

- **WHEN** a line item omits `line_extension_amount`
- **THEN** `LineExtensionAmount` is calculated as `quantity * unit_price`

#### Scenario: Default values

- **WHEN** optional fields are omitted from the dict
- **THEN** defaults are applied: `invoice_number` = `INV-0001`, `invoice_type_code` = `380`, `credit_note_type_code` = `381`, `currency` = `EUR`, `unit` = `EA`, `endpoint_scheme` = `0208`

#### Scenario: Invoice output byte-identity after refactor

- **WHEN** `generate_ubl()` is called with the same input it accepted before the shared-line-renderer refactor
- **THEN** the output XML is byte-identical to the pre-change output (no accidental regressions from factoring out the shared line renderer)

### Requirement: CLI create subcommand

The `create` subcommand MUST read a JSON file and write UBL XML to disk. It MUST support both invoice and credit-note document types via a `--type {invoice,credit-note}` flag that defaults to `invoice`.

#### Scenario: Create invoice from JSON file (default)

- **WHEN** `cli.py create --input invoice.json --out invoice.xml` is run
- **THEN** the JSON file is read, passed to `generate_ubl()`, and the resulting XML is written to the output path

#### Scenario: Create invoice with explicit --type invoice

- **WHEN** `cli.py create --type invoice --input invoice.json --out invoice.xml` is run
- **THEN** `generate_ubl()` is used (same as the default)

#### Scenario: Create credit note with --type credit-note

- **WHEN** `cli.py create --type credit-note --input credit_note.json --out cn.xml` is run
- **THEN** `generate_credit_note()` is used and the output file's root element is `<CreditNote>`
