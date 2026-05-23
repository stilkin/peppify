## 1. UBL Generator

- [x] 1.1 Extract a shared line renderer from `_add_invoice_line()` in `peppol_sender/ubl.py` that accepts the line element tag as a parameter; keep the existing `_add_invoice_line` as a thin wrapper for `InvoiceLine`
- [x] 1.2 Add `_add_credit_note_line()` wrapping the same renderer with `CreditNoteLine`
- [x] 1.3 Add `generate_credit_note(data: dict) -> bytes` next to `generate_ubl()`, reusing `_add_party()`, `_add_tax_total()`, and `_add_legal_monetary_total()` unchanged
- [x] 1.4 Emit `CreditNoteTypeCode` (default `381`) in the credit-note header and keep UBL element sequence order
- [x] 1.5 Verify existing `generate_ubl()` output is byte-identical after the refactor (run full `tests/test_ubl.py` suite)

## 2. Validator

- [x] 2.1 Replace the flat `_REQUIRED` list in `peppol_sender/validator.py` with a `_required_for(root_tag)` helper returning the correct element list per document type
- [x] 2.2 Update `validate_basic()` to detect the root element first, then apply the correct required list; add a `LOCAL-UNKNOWN-ROOT` FATAL rule for unexpected roots
- [x] 2.3 Replace the module-level cached schema with a `_schema_for(root_tag)` helper decorated with `@functools.cache`; load `UBL-Invoice-2.1.xsd` or `UBL-CreditNote-2.1.xsd` on demand
- [x] 2.4 Update `validate_xsd()` to dispatch via `_schema_for()` based on the parsed root tag

## 3. API Client

- [x] 3.1 Add module-level constants in `peppol_sender/api.py` for the invoice and credit-note BIS Billing 3.0 document type strings (alongside the existing process type constant if present)
- [x] 3.2 Confirm `package_message()` accepts the new credit-note string unchanged (no signature change expected)

## 4. CLI

- [x] 4.1 Add `--type {invoice,credit-note}` (default `invoice`) to the `create` subcommand argparser in `cli.py`
- [x] 4.2 Dispatch `cmd_create()` to `generate_ubl()` or `generate_credit_note()` based on `--type`
- [x] 4.3 Add a small helper in `cli.py` that reads the root element of an XML file and returns `"invoice"` or `"credit-note"`
- [x] 4.4 Update `cmd_send()` to use that helper for picking the document type string; no new CLI flag on `send`

## 5. Tests

- [x] 5.1 Add a `SAMPLE_CREDIT_NOTE` fixture to `tests/test_ubl.py` (mirror `SAMPLE_INVOICE`, substitute `credit_note_type_code`)
- [x] 5.2 Test `generate_credit_note()` produces `<CreditNote>` root, `CreditNoteTypeCode` 381, and `CreditNoteLine` children in correct UBL sequence
- [x] 5.3 Test that party / tax / monetary subtrees are structurally identical to the invoice case (same helpers)
- [x] 5.4 Add a regression test confirming `generate_ubl()` output for `SAMPLE_INVOICE` is byte-identical to a stored reference (or assert element-by-element against the pre-change expectation)
- [x] 5.5 Add validator tests in `tests/test_validator.py`: `validate_basic` on a credit note enforces `CreditNoteTypeCode` + `CreditNoteLine`; `validate_xsd` selects the CreditNote schema
- [x] 5.6 Add a validator test for the `LOCAL-UNKNOWN-ROOT` FATAL rule
- [x] 5.7 Add `tests/test_api.py` coverage for `package_message()` with the credit-note document type constant
- [x] 5.8 Add `tests/test_cli.py` coverage for `create --type credit-note` dispatch and for `send` auto-detecting the root element (mock Peppyrus)
- [x] 5.9 Run `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `uv run pytest --cov-fail-under=80`

## 6. Docs

- [x] 6.1 Update `CLAUDE.md` Commands section with `cli.py create --type credit-note` and note that `send` auto-detects
- [x] 6.2 Update `README.md`: remove "Only the Invoice document type is supported" limitation, add a credit-note usage example, note the webapp does not yet produce credit notes
- [x] 6.3 Update `docs/invoice-json-schema.md` to document `credit_note_type_code` and call out that the same JSON shape covers both document types

## 7. OpenSpec Finalisation

- [x] 7.1 After implementation, merge the spec deltas from this change into `openspec/specs/ubl-generation/spec.md`, `openspec/specs/invoice-validation/spec.md`, and `openspec/specs/peppyrus-api/spec.md`
- [x] 7.2 Move this change directory to `openspec/changes/archive/2026-04-14-credit-note-support/`
