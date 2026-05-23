# UBL Generation

## Purpose

Generates EN-16931 compliant UBL 2.1 Invoice or Credit Note XML from a JSON data structure.
Uses proper `cbc:`/`cac:` namespaces and strict element ordering per XSD `xs:sequence`.

## Requirements

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
- **THEN** `DueDate` and `PaymentTerms/Note` elements are included in the XML (Invoices only — the UBL CreditNote-2.1 schema has no `DueDate` element)

#### Scenario: Seller party with full details

- **WHEN** the invoice dict contains `seller` with `name`, `endpoint_id`, `endpoint_scheme`, `country`, and optionally `street`, `city`, `postal_code`, `vat`
- **THEN** the `AccountingSupplierParty` includes `EndpointID` (with `@schemeID`), `PostalAddress` (with `Country/IdentificationCode`), `PartyLegalEntity/RegistrationName`, and optional `PartyTaxScheme`

#### Scenario: Buyer party with full details

- **WHEN** the invoice dict contains `buyer` with same fields as seller
- **THEN** the `AccountingCustomerParty` includes the same subtree structure

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
- **THEN** the line element includes `cac:InvoicePeriod` after `LineExtensionAmount` with `StartDate` and `EndDate` both set to that value (satisfying `BR-CO-25` which requires both to be present when either is)

#### Scenario: Line service date — range

- **WHEN** a line item contains `service_start_date` and `service_end_date`
- **THEN** the line element includes `cac:InvoicePeriod` with the provided distinct start and end dates

#### Scenario: Line extension amount defaults

- **WHEN** a line item omits `line_extension_amount`
- **THEN** `LineExtensionAmount` is calculated as `quantity * unit_price`

#### Scenario: Default values

- **WHEN** optional fields are omitted from the dict
- **THEN** defaults are applied: `invoice_number` = `INV-0001`, `invoice_type_code` = `380`, `credit_note_type_code` = `381`, `currency` = `EUR`, `unit` = `EA`, `endpoint_scheme` = `0208`

#### Scenario: Payment means — credit transfer with IBAN

- **WHEN** the invoice dict contains `payment_means` with an `iban` and optional `bic`, `account_name`, `payment_id`, and `code`
- **THEN** the generated XML includes `cac:PaymentMeans` positioned after `AccountingCustomerParty` and before `PaymentTerms`, containing `cbc:PaymentMeansCode` (value from `code`), optional `cbc:PaymentID`, and `cac:PayeeFinancialAccount` with `cbc:ID` (the IBAN), optional `cbc:Name` (the account holder), and optional `cac:FinancialInstitutionBranch/cbc:ID` (the BIC)

#### Scenario: Payment means defaults

- **WHEN** `payment_means` contains `iban` but omits `code`, `account_name`, and `payment_id`
- **THEN** `PaymentMeansCode` defaults to `"30"` (credit transfer), `Name` defaults to the seller name, and `PaymentID` defaults to the invoice number

#### Scenario: BIC is optional

- **WHEN** `payment_means` omits `bic`
- **THEN** no `cac:FinancialInstitutionBranch` element is emitted under `PayeeFinancialAccount`

#### Scenario: No payment means block

- **WHEN** the invoice dict does not contain a `payment_means` key
- **THEN** no `cac:PaymentMeans` element is emitted and the rest of the invoice XML is unchanged

#### Scenario: Non-credit-transfer payment codes

- **WHEN** `payment_means.code` is a non-credit-transfer value (e.g. `"10"` for cash, `"20"` for cheque)
- **THEN** `cac:PaymentMeans` is still emitted with the given code and with `PayeeFinancialAccount` populated only if an `iban` is supplied

#### Scenario: Embed visual representation (PDF)

- **WHEN** `generate_ubl()` is called with `embed_pdf=True` (the CLI and webapp default at their call sites)
- **THEN** the generated XML contains exactly one `cac:AdditionalDocumentReference` positioned after `cbc:BuyerReference` and before `cac:AccountingSupplierParty`, containing `cbc:ID` (the invoice number), `cbc:DocumentDescription` (`"Commercial Invoice"`), and `cac:Attachment/cbc:EmbeddedDocumentBinaryObject` with `mimeCode="application/pdf"`, `filename="<invoice_number>.pdf"`, and base64-encoded PDF bytes as element text

#### Scenario: Single visual representation per invoice

- **WHEN** an invoice is generated with PDF embedding enabled
- **THEN** exactly one `cac:AdditionalDocumentReference` with an embedded PDF is emitted (matching PEPPOL-EN16931-R008)

#### Scenario: PDF embedding opt-out

- **WHEN** `generate_ubl()` is called with `embed_pdf=False` (the library default)
- **THEN** no `cac:AdditionalDocumentReference` element is emitted and the rest of the XML is unchanged

#### Scenario: PDF totals match XML totals

- **WHEN** an invoice is rendered and embedded
- **THEN** the totals displayed in the PDF (subtotal, tax, grand total) match the XML's `LegalMonetaryTotal/PayableAmount` and `TaxTotal/TaxAmount` byte-for-byte, including for mixed-rate invoices (same tax-group Decimal rounding as `_add_tax_total`)

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
