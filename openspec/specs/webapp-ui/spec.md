# Webapp UI

## Purpose

The single-page invoice form rendered in the browser: seller/buyer/line-item/settings sections, live totals, guarded send, and per-browser state (recent customers, templates, defaults) in localStorage. Built with Jinja2 templates plus vanilla JS and CSS — no framework, no build step.
## Requirements
### Requirement: Invoice form layout

The webapp MUST provide a single-page invoice form with sections for seller, buyer, line items, and invoice settings.

#### Scenario: Page load with seller auto-population

- **WHEN** the user opens the invoice form
- **THEN** seller fields (name, address, VAT, endpoint ID) are pre-filled from the Peppyrus organization info API and displayed as read-only

#### Scenario: Invoice header defaults

- **WHEN** the form loads
- **THEN** invoice number is auto-incremented from the last used number stored in localStorage, issue date defaults to today, and saved defaults (currency, payment terms, due date offset, tax category/percent) are applied

### Requirement: Buyer lookup and selection

The webapp MUST allow looking up PEPPOL participants and selecting from recent customers.

#### Scenario: Lookup buyer by VAT number

- **WHEN** the user enters a VAT number and country code, then clicks "Lookup"
- **THEN** the app queries the Peppyrus `/peppol/bestMatch` endpoint and pre-fills the buyer's participant ID and available details

#### Scenario: Select recent customer

- **WHEN** the user opens the customer dropdown
- **THEN** previously used buyers (stored in localStorage) are listed, and selecting one pre-fills all buyer fields

#### Scenario: Save new customer

- **WHEN** an invoice is successfully sent to a new buyer
- **THEN** the buyer details are saved to localStorage for future use, keyed on the participant ID (`endpoint_scheme:endpoint_id`) so that edits to a known customer overwrite the existing entry instead of creating a duplicate

#### Scenario: Recipient auto-fill

- **WHEN** the user looks up a buyer or picks a recent customer
- **THEN** the "Send to participant" field is automatically populated with the buyer's `endpoint_scheme:endpoint_id`, remaining editable for manual overrides

### Requirement: Dynamic line items

The webapp MUST support adding, removing, and templating line items with auto-calculated totals.

#### Scenario: Add and remove line rows

- **WHEN** the user clicks "Add line" or "Remove" on a line
- **THEN** a row is added or removed, and totals are recalculated

#### Scenario: Line item templates

- **WHEN** the user selects a saved line template from a dropdown
- **THEN** the description, unit, unit price, tax category, and tax percent fields are pre-filled

#### Scenario: Save line template

- **WHEN** the user clicks the ★ button on a line item
- **THEN** the line item details (excluding `service_date`, which is invoice-specific) are stored in localStorage for future use

#### Scenario: Line service date

- **WHEN** the user picks a date in the line item's "service date" field
- **THEN** the invoice JSON sent to the backend includes `service_date` on that line, and the backend emits a `cac:InvoicePeriod` element on the corresponding `InvoiceLine`

#### Scenario: Auto-calculated totals

- **WHEN** line item quantities, prices, or tax rates change
- **THEN** line extension amounts, tax totals, and the grand total are recalculated and displayed in real time

### Requirement: Validate and send

The webapp MUST validate invoices before sending and display clear results.

#### Scenario: Validate before send

- **WHEN** the user clicks "Send"
- **THEN** the invoice is validated (basic + XSD) first; if FATAL rules are found, they are displayed and the send is blocked

#### Scenario: Successful send

- **WHEN** validation passes and the invoice is sent
- **THEN** the HTTP status and message ID are displayed, the invoice number is incremented in localStorage, and the buyer is saved to recent customers

#### Scenario: Send failure

- **WHEN** the API returns an error
- **THEN** the error details are displayed to the user

### Requirement: Settings management

The webapp MUST allow users to view and edit their default invoice settings and their personal contact info.

#### Scenario: Edit defaults

- **WHEN** the user opens the settings modal
- **THEN** they can edit default currency, payment terms (multi-line), due date offset, and tax category/percent — all saved to localStorage and applied to the next invoice

#### Scenario: Edit seller contact info

- **WHEN** the user fills in contact name, contact email, or contact phone in the settings modal
- **THEN** the values are saved to localStorage under a dedicated key and merged into the seller object on subsequent invoices, producing a `cac:Contact` element in the generated XML

### Requirement: Seller bank account settings

The Settings modal MUST allow the user to configure seller bank account details (IBAN, BIC, account holder name) as a persistent default, alongside the existing currency / payment terms / due date offset / tax category defaults. These values MUST be persisted in browser localStorage and MUST be included in the `payment_means` block of every invoice JSON sent to `/api/validate` and `/api/send`.

#### Scenario: Edit and persist bank account details

- **WHEN** the user opens the Settings modal, fills in IBAN, BIC, and account holder name, and clicks Save
- **THEN** the values are stored in localStorage and the modal closes

#### Scenario: Bank details auto-apply to new invoices

- **WHEN** a new invoice form is opened after saving bank details in settings
- **THEN** the saved values are available without re-entry and are included in `payment_means` on validate/send

#### Scenario: Bank details in validate and send payloads

- **WHEN** the user clicks Validate or Send on an invoice with configured bank details
- **THEN** the POST body contains a `payment_means` block with `iban`, `bic` (if set), and `account_name`, and the backend forwards it to `generate_ubl()`

#### Scenario: Misleading IBAN placeholder removed

- **WHEN** the user opens the invoice form
- **THEN** the `Payment terms` textarea no longer shows an `IBAN: BE00 ...` placeholder; its placeholder text refers only to payment notes (e.g. `Net 21 days`)

### Requirement: Preview PDF button

The webapp MUST provide a `Preview PDF` button on the invoice form that renders the current form state as a PDF and opens it for viewing. This lets the user see the human-readable representation that receivers will see, before committing to Send.

#### Scenario: Preview PDF from current form state

- **WHEN** the user clicks `Preview PDF` on the invoice form
- **THEN** the current form data is POSTed to `/api/preview-pdf` and the returned PDF is opened in a new browser tab

#### Scenario: Preview does not transmit the invoice

- **WHEN** the user clicks `Preview PDF`
- **THEN** no Peppyrus API call is made — only the local PDF rendering route is invoked

#### Scenario: Preview surfaces render errors

- **WHEN** the backend `render_pdf()` call fails (e.g. missing system libraries)
- **THEN** the button handler displays the error message inline in the form's status area rather than opening an empty tab

### Requirement: Per-invoice PDF language selection

The webapp MUST let the user choose the language of the generated PDF per invoice, with a cascade of defaults: the Settings modal stores a fallback `Default PDF language`, the saved-customer record persists a per-customer `language` field that auto-fills when the customer is loaded from the Recent dropdown, and the invoice form exposes a `Language` select next to the `Currency` field that the user can override at any time. The webapp UI itself is NOT translated — only the rendered PDF.

Supported languages: English (`en`), Dutch (`nl`), French (`fr`), German (`de`). Options in the UI select are labeled in their own language (`English`, `Nederlands`, `Français`, `Deutsch`).

#### Scenario: Settings default flows into new invoices

- **WHEN** the user sets `Default PDF language` to `nl` in the Settings modal, saves, and opens a fresh invoice form
- **THEN** the invoice form's `Language` select is pre-filled with `nl`, and `collectInvoice()` includes `language: "nl"` in the POST body to `/api/validate`, `/api/send`, and `/api/preview-pdf`

#### Scenario: Loaded customer auto-fills the language

- **WHEN** the user loads a saved customer from the Recent dropdown, and that customer's record has `language: "fr"`
- **THEN** the `Language` select changes to `fr`, overriding the Settings default for this invoice

#### Scenario: New customer inherits Settings default

- **WHEN** the user loads a saved customer from the Recent dropdown whose record does NOT have a `language` field (e.g. a customer saved before this feature shipped)
- **THEN** the `Language` select keeps whatever value it already has (does not clobber to Settings default), so the user sees the language they most recently worked in

#### Scenario: Manual override wins over cascade

- **WHEN** the user manually changes the `Language` select on the invoice form
- **THEN** the new value is used in `collectInvoice()` regardless of what the Settings default or loaded customer carried

#### Scenario: Language persists on the customer record at save

- **WHEN** the user sends an invoice successfully and `saveCustomer(buyer, language)` persists the buyer to localStorage
- **THEN** the persisted customer record includes the `language` field from the invoice form, so the next invoice to the same customer auto-fills correctly

#### Scenario: Language roundtrips through the invoice JSON

- **WHEN** any of `/api/validate`, `/api/send`, or `/api/preview-pdf` receives an invoice JSON body
- **THEN** the backend reads the top-level `language` field (if present) and passes it to `generate_ubl` / `render_pdf` unchanged, without any server-side cascade logic

### Requirement: Login page when the gate is enabled

When the login gate is enabled (`APP_PASSWORD_HASH` set), the webapp SHALL present a login page with a single password field to unauthenticated users, return them to the invoice form on successful login, and offer a logout control. When the gate is disabled, no login page or logout control SHALL be shown and the invoice form SHALL load directly as it does without this change.

#### Scenario: Unauthenticated user sees the login page

- **WHEN** the gate is enabled and an unauthenticated user opens the webapp
- **THEN** a login page with a single password field is displayed instead of the invoice form

#### Scenario: Successful login returns to the form

- **WHEN** the user submits the correct password on the login page
- **THEN** they are redirected to the invoice form and can use the app normally

#### Scenario: Failed login shows an error

- **WHEN** the user submits an incorrect password
- **THEN** an error message is shown and the user stays on the login page, with no detail leaking whether the field was empty versus wrong

#### Scenario: Logout control is available when gated

- **WHEN** the gate is enabled and the user is authenticated
- **THEN** a logout control is visible in the app header, and using it returns the user to the login page

#### Scenario: No login UI when the gate is disabled

- **WHEN** no `APP_PASSWORD_HASH` is set
- **THEN** the invoice form loads directly with no login page and no logout control

