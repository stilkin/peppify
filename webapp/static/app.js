/* ============================================================
   PEPPOL Invoice Composer — client-side logic
   Vanilla JS. State lives in the DOM and localStorage.
   ============================================================ */

// ---------- Constants ----------

// CSRF token for POST /api/send; empty string when the login gate is disabled.
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content || "";

const LS_KEYS = {
  defaults: "peppol_defaults",
  customers: "peppol_customers",
  templates: "peppol_line_templates",
  lastNumber: "peppol_last_invoice_number",
  sellerContact: "peppol_seller_contact",
  sellerBank: "peppol_seller_bank",
  embedPdf: "peppol_embed_pdf",
};

const DEFAULT_DEFAULTS = {
  currency: "EUR",
  language: "en",
  payment_terms: "Net 21 days",
  due_days: 21,
  tax_category: "E",
  tax_percent: 0,
};

const SUPPORTED_LANGUAGES = ["en", "nl", "fr", "de"];

// UBL VAT category codes (D.16B). Visible label = "code — meaning".
const TAX_CATEGORIES = [
  ["S",  "S — Standard rate"],
  ["E",  "E — Exempt"],
  ["O",  "O — Outside scope"],
  ["Z",  "Z — Zero rated"],
  ["AE", "AE — Reverse charge"],
  ["K",  "K — Intra-EU"],
  ["G",  "G — Export"],
  ["L",  "L — Canary Is. (IGIC)"],
  ["M",  "M — Ceuta/Melilla"],
];

// UN/ECE Rec 20 unit codes accepted by EN-16931 / PEPPOL BIS Billing 3.0.
// Strict select — picking from this list guarantees BR-CL-23 compliance.
const UNIT_CODES = [
  ["EA",  "EA — each"],
  ["C62", "C62 — piece"],
  ["HUR", "HUR — hour"],
  ["MIN", "MIN — minute"],
  ["DAY", "DAY — day"],
  ["WEE", "WEE — week"],
  ["MON", "MON — month"],
  ["ANN", "ANN — year"],
  ["KGM", "KGM — kilogram"],
  ["GRM", "GRM — gram"],
  ["LTR", "LTR — litre"],
  ["MTR", "MTR — metre"],
  ["MTK", "MTK — square metre"],
  ["MTQ", "MTQ — cubic metre"],
  ["KMT", "KMT — kilometre"],
  ["KWH", "KWH — kilowatt-hour"],
];
const UNIT_CODE_SET = new Set(UNIT_CODES.map(([c]) => c));

// ---------- Dirty tracking ----------
// Flipped to `true` after a successful Send. Any user input on a form field
// bubbles up to the listener wired in init() and flips it back to `false`.
// Programmatic `.value = ...` assignments (e.g. the auto-advanced invoice
// number after send) do NOT fire input events, so they don't trip this.
// The clearInvoice() flow reads this to decide whether to confirm before
// wiping the form — a freshly-sent invoice is safe to clear without asking.
let invoiceSent = false;

// ---------- Tiny helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const lsGet = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};

const lsSet = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const todayISO = () => new Date().toISOString().slice(0, 10);

const addDays = (isoDate, days) => {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const fmt = (n) => Number(n || 0).toFixed(2);

// ---------- Defaults ----------

function getDefaults() {
  return { ...DEFAULT_DEFAULTS, ...lsGet(LS_KEYS.defaults, {}) };
}

function saveDefaults(defaults) {
  lsSet(LS_KEYS.defaults, defaults);
}

// ---------- Seller contact (local-only) ----------

function getSellerContact() {
  return lsGet(LS_KEYS.sellerContact, { name: "", email: "", phone: "" });
}

function saveSellerContact(contact) {
  lsSet(LS_KEYS.sellerContact, contact);
}

// ---------- Seller bank account (local-only) ----------

function getSellerBank() {
  return lsGet(LS_KEYS.sellerBank, { iban: "", bic: "", account_name: "" });
}

function saveSellerBank(bank) {
  lsSet(LS_KEYS.sellerBank, bank);
}

// ---------- PDF embedding toggle (local-only) ----------
// Defaults to true on first run: a sent invoice should carry a visual.

function getEmbedPdf() {
  return lsGet(LS_KEYS.embedPdf, true);
}

function saveEmbedPdf(value) {
  lsSet(LS_KEYS.embedPdf, Boolean(value));
}

// ---------- Invoice number ----------

function nextInvoiceNumber() {
  const last = lsGet(LS_KEYS.lastNumber, null);
  if (!last) return `INV-${new Date().getFullYear()}-001`;
  const m = String(last).match(/^(.*?)(\d+)$/);
  if (!m) return `${last}-1`;
  const prefix = m[1];
  const width = m[2].length;
  const next = String(Number(m[2]) + 1).padStart(width, "0");
  return prefix + next;
}

// ---------- Customers ----------

function loadCustomers() { return lsGet(LS_KEYS.customers, []); }

// Stable key so edits to a known customer overwrite instead of creating dupes.
// Prefers endpoint_scheme:endpoint_id (the participant ID), falls back to VAT,
// then name.
function customerKey(buyer) {
  if (buyer.endpoint_id) {
    return `EP:${buyer.endpoint_scheme || "0208"}:${buyer.endpoint_id}`;
  }
  if (buyer.vat) return `VAT:${buyer.vat}`;
  if (buyer.name) return `NAME:${buyer.name}`;
  return null;
}

function saveCustomer(buyer, language) {
  const key = customerKey(buyer);
  if (!key) return;
  const customers = loadCustomers();
  const existing = customers.findIndex((c) => customerKey(c) === key);
  if (existing >= 0) customers.splice(existing, 1);
  // Persist the chosen PDF language on the record so a subsequent load
  // auto-fills it. Non-enumerable on setBuyer() because setBuyer only touches
  // [data-buyer] DOM fields.
  const record = language ? { ...buyer, language } : { ...buyer };
  customers.unshift(record);
  lsSet(LS_KEYS.customers, customers.slice(0, 50));
}

function deleteCustomerAt(index) {
  const customers = loadCustomers();
  if (index < 0 || index >= customers.length) return;
  customers.splice(index, 1);
  lsSet(LS_KEYS.customers, customers);
}

function renderCustomerDropdown() {
  const select = $("#recent-customers");
  select.innerHTML = '<option value="">— select customer —</option>';
  loadCustomers().forEach((c, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = c.name || c.endpoint_id || "(unnamed)";
    select.appendChild(opt);
  });
}

// ---------- Line templates ----------

function loadTemplates() { return lsGet(LS_KEYS.templates, []); }

function saveTemplate(line) {
  if (!line.description) return;
  const templates = loadTemplates();
  const existing = templates.findIndex((t) => t.description === line.description);
  if (existing >= 0) templates.splice(existing, 1);
  templates.unshift(line);
  lsSet(LS_KEYS.templates, templates.slice(0, 50));
}

function renderTemplateDropdown() {
  const select = $("#template-select");
  select.innerHTML = '<option value="">— load template —</option>';
  loadTemplates().forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = t.description;
    select.appendChild(opt);
  });
}

// ---------- Seller (read from /api/org-info) ----------

let sellerCache = null;

async function loadSeller() {
  const card = $("#seller-card");
  try {
    const resp = await fetch("/api/org-info");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const info = await resp.json();
    // Peppyrus currently returns the full country name ("Belgium"), but be
    // defensive in case they ever switch to ISO codes ("BE").
    const countryRaw = (info.country || "").trim().toLowerCase();
    const isBelgium = countryRaw === "be" || countryRaw.startsWith("belg");
    const enterpriseNumber = (info.VAT || "").replace(/^[A-Za-z]{2}/, "");
    const contact = getSellerContact();
    sellerCache = {
      name: info.name || "",
      registration_name: info.name || "",
      vat: info.VAT || "",
      endpoint_id: enterpriseNumber,
      endpoint_scheme: "0208",
      country: isBelgium ? "BE" : "",
      street: [info.street, info.houseNumber].filter(Boolean).join(" "),
      city: info.city || "",
      postal_code: info.zipCode || "",
      // BT-30 — Seller legal registration identifier.
      legal_id: enterpriseNumber,
      legal_id_scheme: isBelgium ? "0208" : "",
      // BT-41..43 — optional contact. Populated from the Settings modal.
      contact_name: contact.name || "",
      contact_email: contact.email || "",
      contact_phone: contact.phone || "",
    };
    renderSellerCard(info);
  } catch (err) {
    card.querySelector(".seller-name").textContent = "Could not load seller info";
    card.querySelector(".seller-address").textContent = String(err);
  }
}

function renderSellerCard(info) {
  const card = $("#seller-card");
  if (!sellerCache) return;
  card.querySelector(".seller-name").textContent = sellerCache.name || "—";
  card.querySelector(".seller-address").textContent =
    [
      sellerCache.street,
      [sellerCache.postal_code, sellerCache.city].filter(Boolean).join(" "),
      (info && info.country) || sellerCache.country,
    ]
      .filter(Boolean)
      .join(" · ");
  card.querySelector(".seller-id").textContent =
    `VAT ${sellerCache.vat || "—"}  ·  Endpoint ${sellerCache.endpoint_scheme}:${sellerCache.endpoint_id || "—"}`;
  const contactParts = [
    sellerCache.contact_name,
    sellerCache.contact_email,
    sellerCache.contact_phone,
  ].filter(Boolean);
  card.querySelector(".seller-contact").textContent = contactParts.length
    ? `Contact: ${contactParts.join(" · ")}`
    : "";
}

// ---------- Buyer fields ----------

function setBuyer(buyer) {
  $$("[data-buyer]").forEach((input) => {
    const key = input.dataset.buyer;
    input.value = buyer[key] ?? "";
  });
}

function getBuyer() {
  const buyer = {};
  $$("[data-buyer]").forEach((input) => {
    const v = input.value.trim();
    if (v) buyer[input.dataset.buyer] = v;
  });
  return buyer;
}

// Strip whitespace, dots, dashes; remove leading 2-letter country prefix; uppercase.
function normalizeVat(input) {
  return String(input || "")
    .replace(/[\s./\-]/g, "")
    .replace(/^[A-Za-z]{2}/, "")
    .toUpperCase();
}

// Pick the first non-empty name from a Businesscard entity.
function firstName(entity) {
  if (!entity || !Array.isArray(entity.name)) return "";
  for (const n of entity.name) if (n && n.name) return n.name;
  return "";
}

// Find an identifier value by scheme name (case-insensitive).
function findIdentifier(entity, scheme) {
  if (!entity || !Array.isArray(entity.identifiers)) return "";
  const hit = entity.identifiers.find(
    (i) => (i.scheme || "").toUpperCase() === scheme.toUpperCase(),
  );
  return hit ? hit.value : "";
}

// PEPPOL directory only stores a free-text geoInfo like "Herentals, Belgium".
// Split on commas: first part is the city (best effort).
function cityFromGeoInfo(geoInfo) {
  if (!geoInfo) return "";
  return String(geoInfo).split(",")[0].trim();
}

// Inline feedback for the VAT lookup, shown right under the lookup row (close to
// the action) rather than in the global #result-panel at the bottom of the page.
function setLookupStatus(kind, message) {
  const el = $("#lookup-status");
  if (!kind) {
    el.hidden = true;
    el.textContent = "";
    el.className = "lookup-status";
    return;
  }
  el.hidden = false;
  el.className = "lookup-status " + kind;
  el.textContent = message;
}

async function lookupBuyer() {
  const country = ($("#lookup-country").value || "BE").trim().toUpperCase();
  const vat = normalizeVat($("#lookup-vat").value);
  if (!vat || !country) return;

  // Reflect the cleaned value back so the user sees what we actually sent.
  $("#lookup-vat").value = vat;

  const btn = $("#lookup-btn");
  btn.disabled = true;
  btn.textContent = "Looking up…";
  setLookupStatus(null, "");

  try {
    // 1. Resolve VAT → participantId
    const lookupResp = await fetch(
      `/api/lookup?vatNumber=${encodeURIComponent(vat)}&countryCode=${encodeURIComponent(country)}`,
    );
    const lookupData = await lookupResp.json();
    if (!lookupResp.ok) {
      // 404 = no participant resolves for this VAT in the active environment
      // (notably, the test directory does not resolve legal VAT numbers).
      const msg =
        lookupResp.status === 404
          ? `No PEPPOL participant found for ${country} ${vat}.`
          : lookupData.error || `Lookup failed (HTTP ${lookupResp.status}).`;
      throw new Error(msg);
    }

    const participantId = lookupData.participantId || "";
    const [scheme, id] = participantId.includes(":")
      ? participantId.split(":")
      : ["0208", vat];

    const buyer = getBuyer();
    buyer.vat = country + vat;
    buyer.country = country;
    buyer.endpoint_id = id;
    buyer.endpoint_scheme = scheme;

    // 2. Try to enrich with Businesscard data (name, country, geo)
    let enriched = false;
    if (participantId) {
      try {
        const bcResp = await fetch(
          `/api/business-card?participantId=${encodeURIComponent(participantId)}`,
        );
        if (bcResp.ok) {
          const bcData = await bcResp.json();
          const cards = Array.isArray(bcData) ? bcData : [];
          const entity = cards[0] && cards[0].entities && cards[0].entities[0];
          if (entity) {
            const name = firstName(entity);
            if (name) {
              if (!buyer.name) buyer.name = name;
              if (!buyer.registration_name) buyer.registration_name = name;
            }
            if (entity.countryCode && !buyer.country) {
              buyer.country = entity.countryCode.toUpperCase();
            }
            const vatId = findIdentifier(entity, "VAT");
            if (vatId && !buyer.vat) buyer.vat = vatId;
            const city = cityFromGeoInfo(entity.geoInfo);
            if (city && !buyer.city) buyer.city = city;
            enriched = true;
          }
        }
      } catch (e) { /* enrichment is best-effort */ }
    }

    setBuyer(buyer);
    const canReceive =
      lookupData.services && lookupData.services.length ? " · can receive invoices" : "";
    const enrichNote = enriched ? " · directory data filled in" : "";
    setLookupStatus("success", `Found ${participantId}${canReceive}${enrichNote}`);
  } catch (err) {
    setLookupStatus("error", String(err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Look up";
  }
}

// ---------- Line items ----------

function makeLineRow(line = {}) {
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <div class="line-desc-wrap">
      <input type="text" data-line="description" placeholder="Item description" class="line-desc-input">
      <div class="line-row-actions">
        <button type="button" class="save-tpl-btn" title="Save as template" aria-label="Save as template">★</button>
        <button type="button" class="remove-line" title="Remove line" aria-label="Remove line">×</button>
      </div>
    </div>
    <div class="line-fields">
      <div class="field-cell">
        <span class="micro">service date</span>
        <input type="date" data-line="service_date" class="mono">
      </div>
      <div class="field-cell">
        <span class="micro">qty</span>
        <input type="number" data-line="quantity" class="mono" min="0" step="0.01" value="1">
      </div>
      <div class="field-cell">
        <span class="micro">unit</span>
        <select data-line="unit" class="mono">
          ${UNIT_CODES.map(([code, label]) => `<option value="${code}">${label}</option>`).join("")}
        </select>
      </div>
      <div class="field-cell">
        <span class="micro">unit price</span>
        <input type="number" data-line="unit_price" class="mono" min="0" step="0.01" value="0.00">
      </div>
      <div class="field-cell">
        <span class="micro">vat cat.</span>
        <select data-line="tax_category">
          ${TAX_CATEGORIES.map(([code, label]) => `<option value="${code}">${label}</option>`).join("")}
        </select>
      </div>
      <div class="field-cell">
        <span class="micro">vat %</span>
        <input type="number" data-line="tax_percent" class="mono" min="0" step="any" value="0">
      </div>
      <div class="field-cell">
        <span class="micro">line total</span>
        <span class="line-total-cell mono">0.00</span>
      </div>
    </div>
  `;

  // Populate from line object. Coerce unknown unit codes to EA so stale
  // templates can never trigger BR-CL-23.
  Object.entries(line).forEach(([k, v]) => {
    const el = row.querySelector(`[data-line="${k}"]`);
    if (!el) return;
    if (k === "unit") {
      el.value = UNIT_CODE_SET.has(v) ? v : "EA";
    } else {
      el.value = v;
    }
  });

  // Apply defaults to the tax category/percent when creating a blank line
  if (Object.keys(line).length === 0) {
    const d = getDefaults();
    row.querySelector('[data-line="tax_category"]').value = d.tax_category;
    row.querySelector('[data-line="tax_percent"]').value = d.tax_percent;
  }

  // Recalculate on any input change
  row.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", recalcTotals);
  });

  // Remove button — clear the row if it's the only one.
  row.querySelector(".remove-line").addEventListener("click", () => {
    if ($$(".line-row").length > 1) row.remove();
    else clearLineRow(row);
    recalcTotals();
  });

  // Save-as-template button — stores the current row in localStorage.
  row.querySelector(".save-tpl-btn").addEventListener("click", () => {
    const data = readLine(row);
    if (!data.description) {
      showResult({
        kind: "error",
        title: "Cannot save template",
        summary: "Enter a description first.",
      });
      return;
    }
    // Dates belong to a specific invoice, not to a reusable template.
    delete data.service_date;
    saveTemplate(data);
    renderTemplateDropdown();
    const btn = row.querySelector(".save-tpl-btn");
    btn.classList.add("saved");
    btn.title = "Template saved";
    setTimeout(() => {
      btn.classList.remove("saved");
      btn.title = "Save as template";
    }, 1500);
  });

  return row;
}

function clearLineRow(row) {
  row.querySelectorAll("input").forEach((el) => {
    if (el.dataset.line === "quantity") el.value = "1";
    else if (el.dataset.line === "unit_price") el.value = "0.00";
    else if (el.dataset.line === "tax_percent") el.value = "0";
    else el.value = "";  // clears description, service_date, etc.
  });
  row.querySelector('[data-line="unit"]').value = "EA";
  row.querySelector('[data-line="tax_category"]').value = "E";
  row.querySelector(".line-total-cell").textContent = "0.00";
}

// Validate YYYY-MM-DD. Empty string is allowed (= unset). Bad input marks the
// element as aria-invalid and returns "" so the caller does not forward
// garbage to the backend (which would fail PEPPOL rule F001 after transmission).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readDateInput(el) {
  const value = el.value || "";
  if (value && !ISO_DATE_RE.test(value)) {
    el.setAttribute("aria-invalid", "true");
    return "";
  }
  el.removeAttribute("aria-invalid");
  return value;
}

function readLine(tr) {
  const line = {};
  tr.querySelectorAll("[data-line]").forEach((el) => {
    const key = el.dataset.line;
    if (el.type === "date") {
      line[key] = readDateInput(el);
      return;
    }
    line[key] = key === "quantity" || key === "unit_price" || key === "tax_percent" ? Number(el.value || 0) : el.value;
  });
  return line;
}

function recalcTotals() {
  const groups = new Map(); // key: cat|pct -> taxable
  let lineSum = 0;
  $$(".line-row").forEach((tr) => {
    const line = readLine(tr);
    const ext = (line.quantity || 0) * (line.unit_price || 0);
    tr.querySelector(".line-total-cell").textContent = fmt(ext);
    lineSum += ext;
    const key = `${line.tax_category}|${line.tax_percent}`;
    groups.set(key, (groups.get(key) || 0) + ext);
  });
  let taxTotal = 0;
  groups.forEach((taxable, key) => {
    const pct = Number(key.split("|")[1] || 0);
    taxTotal += (taxable * pct) / 100;
  });
  const currency = $("#currency").value || "EUR";
  $("#subtotal-display").textContent = fmt(lineSum);
  $("#tax-display").textContent = fmt(taxTotal);
  $("#grand-display").textContent = `${fmt(lineSum + taxTotal)} ${currency}`;
}

// ---------- Form collection ----------

function collectInvoice() {
  const lines = $$(".line-row").map((tr, i) => {
    const l = readLine(tr);
    return { id: String(i + 1), ...l };
  }).filter((l) => l.description || l.unit_price);

  const buyer = getBuyer();
  // Safety net: country codes must be uppercase (BR-CL-14).
  if (buyer.country) buyer.country = buyer.country.toUpperCase();

  // Auto-derive BT-47 (buyer legal registration identifier) from the VAT
  // number when the buyer is Belgian — the enterprise number is just the
  // VAT without the "BE" prefix, registered under scheme 0208.
  if (buyer.country === "BE" && buyer.vat && !buyer.legal_id) {
    buyer.legal_id = buyer.vat.replace(/^[A-Za-z]{2}/, "");
    buyer.legal_id_scheme = "0208";
  }

  // The seller may have been filled from Peppyrus; fall back to cache.
  const seller = { ...(sellerCache || {}) };
  if (seller.country) seller.country = seller.country.toUpperCase();

  const bank = getSellerBank();
  const payment_means = bank.iban
    ? {
        code: "30",
        iban: bank.iban,
        bic: bank.bic || undefined,
        account_name: bank.account_name || undefined,
      }
    : undefined;

  return {
    invoice_number: $("#invoice_number").value,
    issue_date: readDateInput($("#issue_date")),
    due_date: readDateInput($("#due_date")) || undefined,
    invoice_type_code: "380",
    currency: ($("#currency").value || "EUR").toUpperCase(),
    language: ($("#invoice-language").value || "en").toLowerCase(),
    payment_terms: $("#payment_terms").value || undefined,
    payment_means,
    seller,
    buyer,
    lines,
  };
}

// ---------- Send gate ----------
// Send stays disabled until the user has run Validate at least once with no
// FATAL rules. Subsequent edits do NOT re-disable — the server still catches
// any regression via its own validate_basic + validate_xsd pass on /api/send.

function setSendGate(state, message) {
  const btn = $("#send-btn");
  const hint = $("#send-hint");
  btn.disabled = state !== "ready";
  hint.textContent = message;
  hint.classList.toggle("ready", state === "ready");
  hint.classList.toggle("error", state === "error");
}

// ---------- Preview / Validate / Send ----------

async function doPreviewPdf() {
  const invoice = collectInvoice();
  setBusy("#preview-btn", "Rendering…");
  try {
    const resp = await fetch("/api/preview-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoice),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      showResult({
        kind: "error",
        title: "Preview failed",
        summary: escape(data.error || `HTTP ${resp.status}`),
      });
      return;
    }
    const blob = await resp.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  } catch (err) {
    showResult({ kind: "error", title: "Preview failed", summary: escape(String(err)) });
  } finally {
    clearBusy("#preview-btn", "Preview PDF");
  }
}

async function doValidate() {
  const invoice = collectInvoice();
  setBusy("#validate-btn", "Validating…");
  try {
    const resp = await fetch(`/api/validate?embed_pdf=${getEmbedPdf()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoice),
    });
    const data = await resp.json();
    const rules = data.rules || [];
    renderRules(rules);
    const fatal = rules.filter((r) => r.type === "FATAL");
    if (fatal.length === 0) {
      setSendGate("ready", "Ready to send");
    } else {
      setSendGate("error", `Fix ${fatal.length} FATAL rule${fatal.length === 1 ? "" : "s"}, then validate again`);
    }
  } catch (err) {
    showResult({ kind: "error", title: "Validation failed", summary: escape(String(err)) });
    setSendGate("error", "Validation request failed — try again");
  } finally {
    clearBusy("#validate-btn", "Validate");
  }
}

function deriveRecipient(buyer) {
  const scheme = (buyer.endpoint_scheme || "").trim();
  const id = (buyer.endpoint_id || "").trim();
  return scheme && id ? `${scheme}:${id}` : "";
}

async function doSend() {
  const invoice = collectInvoice();
  const recipient = deriveRecipient(invoice.buyer || {});
  if (!recipient) {
    showResult({
      kind: "error",
      title: "Missing buyer endpoint",
      summary: "Set the buyer's Scheme and Endpoint ID before sending.",
    });
    return;
  }
  setBusy("#send-btn", "Sending…");
  try {
    const resp = await fetch(`/api/send?embed_pdf=${getEmbedPdf()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF_TOKEN },
      body: JSON.stringify({ invoice, recipient }),
    });
    const data = await resp.json();
    if (resp.status === 422) {
      renderRules(data.rules || [], "Validation failed — invoice not sent");
      return;
    }
    if (!resp.ok) {
      showResult({
        kind: "error",
        title: `HTTP ${resp.status}`,
        summary: escape(JSON.stringify(data.response || data, null, 2)),
      });
      return;
    }
    const r = data.response || {};
    const msgId = r.id || "(no id)";
    showResult({
      kind: "success",
      title: "Invoice sent",
      summary: `Message ID <strong>${escape(msgId)}</strong> · Folder <strong>${escape(r.folder || "—")}</strong>`,
    });
    // On success: persist customer (with their PDF language) + advance invoice number
    saveCustomer(invoice.buyer, invoice.language);
    renderCustomerDropdown();
    lsSet(LS_KEYS.lastNumber, invoice.invoice_number);
    $("#invoice_number").value = nextInvoiceNumber();
    invoiceSent = true;
  } catch (err) {
    showResult({ kind: "error", title: "Send failed", summary: escape(String(err)) });
  } finally {
    clearBusy("#send-btn", "Send invoice");
  }
}

function setBusy(sel, label) {
  const btn = $(sel);
  btn.disabled = true;
  btn.dataset.originalLabel = btn.textContent;
  btn.textContent = label;
}

function clearBusy(sel, label) {
  const btn = $(sel);
  btn.disabled = false;
  btn.textContent = label;
}

// ---------- Result panel rendering ----------

// Callers MUST pre-escape any user- or network-controlled text before passing
// it in `title` or `summary` — both fields are interpolated directly into
// innerHTML to allow intentional `<strong>` / `<em>` styling. Use `escape(...)`
// for any dynamic substring; see existing callsites for the pattern.
function showResult({ kind, title, summary }) {
  const panel = $("#result-panel");
  panel.hidden = false;
  panel.className = "result-panel " + kind;
  panel.innerHTML = `
    <h3>${title}</h3>
    <p class="summary">${summary}</p>
  `;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderRules(rules, titleOverride) {
  const panel = $("#result-panel");
  panel.hidden = false;
  if (rules.length === 0) {
    panel.className = "result-panel success";
    panel.innerHTML = `
      <h3>Validation passed</h3>
      <p class="summary">No structural or XSD errors detected.</p>
    `;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const fatal = rules.filter((r) => r.type === "FATAL").length;
  const warn = rules.filter((r) => r.type === "WARNING").length;
  panel.className = "result-panel " + (fatal > 0 ? "error" : "success");
  panel.innerHTML = `
    <h3>${titleOverride || "Validation results"}</h3>
    <p class="meta">${fatal} fatal · ${warn} warning</p>
    <ul>
      ${rules.map((r) => `
        <li class="rule ${r.type === "WARNING" ? "warning" : ""}">
          <span class="badge">${r.type}</span>
          <span class="rule-id">${escape(r.id)}</span>
          <span class="rule-msg">${escape(r.message)}</span>
          <span class="rule-loc">${escape(r.location)}</span>
        </li>
      `).join("")}
    </ul>
  `;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function escape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------- Factory reset ----------

// Wipes every Peppify key from localStorage and reloads the page. Reload is
// the cleanest way to reinitialize every UI state at once (seller card,
// dropdowns, counter, form defaults) without manually reversing every init()
// side effect. Guarded by a confirm() in the caller.
function factoryReset() {
  Object.values(LS_KEYS).forEach((key) => localStorage.removeItem(key));
  window.location.reload();
}

// ---------- Clear / new invoice ----------

// Reset the form to a blank "new invoice" state. Preserves all persistent state
// (seller info, bank details, defaults, saved customers, line templates, invoice
// counter). Only wipes the per-invoice fields the user was composing.
function clearInvoice() {
  // Buyer block — setBuyer({}) clears all [data-buyer] inputs
  setBuyer({});
  // Restore the one buyer field that has a meaningful HTML default
  $('[data-buyer="endpoint_scheme"]').value = "0208";

  // Lookup controls — reset to their initial state
  $("#lookup-country").value = "BE";
  $("#lookup-vat").value = "";
  $("#lookup-vat").removeAttribute("aria-invalid");

  // Line items — remove all rows, add a single fresh one
  $("#line-items-body").innerHTML = "";
  $("#line-items-body").appendChild(makeLineRow());

  // Invoice meta — advance counter, reset dates and defaults
  const d = getDefaults();
  $("#invoice_number").value = nextInvoiceNumber();
  $("#issue_date").value = todayISO();
  $("#due_date").value = addDays(todayISO(), d.due_days);
  $("#currency").value = d.currency;
  $("#invoice-language").value = d.language || "en";
  $("#payment_terms").value = d.payment_terms;

  // Dropdowns back to their placeholder option
  $("#recent-customers").value = "";
  $("#template-select").value = "";
  $("#delete-customer-btn").disabled = true;

  // Recalculate totals (now 0.00) and hide any lingering result panel
  recalcTotals();
  const panel = $("#result-panel");
  panel.hidden = true;
  panel.innerHTML = "";

  // Send gate back to "needs validation"
  setSendGate("initial", "Click Validate first");

  // Finally, the form is fresh again — no unsaved send state
  invoiceSent = false;
}

// ---------- Settings modal ----------

function openSettings() {
  const d = getDefaults();
  $("#default-currency").value = d.currency;
  $("#default-language").value = d.language || "en";
  $("#default-payment-terms").value = d.payment_terms;
  $("#default-due-days").value = d.due_days;
  $("#default-tax-category").value = d.tax_category;
  $("#default-tax-percent").value = d.tax_percent;
  const bank = getSellerBank();
  $("#seller-iban").value = bank.iban || "";
  $("#seller-bic").value = bank.bic || "";
  $("#seller-account-name").value = bank.account_name || "";
  $("#embed-pdf-toggle").checked = getEmbedPdf();
  const contact = getSellerContact();
  $("#seller-contact-name").value = contact.name || "";
  $("#seller-contact-email").value = contact.email || "";
  $("#seller-contact-phone").value = contact.phone || "";
  $("#settings-modal").showModal();
}

function saveSettingsFromModal() {
  saveDefaults({
    currency: $("#default-currency").value || "EUR",
    language: $("#default-language").value || "en",
    payment_terms: $("#default-payment-terms").value,
    due_days: Number($("#default-due-days").value || 21),
    tax_category: $("#default-tax-category").value || "E",
    tax_percent: Number($("#default-tax-percent").value || 0),
  });
  saveSellerBank({
    iban: $("#seller-iban").value.trim(),
    bic: $("#seller-bic").value.trim(),
    account_name: $("#seller-account-name").value.trim(),
  });
  saveEmbedPdf($("#embed-pdf-toggle").checked);
  saveSellerContact({
    name: $("#seller-contact-name").value,
    email: $("#seller-contact-email").value,
    phone: $("#seller-contact-phone").value,
  });
  // Re-apply contact to sellerCache + refresh the card
  if (sellerCache) {
    const c = getSellerContact();
    sellerCache.contact_name = c.name;
    sellerCache.contact_email = c.email;
    sellerCache.contact_phone = c.phone;
    renderSellerCard(null);
  }
  $("#settings-modal").close();
  applyDefaultsToForm();
}

function applyDefaultsToForm() {
  const d = getDefaults();
  if (!$("#currency").value) $("#currency").value = d.currency;
  if (!$("#invoice-language").value) $("#invoice-language").value = d.language || "en";
  if (!$("#payment_terms").value) $("#payment_terms").value = d.payment_terms;
  if (!$("#due_date").value && $("#issue_date").value) {
    $("#due_date").value = addDays($("#issue_date").value, d.due_days);
  }
}

// ---------- Initialization ----------

function init() {
  // Uppercase-as-you-type for ISO code fields (country, currency, tax category).
  $$("[data-uppercase]").forEach((el) => {
    el.addEventListener("input", () => {
      const caret = el.selectionStart;
      el.value = el.value.toUpperCase();
      if (caret !== null) el.setSelectionRange(caret, caret);
    });
  });

  // Populate the settings-modal tax category select from the shared constant.
  $("#default-tax-category").innerHTML = TAX_CATEGORIES
    .map(([code, label]) => `<option value="${code}">${label}</option>`)
    .join("");

  // Populate header form fields
  $("#invoice_number").value = nextInvoiceNumber();
  $("#issue_date").value = todayISO();

  applyDefaultsToForm();

  // Update due date when issue date changes
  $("#issue_date").addEventListener("change", () => {
    const d = getDefaults();
    $("#due_date").value = addDays($("#issue_date").value, d.due_days);
  });

  // Currency drives totals display
  $("#currency").addEventListener("input", recalcTotals);

  // Initial empty line
  $("#line-items-body").appendChild(makeLineRow());
  recalcTotals();

  // Add line button
  $("#add-line-btn").addEventListener("click", () => {
    $("#line-items-body").appendChild(makeLineRow());
    recalcTotals();
  });

  // Recent customers
  renderCustomerDropdown();
  $("#recent-customers").addEventListener("change", (e) => {
    const i = e.target.value;
    $("#delete-customer-btn").disabled = i === "";
    if (i === "") return;
    const record = loadCustomers()[Number(i)];
    if (!record) return;
    // Language rides alongside the buyer fields on the saved record, but
    // setBuyer() only iterates [data-buyer] inputs so it naturally ignores it.
    // Pull it out explicitly and apply to the invoice-language dropdown.
    const { language, ...buyer } = record;
    setBuyer(buyer);
    if (language && SUPPORTED_LANGUAGES.includes(language)) {
      $("#invoice-language").value = language;
    }
  });

  // Delete the currently selected customer from the recent list.
  $("#delete-customer-btn").addEventListener("click", () => {
    const sel = $("#recent-customers");
    if (!sel.value) return;
    const idx = Number(sel.value);
    const customer = loadCustomers()[idx];
    if (!customer) return;
    const label = customer.name || customer.endpoint_id || "this customer";
    if (!confirm(`Delete "${label}" from recent customers?`)) return;
    deleteCustomerAt(idx);
    renderCustomerDropdown();
    sel.value = "";
    $("#delete-customer-btn").disabled = true;
  });

  // Templates
  renderTemplateDropdown();
  $("#template-select").addEventListener("change", (e) => {
    const i = e.target.value;
    if (i === "") return;
    const tpl = loadTemplates()[Number(i)];
    if (tpl) {
      const tr = makeLineRow(tpl);
      $("#line-items-body").appendChild(tr);
      recalcTotals();
    }
    e.target.value = "";
  });

  // Lookup
  $("#lookup-btn").addEventListener("click", lookupBuyer);
  $("#lookup-vat").addEventListener("keydown", (e) => { if (e.key === "Enter") lookupBuyer(); });

  // Validate / Send
  $("#preview-btn").addEventListener("click", doPreviewPdf);
  $("#validate-btn").addEventListener("click", doValidate);
  $("#send-btn").addEventListener("click", doSend);

  // Send stays disabled until the user has validated successfully at least once.
  setSendGate("initial", "Click Validate first");

  // Settings modal
  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-cancel").addEventListener("click", () => $("#settings-modal").close());
  $("#settings-save").addEventListener("click", saveSettingsFromModal);

  // Factory reset — wipes every Peppify key and reloads the page.
  $("#factory-reset-btn").addEventListener("click", () => {
    const confirmed = confirm(
      "Reset all Peppify data? This permanently deletes your saved defaults, " +
        "bank details, contact info, recent customers, line templates, and invoice counter. " +
        "This cannot be undone.",
    );
    if (confirmed) factoryReset();
  });

  // New / clear invoice — confirm only when the current draft hasn't been sent yet
  $("#new-btn").addEventListener("click", () => {
    if (invoiceSent) {
      clearInvoice();
      return;
    }
    if (confirm("Start a new invoice? Your current draft will be discarded.")) {
      clearInvoice();
    }
  });

  // Dirty tracking — any real user input on the invoice composer clears the
  // "already sent" flag so the next clearInvoice() call prompts again.
  // Programmatic .value = assignments don't fire input events, so the
  // post-send auto-advance of #invoice_number won't trip this.
  const paper = document.querySelector("main.paper");
  paper.addEventListener("input", () => { invoiceSent = false; });
  paper.addEventListener("change", () => { invoiceSent = false; });

  // Seller info
  loadSeller();
}

document.addEventListener("DOMContentLoaded", init);
