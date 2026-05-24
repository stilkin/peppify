## ADDED Requirements

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
