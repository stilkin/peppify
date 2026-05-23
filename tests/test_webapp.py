"""Tests for the Flask webapp."""

from collections.abc import Iterator
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from flask.testing import FlaskClient
from werkzeug.test import TestResponse

from webapp.app import app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    monkeypatch.setenv("PEPPYRUS_API_KEY", "test-key")
    monkeypatch.setenv("PEPPOL_SENDER_ID", "0208:0123456789")
    monkeypatch.setenv("PEPPYRUS_BASE_URL", "https://api.test.peppyrus.be/v1")
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def client_no_creds(monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    monkeypatch.delenv("PEPPYRUS_API_KEY", raising=False)
    monkeypatch.delenv("PEPPOL_SENDER_ID", raising=False)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _mock_session(method: str, status: int, json_payload: object) -> MagicMock:
    """Build a mock session whose .get() or .post() returns the given response."""
    mock_resp = MagicMock()
    mock_resp.status_code = status
    mock_resp.json.return_value = json_payload
    mock_session = MagicMock()
    getattr(mock_session, method).return_value = mock_resp
    return mock_session


# ---------- GET / ----------


def test_index_returns_form(client: FlaskClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "Invoice Composer" in body
    assert "Bill to" in body
    assert "line-items-body" in body


# ---------- /api/org-info ----------


@patch("peppol_sender.api._session")
def test_org_info_success(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session(
        "get",
        200,
        {"name": "POCITO", "VAT": "BE0674415660"},
    )
    resp = client.get("/api/org-info")
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "POCITO"


def test_org_info_missing_credentials(client_no_creds: FlaskClient) -> None:
    resp = client_no_creds.get("/api/org-info")
    assert resp.status_code == 500
    assert "Missing" in resp.get_json()["error"]


# ---------- /api/lookup ----------


@patch("peppol_sender.api._session")
def test_lookup_success(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session(
        "get",
        200,
        {"participantId": "0208:be0123456789", "services": [{}]},
    )
    resp = client.get("/api/lookup?vatNumber=0123456789&countryCode=BE")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["participantId"] == "0208:be0123456789"


def test_lookup_missing_params(client: FlaskClient) -> None:
    resp = client.get("/api/lookup")
    assert resp.status_code == 400
    assert "required" in resp.get_json()["error"]


# ---------- /api/business-card ----------


@patch("peppol_sender.api._session")
def test_business_card_success(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session(
        "get",
        200,
        [{"entities": [{"name": [{"name": "POCITO"}], "countryCode": "BE"}]}],
    )
    resp = client.get("/api/business-card?participantId=0208:be0674415660")
    assert resp.status_code == 200
    cards = resp.get_json()
    assert cards[0]["entities"][0]["name"][0]["name"] == "POCITO"


def test_business_card_missing_param(client: FlaskClient) -> None:
    resp = client.get("/api/business-card")
    assert resp.status_code == 400


# ---------- /api/validate ----------


_VALID_INVOICE = {
    "invoice_number": "INV-001",
    "issue_date": "2025-01-01",
    "due_date": "2025-02-01",
    "currency": "EUR",
    "seller": {
        "name": "Seller",
        "registration_name": "Seller BV",
        "endpoint_id": "0123456789",
        "endpoint_scheme": "0208",
        "country": "BE",
    },
    "buyer": {
        "name": "Buyer",
        "registration_name": "Buyer BV",
        "endpoint_id": "987654321",
        "endpoint_scheme": "0208",
        "country": "NL",
    },
    "lines": [{"id": "1", "quantity": 1, "unit_price": 100.0, "tax_category": "E", "tax_percent": 0}],
}


def test_validate_passes_for_valid_invoice(client: FlaskClient) -> None:
    resp = client.post("/api/validate", json=_VALID_INVOICE)
    assert resp.status_code == 200
    assert resp.get_json() == {"rules": []}


def test_validate_returns_rules_for_empty_invoice(client: FlaskClient) -> None:
    resp = client.post("/api/validate", json={})
    assert resp.status_code == 200
    rules = resp.get_json()["rules"]
    assert len(rules) > 0
    assert any(r["type"] == "FATAL" for r in rules)


# ---------- /api/send ----------


@patch("peppol_sender.api._session")
def test_send_success(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session(
        "post",
        200,
        {"id": "msg-123", "folder": "outbox"},
    )
    resp = client.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["response"]["id"] == "msg-123"


def test_send_aborts_on_fatal_rules(client: FlaskClient) -> None:
    resp = client.post("/api/send", json={"invoice": {}, "recipient": "0208:be0674415660"})
    assert resp.status_code == 422
    data = resp.get_json()
    assert data["error"] == "Validation failed"
    assert any(r["type"] == "FATAL" for r in data["rules"])


def test_send_missing_recipient(client: FlaskClient) -> None:
    resp = client.post("/api/send", json={"invoice": _VALID_INVOICE})
    assert resp.status_code == 400
    assert "recipient" in resp.get_json()["error"]


def test_send_missing_credentials(client_no_creds: FlaskClient) -> None:
    resp = client_no_creds.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 500


# ---------- payment means / BR-50 ----------


_PAYMENT_MEANS_SAMPLE = {
    "code": "30",
    "iban": "BE68539007547034",
    "bic": "BBRUBEBB",
    "account_name": "Seller BV",
}


def test_validate_with_payment_means_passes(client: FlaskClient) -> None:
    invoice = {**_VALID_INVOICE, "payment_means": _PAYMENT_MEANS_SAMPLE}
    resp = client.post("/api/validate", json=invoice)
    assert resp.status_code == 200
    rules = resp.get_json()["rules"]
    assert not any(r["id"] == "LOCAL-BR-50" for r in rules)


def test_validate_with_partial_payment_means_triggers_br50(client: FlaskClient) -> None:
    invoice = {**_VALID_INVOICE, "payment_means": {"code": "30"}}
    resp = client.post("/api/validate", json=invoice)
    assert resp.status_code == 200
    rules = resp.get_json()["rules"]
    br50 = [r for r in rules if r["id"] == "LOCAL-BR-50"]
    assert len(br50) == 1
    assert br50[0]["type"] == "FATAL"


@patch("peppol_sender.api._session")
def test_send_routes_payment_means_through(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session(
        "post",
        200,
        {"id": "msg-pm-001"},
    )
    invoice = {**_VALID_INVOICE, "payment_means": _PAYMENT_MEANS_SAMPLE}
    resp = client.post(
        "/api/send",
        json={"invoice": invoice, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 200
    # The POST body sent to Peppyrus contains the base64-encoded XML; decode
    # and confirm the structured PayeeFinancialAccount/ID is present.
    import base64

    posted_kwargs = mock_session_fn.return_value.post.call_args.kwargs
    body = posted_kwargs["json"]
    xml = base64.b64decode(body["fileContent"]).decode("utf-8")
    assert "PayeeFinancialAccount" in xml
    assert "BE68539007547034" in xml
    assert "BBRUBEBB" in xml


# ---------- /api/preview-pdf ----------


def test_preview_pdf_returns_pdf(client: FlaskClient) -> None:
    resp = client.post("/api/preview-pdf", json=_VALID_INVOICE)
    assert resp.status_code == 200
    assert resp.mimetype == "application/pdf"
    assert resp.data.startswith(b"%PDF-")
    assert len(resp.data) > 1000


def test_preview_pdf_uses_invoice_number_as_filename(client: FlaskClient) -> None:
    resp = client.post("/api/preview-pdf", json=_VALID_INVOICE)
    assert resp.status_code == 200
    disposition = resp.headers.get("Content-Disposition", "")
    assert "INV-001.pdf" in disposition


@patch("peppol_sender.api._session")
def test_send_flow_embeds_pdf_in_xml(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    """/api/send routes through _validate_invoice with embed_pdf=True by default,
    so the sent XML must contain a cac:AdditionalDocumentReference block."""
    import base64

    mock_session_fn.return_value = _mock_session("post", 200, {"id": "msg-pdf-001"})
    resp = client.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 200
    posted_kwargs = mock_session_fn.return_value.post.call_args.kwargs
    xml = base64.b64decode(posted_kwargs["json"]["fileContent"]).decode("utf-8")
    assert "AdditionalDocumentReference" in xml
    assert "application/pdf" in xml


@patch("peppol_sender.api._session")
def test_send_flow_skips_pdf_when_embed_pdf_false(mock_session_fn: MagicMock, client: FlaskClient) -> None:
    """?embed_pdf=false on /api/send skips PDF embedding."""
    import base64

    mock_session_fn.return_value = _mock_session("post", 200, {"id": "msg-no-pdf"})
    resp = client.post(
        "/api/send?embed_pdf=false",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 200
    posted_kwargs = mock_session_fn.return_value.post.call_args.kwargs
    xml = base64.b64decode(posted_kwargs["json"]["fileContent"]).decode("utf-8")
    assert "AdditionalDocumentReference" not in xml


def test_validate_embed_pdf_false_omits_pdf(client: FlaskClient) -> None:
    """?embed_pdf=false on /api/validate skips PDF embedding — verified by the
    absence of side effects (no raising when WeasyPrint isn't exercised)."""
    # The validate route doesn't return the XML, so we assert it still returns
    # 200 with an empty rules list (i.e. the skipped-PDF path doesn't break
    # validation). This is a smoke check; the real observable is in /api/send.
    resp = client.post("/api/validate?embed_pdf=false", json=_VALID_INVOICE)
    assert resp.status_code == 200
    assert resp.get_json()["rules"] == []


# ---------- Login gate (APP_PASSWORD_HASH set) ----------

_GATE_PASSWORD = "correct horse battery staple"


@pytest.fixture
def gated_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    """Client with the login gate enabled and Peppyrus creds present."""
    from werkzeug.security import generate_password_hash

    monkeypatch.setenv("PEPPYRUS_API_KEY", "test-key")
    monkeypatch.setenv("PEPPOL_SENDER_ID", "0208:0123456789")
    monkeypatch.setenv("PEPPYRUS_BASE_URL", "https://api.test.peppyrus.be/v1")
    monkeypatch.setenv("APP_PASSWORD_HASH", generate_password_hash(_GATE_PASSWORD))
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _login(client: FlaskClient, password: str = _GATE_PASSWORD) -> TestResponse:
    return client.post("/login", data={"password": password})


def test_gate_redirects_unauthenticated_page(gated_client: FlaskClient) -> None:
    resp = gated_client.get("/")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_gate_blocks_unauthenticated_api(gated_client: FlaskClient) -> None:
    resp = gated_client.get("/api/org-info")
    assert resp.status_code == 401


def test_gate_login_page_reachable_without_auth(gated_client: FlaskClient) -> None:
    resp = gated_client.get("/login")
    assert resp.status_code == 200
    assert "Please sign in" in resp.get_data(as_text=True)


def test_gate_correct_password_unlocks(gated_client: FlaskClient) -> None:
    resp = _login(gated_client)
    assert resp.status_code == 302
    assert resp.headers["Location"] in ("/", "http://localhost/")
    # Session now authenticated — protected route reachable.
    assert gated_client.get("/").status_code == 200


def test_gate_wrong_password_rejected(gated_client: FlaskClient) -> None:
    resp = _login(gated_client, "wrong")
    assert resp.status_code == 401
    assert "Incorrect password" in resp.get_data(as_text=True)
    # No session established.
    assert gated_client.get("/").status_code == 302


def test_gate_logout_clears_session(gated_client: FlaskClient) -> None:
    _login(gated_client)
    assert gated_client.get("/").status_code == 200
    resp = gated_client.post("/logout")
    assert resp.status_code == 302
    assert gated_client.get("/").status_code == 302


@patch("peppol_sender.api._session")
def test_gated_send_with_valid_csrf_proceeds(mock_session_fn: MagicMock, gated_client: FlaskClient) -> None:
    mock_session_fn.return_value = _mock_session("post", 200, {"id": "msg-csrf-ok"})
    _login(gated_client)
    with gated_client.session_transaction() as sess:
        token = sess["csrf_token"]
    resp = gated_client.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
        headers={"X-CSRFToken": token},
    )
    assert resp.status_code == 200
    assert resp.get_json()["response"]["id"] == "msg-csrf-ok"


@patch("peppol_sender.api._session")
def test_gated_send_without_csrf_rejected(mock_session_fn: MagicMock, gated_client: FlaskClient) -> None:
    _login(gated_client)
    resp = gated_client.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
    )
    assert resp.status_code == 403
    # No Peppyrus call made.
    mock_session_fn.return_value.post.assert_not_called()


@patch("peppol_sender.api._session")
def test_gated_send_with_wrong_csrf_rejected(mock_session_fn: MagicMock, gated_client: FlaskClient) -> None:
    _login(gated_client)
    resp = gated_client.post(
        "/api/send",
        json={"invoice": _VALID_INVOICE, "recipient": "0208:be0674415660"},
        headers={"X-CSRFToken": "not-the-token"},
    )
    assert resp.status_code == 403
    mock_session_fn.return_value.post.assert_not_called()


# ---------- Exposure warning & bind config ----------


def test_warn_if_exposed_warns_when_unguarded(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from webapp.app import warn_if_exposed

    monkeypatch.setenv("BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("APP_PASSWORD_HASH", raising=False)
    with caplog.at_level("WARNING"):
        warn_if_exposed()
    assert any("exposed without authentication" in r.message for r in caplog.records)


def test_warn_if_exposed_silent_when_gated(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    from werkzeug.security import generate_password_hash

    from webapp.app import warn_if_exposed

    monkeypatch.setenv("BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("APP_PASSWORD_HASH", generate_password_hash("x"))
    with caplog.at_level("WARNING"):
        warn_if_exposed()
    assert not any("exposed without authentication" in r.message for r in caplog.records)


def test_warn_if_exposed_silent_on_loopback(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    from webapp.app import warn_if_exposed

    monkeypatch.setenv("BIND_HOST", "127.0.0.1")
    monkeypatch.delenv("APP_PASSWORD_HASH", raising=False)
    with caplog.at_level("WARNING"):
        warn_if_exposed()
    assert not any("exposed without authentication" in r.message for r in caplog.records)


def _load_gunicorn_conf() -> ModuleType:
    """Load the repo-root gunicorn.conf.py by path (it can't be imported as a
    module because the name collides with the installed `gunicorn` package)."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "gunicorn.conf.py"
    spec = importlib.util.spec_from_file_location("_gunicorn_conf", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_gunicorn_conf_default_bind(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BIND_HOST", raising=False)
    monkeypatch.delenv("BIND_PORT", raising=False)
    assert _load_gunicorn_conf().bind == "127.0.0.1:5000"


def test_gunicorn_conf_honors_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("BIND_PORT", "8080")
    assert _load_gunicorn_conf().bind == "0.0.0.0:8080"


# ---------- Gate scoping & UI wiring (behaviors coverage can't see) ----------


def test_gated_static_asset_bypasses_auth(gated_client: FlaskClient) -> None:
    """The login page must be able to load its own CSS, so /static/* is exempt."""
    resp = gated_client.get("/static/style.css")
    assert resp.status_code == 200


def test_gated_validate_does_not_require_csrf(gated_client: FlaskClient) -> None:
    """CSRF is scoped to /api/send only — /api/validate stays usable without a token."""
    _login(gated_client)
    resp = gated_client.post("/api/validate", json=_VALID_INVOICE)
    assert resp.status_code == 200
    assert resp.get_json()["rules"] == []


def test_login_redirects_when_gate_disabled(client: FlaskClient) -> None:
    """With no gate, /login is meaningless and bounces to the form."""
    resp = client.get("/login")
    assert resp.status_code == 302


def test_login_ui_hidden_when_gate_disabled(client: FlaskClient) -> None:
    body = client.get("/").get_data(as_text=True)
    assert 'aria-label="Log out"' not in body


def test_login_ui_and_csrf_token_present_when_authenticated(gated_client: FlaskClient) -> None:
    _login(gated_client)
    body = gated_client.get("/").get_data(as_text=True)
    assert 'aria-label="Log out"' in body
    # The per-session CSRF token is wired into the page for the SPA to read.
    with gated_client.session_transaction() as sess:
        token = sess["csrf_token"]
    assert token and token in body
