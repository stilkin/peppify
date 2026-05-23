## Context

Invoice-only support blocks real billing workflows. Once an invoice is transmitted over PEPPOL it is immutable — any correction, refund, or dispute requires issuing a credit note. The XML differences between an Invoice and a Credit Note under BIS Billing 3.0 are narrow: the root element (`CreditNote` vs `Invoice`), the line item tag (`CreditNoteLine` vs `InvoiceLine`), the type code element (`CreditNoteTypeCode` default `381` vs `InvoiceTypeCode` default `380`), and the Peppyrus `documentType` string. `CustomizationID`, `ProfileID`, party subtrees, tax totals, and monetary totals are all identical. The `UBL-CreditNote-2.1.xsd` schema is already present in `schemas/xsd/maindoc/`.

## Goals / Non-Goals

**Goals:**

- Generate EN-16931 compliant UBL 2.1 Credit Note XML using the same JSON shape as invoices (minus `invoice_type_code` + `credit_note_type_code`).
- Reuse the existing party / tax / monetary helpers with no behavioural change to the Invoice output (byte-identical).
- Document-type aware structural and XSD validation (pick required elements and schema from the XML root).
- CLI support via `--type` on `create` and root-based auto-detection on `send`.
- Credit-note document-type routing in the Peppyrus API client.
- Full test coverage for the new paths; keep coverage ≥ 80%.

**Non-Goals:**

- Web UI support for credit notes (deferred to a dedicated follow-up change so the UX questions can be worked through in isolation).
- Schematron / EN-16931 business rule validation for credit notes locally — same limitation as invoices; Peppyrus catches these server-side.
- Self-billing credit notes, debit notes, or any other UBL document type.
- Automatic derivation of credit notes from an existing invoice XML (sign flipping, line-item pre-fill). This is a web-UI concern and belongs in the follow-up.
- Renaming the `invoice-validation` spec to a more neutral name — renaming specs would balloon the diff and is not load-bearing.

## Decisions

**Separate `generate_credit_note()` entry point, not a `document_type=` kwarg on `generate_ubl()`**

- Keeps the type signatures and the call sites obvious. Callers never pass a string that could silently route to the wrong builder.
- The shared line renderer + shared party/tax/total helpers absorb the actual reuse, so the "new" function is a thin wrapper.
- Alternative considered: one `generate_ubl(data, document_type="invoice")` function branching internally. Rejected — branching a single function on a string is less mypy-friendly and forces every caller to thread the parameter through.

**Extract a shared line renderer instead of calling `_add_invoice_line` with a tag argument**

- Current `_add_invoice_line()` hardcodes the `InvoiceLine` tag. The cleanest refactor is a private `_add_document_line(parent, line, *, line_tag)` helper that both `_add_invoice_line` and a new `_add_credit_note_line` wrap, or that `generate_ubl` / `generate_credit_note` call directly.
- UBL element ordering inside a line item is identical for `InvoiceLine` and `CreditNoteLine`; only the wrapper tag differs.
- Must be verified byte-identical for the Invoice case — the existing test suite (~99% coverage of `ubl.py`) is the safety net.

**Document-type aware validator: dispatch from the XML root tag**

- `validate_basic()` reads the root element first, then looks up the required-element list via `_required_for(root_tag)`. The required list for credit notes substitutes `CreditNoteTypeCode` and `CreditNoteLine` for their Invoice counterparts; everything else (`CustomizationID`, `ProfileID`, party subtrees, `TaxTotal`, `LegalMonetaryTotal`, etc.) is unchanged.
- `validate_xsd()` picks the schema via a `_schema_for(root_tag)` helper cached with `@functools.cache`. Unknown root tags fall through to a FATAL rule (`LOCAL-UNKNOWN-ROOT`) rather than crashing.
- Alternative considered: a `document_type` argument on both functions. Rejected — the XML itself is the source of truth; making the caller assert a type risks flag/file mismatch, and all real entry points (CLI, webapp) already have the XML in hand.

**CLI: `--type` flag on `create`, auto-detect on `send`**

- On `create` the flag is required because no XML exists yet.
- On `send` we have the XML file in hand. Parsing the root element is cheap and eliminates an entire class of footguns (user passes `--type invoice` but the file is actually a credit note or vice versa). The same auto-detection can be reused inside `validate` for consistency.
- Rejected: separate `credit-note-create` / `credit-note-send` subcommands. Doubles the CLI surface area for no benefit — the flows are 90%+ identical.

**Credit-note type code defaults to `381`**

- UN/CEFACT document type code 381 ("Credit note") is the default used in every BIS Billing 3.0 example. Callers can override via `credit_note_type_code` in the JSON dict, mirroring how invoices accept `invoice_type_code` (default `380`).

**Peppyrus `documentType` string**

- Invoice today: `busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1`
- Credit note: same pattern with `CreditNote-2::CreditNote`. Store both as module-level constants in `peppol_sender/api.py`; `cli.py send` picks between them by inspecting the root element.
- Process type ID (`urn:fdc:peppol.eu:2017:poacc:billing:01:1.0`) is unchanged.

**Keep `invoice-validation` spec name**

- Renaming specs is out of scope for this change. Scope widening (credit notes) is documented in the spec body and in the modified requirement text. A later cleanup change can rename if desired.

## Risks / Trade-offs

- **Refactoring the line renderer could break byte-identity of existing Invoice output.** Mitigation: the existing `test_ubl.py` suite (~99% coverage) already asserts element content and ordering; any regression will surface immediately. Run the full suite before every commit.
- **Auto-detection in `send` means a malformed XML (unexpected root) fails later than a flag-based check would.** Mitigation: validator already catches this as a FATAL rule; `cli.py send` refuses to transmit on FATAL rules; the error message will be specific.
- **JSON schema ambiguity.** The same JSON dict shape is reused for both document types. Callers must set `credit_note_type_code` (not `invoice_type_code`) when using `generate_credit_note()`. Mitigation: documented in `docs/invoice-json-schema.md`; `generate_credit_note()` silently ignores `invoice_type_code` if present rather than raising, to keep the ergonomics simple.
- **Web UI drift.** The webapp keeps calling `generate_ubl()` directly and cannot produce credit notes until the follow-up change lands. That is intentional but worth flagging in `README.md` so users are not surprised.
