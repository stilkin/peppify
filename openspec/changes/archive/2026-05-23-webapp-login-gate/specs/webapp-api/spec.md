## ADDED Requirements

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
