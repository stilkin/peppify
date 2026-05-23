"""Flask webapp for the Peppol invoice sender.

Single-page form for creating, validating and sending PEPPOL invoices.
Reuses the `peppol_sender` package as a library; localStorage in the
browser persists customer/template/defaults state.
"""

from __future__ import annotations

import os
import secrets
from io import BytesIO
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.security import check_password_hash

from peppol_sender.api import (
    get_org_info,
    lookup_participant,
    package_message,
    search_business_card,
    send_message,
)
from peppol_sender.pdf import render_pdf
from peppol_sender.ubl import generate_ubl
from peppol_sender.validator import validate_basic, validate_xsd

load_dotenv()

_DEFAULT_BASE_URL = "https://api.test.peppyrus.be/v1"
_PROCESS_TYPE = "cenbii-procid-ubl::urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
_DOCUMENT_TYPE = (
    "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    "::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1"
)

app = Flask(__name__)

# Session signing key. Read from the environment so sessions survive restarts;
# fall back to a random key (with a warning) so the app still works out of the box.
_secret = os.getenv("SECRET_KEY")
if not _secret:
    _secret = secrets.token_hex(32)
    app.logger.warning(
        "No SECRET_KEY set; using a random one. Sessions and CSRF tokens will "
        "not survive a restart (you will be logged out). Set SECRET_KEY in .env "
        "to make them persistent."
    )
app.secret_key = _secret
# HttpOnly + SameSite=Lax protect the session cookie. Secure is off by default
# because the gate is expected to run over plain HTTP on a trusted LAN (a Secure
# cookie would not be sent over HTTP and would silently break login); set
# SESSION_COOKIE_SECURE=true in the environment when serving behind TLS.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "").lower() in ("1", "true", "yes"),
)


def _gate_enabled() -> bool:
    """The login gate is on iff a password hash is configured."""
    return bool(os.getenv("APP_PASSWORD_HASH"))


def _password_hash() -> str:
    """The configured password hash, with Docker-Compose '$$' escapes collapsed.

    Werkzeug hashes use '$' as a separator, and Docker Compose interpolates '$'
    in .env values — so operators must double them to '$$'. A real hash never
    contains '$$', which makes collapsing here safe and lets a single .env work
    for both the Docker and the bare-metal/dev paths.
    """
    return os.getenv("APP_PASSWORD_HASH", "").replace("$$", "$")


# Early, loud warning for the most common gate misconfiguration: a hash whose
# '$' were eaten by Compose interpolation (set in a Docker .env without doubling).
# Runs at import so it also fires under gunicorn in the container.
if _gate_enabled() and _password_hash().count("$") < 2:
    app.logger.warning(
        "APP_PASSWORD_HASH does not look like a valid password hash; login will "
        "fail. If you set it in a Docker Compose .env, double each '$' to '$$' "
        "(Compose interpolates '$'), or regenerate it with the one-liner in .env.example."
    )


def _csrf_ok() -> bool:
    """True if the request carries the session's CSRF token in X-CSRFToken."""
    expected = session.get("csrf_token", "")
    token = request.headers.get("X-CSRFToken", "")
    return bool(expected) and secrets.compare_digest(token, expected)


def warn_if_exposed() -> None:
    """Warn (don't refuse) when bound to a non-loopback interface with no gate."""
    host = os.getenv("BIND_HOST", "127.0.0.1")
    loopback = host.startswith("127.") or host in ("localhost", "::1", "")
    if not loopback and not _gate_enabled():
        app.logger.warning(
            "Webapp bound to %s with NO login gate (APP_PASSWORD_HASH unset) — it is "
            "exposed without authentication. Set APP_PASSWORD_HASH to enable the gate.",
            host,
        )


@app.before_request
def _require_auth() -> Any:
    """When the gate is on, require an authenticated session for all routes
    except login/logout and static assets."""
    if not _gate_enabled() or session.get("authenticated"):
        return None
    if request.endpoint in ("login", "logout", "static"):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Authentication required"}), 401
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login() -> Any:
    if not _gate_enabled():
        return redirect(url_for("index"))
    if request.method == "POST":
        password = request.form.get("password", "")
        if check_password_hash(_password_hash(), password):
            session["authenticated"] = True
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("index"))
        # Same message whether the field was empty or wrong — no info leak.
        return render_template("login.html", error="Incorrect password."), 401
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout() -> Any:
    session.clear()
    return redirect(url_for("login"))


@app.after_request
def _set_security_headers(response: Any) -> Any:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


def _creds() -> tuple[str, str, str] | None:
    """Read Peppyrus credentials from env. Returns None if API key is missing."""
    api_key = os.getenv("PEPPYRUS_API_KEY")
    sender_id = os.getenv("PEPPOL_SENDER_ID", "")
    base_url = os.getenv("PEPPYRUS_BASE_URL", _DEFAULT_BASE_URL)
    if not api_key:
        return None
    return api_key, sender_id, base_url


def _missing_credentials_response() -> tuple[Any, int]:
    return jsonify({"error": "Missing PEPPYRUS_API_KEY in environment"}), 500


@app.route("/")
def index() -> str:
    return render_template(
        "index.html",
        gate_enabled=_gate_enabled(),
        csrf_token=session.get("csrf_token", ""),
    )


@app.route("/api/org-info")
def api_org_info() -> tuple[Any, int]:
    creds = _creds()
    if creds is None:
        return _missing_credentials_response()
    api_key, _, base_url = creds
    resp = get_org_info(api_key, base_url)
    return jsonify(resp["json"]), resp["status_code"]


@app.route("/api/lookup")
def api_lookup() -> tuple[Any, int]:
    creds = _creds()
    if creds is None:
        return _missing_credentials_response()
    api_key, _, base_url = creds
    vat_number = request.args.get("vatNumber", "")
    country_code = request.args.get("countryCode", "")
    if not vat_number or not country_code:
        return jsonify({"error": "vatNumber and countryCode are required"}), 400
    resp = lookup_participant(vat_number, country_code, api_key, base_url)
    return jsonify(resp["json"]), resp["status_code"]


@app.route("/api/business-card")
def api_business_card() -> tuple[Any, int]:
    creds = _creds()
    if creds is None:
        return _missing_credentials_response()
    api_key, _, base_url = creds
    participant_id = request.args.get("participantId", "")
    if not participant_id:
        return jsonify({"error": "participantId is required"}), 400
    resp = search_business_card(participant_id, api_key, base_url)
    return jsonify(resp["json"]), resp["status_code"]


def _read_embed_pdf_flag() -> bool:
    """Read ?embed_pdf=true|false from the query string. Defaults to True."""
    return request.args.get("embed_pdf", "true").lower() != "false"


def _validate_invoice(invoice: dict[str, Any], *, embed_pdf: bool = True) -> tuple[bytes, list[dict]]:
    xml = generate_ubl(invoice, embed_pdf=embed_pdf)
    rules = validate_basic(xml) + validate_xsd(xml)
    return xml, rules


@app.route("/api/preview-pdf", methods=["POST"])
def api_preview_pdf() -> Any:
    invoice = request.get_json(silent=True) or {}
    try:
        pdf_bytes = render_pdf(invoice)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    filename = f"{invoice.get('invoice_number', 'invoice')}.pdf"
    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=False,
        download_name=filename,
    )


@app.route("/api/validate", methods=["POST"])
def api_validate() -> tuple[Any, int]:
    invoice = request.get_json(silent=True) or {}
    _, rules = _validate_invoice(invoice, embed_pdf=_read_embed_pdf_flag())
    return jsonify({"rules": rules}), 200


@app.route("/api/send", methods=["POST"])
def api_send() -> tuple[Any, int]:
    if _gate_enabled() and not _csrf_ok():
        return jsonify({"error": "Invalid or missing CSRF token"}), 403
    creds = _creds()
    if creds is None:
        return _missing_credentials_response()
    api_key, sender_id, base_url = creds
    if not sender_id:
        return jsonify({"error": "Missing PEPPOL_SENDER_ID in environment"}), 500

    body = request.get_json(silent=True) or {}
    invoice = body.get("invoice", {})
    recipient = body.get("recipient", "")
    if not recipient:
        return jsonify({"error": "recipient is required"}), 400

    xml, rules = _validate_invoice(invoice, embed_pdf=_read_embed_pdf_flag())
    fatal = [r for r in rules if r["type"] == "FATAL"]
    if fatal:
        return jsonify({"rules": rules, "error": "Validation failed"}), 422

    message = package_message(xml, sender_id, recipient, _PROCESS_TYPE, _DOCUMENT_TYPE)
    resp = send_message(message, api_key, base_url)
    return jsonify({"rules": rules, "response": resp["json"]}), resp["status_code"]


if __name__ == "__main__":
    host = os.getenv("BIND_HOST", "127.0.0.1")
    port = int(os.getenv("BIND_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    warn_if_exposed()
    app.run(host=host, port=port, debug=debug)
