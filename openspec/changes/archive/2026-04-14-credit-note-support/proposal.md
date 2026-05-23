## Why

The tool currently only handles UBL 2.1 **Invoice** documents. In EU e-invoicing a transmitted invoice cannot be edited or cancelled — corrections, refunds, and disputes must be issued as **Credit Notes**. This is the first gap any real billing workflow hits and is explicitly flagged as a limitation in `README.md`. PEPPOL BIS Billing 3.0 defines exactly two document types (Invoice and Credit Note), and the `UBL-CreditNote-2.1.xsd` schema is already bundled in `schemas/xsd/maindoc/`. The remaining work is small, contained in the library/CLI, and unblocks a real use case.

Web UI support is intentionally **deferred** to a follow-up change: the UX (how a user picks the original invoice, whether quantities pre-fill, how sign flipping works) is the actually-hard question and should not be bundled with the XML work.

## What Changes

- Add `generate_credit_note(data: dict) -> bytes` to `peppol_sender/ubl.py`, reusing the existing party / tax / monetary helpers. Refactor the line renderer so it is shared between `InvoiceLine` and `CreditNoteLine`.
- Make `peppol_sender/validator.py` document-type aware: required-element list and XSD schema are selected from the XML root tag (`Invoice` vs `CreditNote`).
- Add a module-level credit-note document type constant in `peppol_sender/api.py` (`package_message()` already accepts the type as a parameter).
- Extend `cli.py create` with `--type {invoice,credit-note}` (default `invoice`). `cli.py send` auto-detects the document type by reading the XML root element — no flag required, and no room for a flag/file mismatch.
- Add `SAMPLE_CREDIT_NOTE` fixtures and tests for UBL generation, validation, API packaging, and CLI routing.
- Update `CLAUDE.md` and `README.md` — remove the "only Invoice supported" limitation and document the new CLI flag.
- **Not changed in this proposal**: `webapp/` (no template, route, or JS changes).

## Capabilities

### New Capabilities

_None_ (existing capabilities widen).

### Modified Capabilities

- `ubl-generation`: Widen scope from "generate invoice" to "generate invoice or credit note", with a shared line renderer and a new `generate_credit_note()` entry point.
- `invoice-validation`: Structural and XSD validation become document-type aware, selecting the required-element list and schema file from the XML root tag.
- `peppyrus-api`: `package_message` is documented as accepting either the invoice or credit-note BIS Billing 3.0 document type string; `cli.py send` picks the correct one by inspecting the XML root.

## Impact

- `peppol_sender/ubl.py`: Refactor `_add_invoice_line` into a shared line renderer; add `generate_credit_note()`. Existing `generate_ubl()` output must remain byte-identical.
- `peppol_sender/validator.py`: Replace the flat `_REQUIRED` list with a root-aware lookup; cache one XSD schema per document type via `functools.cache`.
- `peppol_sender/api.py`: Add a credit-note document-type string constant next to the existing invoice one.
- `cli.py`: Add `--type` to `create`; auto-detect root element in `send` to pick the document type string.
- `tests/`: Add `SAMPLE_CREDIT_NOTE` fixture and cover generation, validation, API packaging, and CLI routing.
- `CLAUDE.md`, `README.md`: Limitation update and new CLI command examples.
- `docs/invoice-json-schema.md`: Short note that the same JSON schema is reused for credit notes, with `credit_note_type_code` (default `381`) replacing `invoice_type_code`.
- **Not touched**: `webapp/`, `schemas/` (CreditNote XSD already present).
