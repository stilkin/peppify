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

### Requirement: Optional single-password login gate

The webapp SHALL support an optional login gate enabled by the presence of a non-empty `APP_PASSWORD_HASH` environment variable. When enabled, all routes except the login/logout routes and `/static/*` SHALL require an authenticated session, and a request presenting the correct password SHALL establish a server-signed session. When `APP_PASSWORD_HASH` is unset, no authentication SHALL be enforced and the webapp SHALL behave as it does without this change.

#### Scenario: Gate disabled by default

- **WHEN** the webapp runs with no `APP_PASSWORD_HASH` set
- **THEN** every route is reachable without authentication, exactly as before this change, and no login page is presented

#### Scenario: Unauthenticated access is blocked when the gate is enabled

- **WHEN** `APP_PASSWORD_HASH` is set and an unauthenticated client requests a protected page route
- **THEN** the client is redirected to the login page; and an unauthenticated request to an `/api/*` route receives HTTP `401`

#### Scenario: Correct password establishes a session

- **WHEN** `APP_PASSWORD_HASH` is set and a client submits the correct password to the login route
- **THEN** the password is verified against the hash with `check_password_hash`, a server-signed session cookie is set, and protected routes become reachable for that session

#### Scenario: Incorrect password is rejected

- **WHEN** a client submits an incorrect password to the login route
- **THEN** no session is established and the client remains unauthenticated

#### Scenario: Logout clears the session

- **WHEN** an authenticated client invokes the logout route
- **THEN** the session is cleared and subsequent requests to protected routes are treated as unauthenticated

#### Scenario: Login page and static assets are reachable without auth

- **WHEN** the gate is enabled and an unauthenticated client requests the login page or a `/static/*` asset
- **THEN** the request succeeds, so the login page can render its own CSS/JS

#### Scenario: Session signing key falls back with a warning

- **WHEN** the webapp starts with no `SECRET_KEY` set
- **THEN** a random signing key is generated at startup and a warning is logged that sessions (and CSRF tokens) will not persist across restarts

### Requirement: CSRF protection on send when the gate is enabled

When the login gate is enabled, the webapp SHALL require a valid session-bound CSRF token on `POST /api/send` and SHALL reject requests lacking it before any Peppyrus transmission. When the gate is disabled, `/api/send` SHALL behave as it does without this change.

#### Scenario: Gated send with a valid token proceeds

- **WHEN** the gate is enabled and an authenticated client POSTs to `/api/send` with a valid CSRF token (e.g. an `X-CSRFToken` header)
- **THEN** the request is processed normally (generate, validate, send)

#### Scenario: Gated send without a valid token is rejected

- **WHEN** the gate is enabled and a request to `/api/send` is missing or carries an invalid CSRF token
- **THEN** the request is rejected with a `400`/`403` and no Peppyrus API call is made

#### Scenario: Send is unaffected when the gate is disabled

- **WHEN** no `APP_PASSWORD_HASH` is set
- **THEN** `POST /api/send` requires no CSRF token and behaves as it does today

### Requirement: Startup warning for unguarded non-loopback binding

When the webapp is configured to bind to a non-loopback interface and no `APP_PASSWORD_HASH` is set, the webapp SHALL emit a prominent warning at startup that it is exposed without authentication. It SHALL warn rather than refuse to start.

#### Scenario: Exposed without a gate warns

- **WHEN** `BIND_HOST` resolves to a non-loopback address and `APP_PASSWORD_HASH` is unset
- **THEN** a prominent warning is logged at startup and the app still starts

#### Scenario: Exposed with a gate does not warn

- **WHEN** `BIND_HOST` is non-loopback and `APP_PASSWORD_HASH` is set
- **THEN** no such warning is emitted

#### Scenario: Loopback binding does not warn

- **WHEN** the app binds to a loopback address (the default)
- **THEN** no exposure warning is emitted regardless of whether a password is set

