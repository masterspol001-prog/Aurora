# Production Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aurora Ledger safe to run as a real ledger by adding an explicit production/demo mode, guarding destructive actions, gating invoice issuance on a confirmed tax profile, validating every server write, tying every figure to the ledger, adding loading/error/empty states, and blocking period close on unresolved errors.

**Architecture:** Mode-aware shell plus shared validation. The server imports the existing DOM-free `engine.js` so business rules have one source of truth. One codebase, no build step, no new dependencies.

**Tech Stack:** Vanilla ES modules (`index.html`, `engine.js`, `store.js`), zero-dependency Node `http` + `node:sqlite` backend, `node:test` for tests.

## Global Constraints

- No build step, no new runtime dependencies.
- Exact integer minor units; never float arithmetic on money.
- Every existing route id keeps working; demo mode behaves exactly as before.
- No emoji in UI; ASCII arrows (`&rarr;`) only.
- Do not commit to git (the workspace convention for this prototype).
- `npm test`, `npm run test:server`, `npm run test:all` must stay green; engine audit 0 findings.
- Env: `LEDGER_MODE` (`production` default, `demo` opt-in).

---

### Task 1: Engine - tax profile, close guard, figure source

**Files:**
- Modify: `engine.js` (append near the other exported helpers)
- Test: `test/engine.test.mjs`

**Interfaces:**
- Consumes: `taxRegime(id)`, `TAX_REGIMES`, `validateTaxId(id, regimeId)`, `validateJournal(entry)`.
- Produces:
  - `taxProfileReady({ country, regimeId, currency, taxId }) -> { ready: boolean, missing: string[] }`
  - `closeBlockers({ invoices, journals, quarantine, today }) -> { key, label, detail }[]`
  - `closeWarnings({ invoices, journals, bankTxns, period, today }) -> { key, label, detail }[]`
  - `figureSource(key) -> { label, formula, inputs }`

- [ ] **Step 1: Write the failing tests** in `test/engine.test.mjs`

```javascript
test("taxProfileReady requires country, regime, currency and a valid id", () => {
  assert.equal(taxProfileReady({ country: "IN", regimeId: "IN_GST", currency: "INR", taxId: "27AAPFU0939F1ZV" }).ready, true);
  const bad = taxProfileReady({ country: "IN", regimeId: "IN_GST", currency: "INR", taxId: "nope" });
  assert.equal(bad.ready, false);
  assert.ok(bad.missing.includes("taxId"));
  assert.equal(taxProfileReady({ country: "US", regimeId: "NONE", currency: "USD", taxId: "" }).ready, true);
});

test("closeBlockers flags unbalanced and pending journals plus mismatches", () => {
  const unbalanced = { id: "j1", source: "manual", approval: { status: "approved" }, lines: [{ account: "1000", debitPaise: 100, creditPaise: 0 }, { account: "4000", debitPaise: 0, creditPaise: 90 }] };
  const pending = { id: "j2", source: "manual", approval: { status: "pending" }, lines: [{ account: "1000", debitPaise: 100, creditPaise: 0 }, { account: "4000", debitPaise: 0, creditPaise: 100 }] };
  const mism = { id: "inv_m", number: "INV-M", mismatch: true, status: "issued" };
  const b = closeBlockers({ invoices: [mism], journals: [unbalanced, pending], quarantine: [], today: "2026-10-31" });
  const keys = b.map((x) => x.key);
  assert.ok(keys.includes("journal_unbalanced"));
  assert.ok(keys.includes("journal_pending"));
  assert.ok(keys.includes("payment_mismatch"));
  assert.equal(closeBlockers({ invoices: [], journals: [], quarantine: [], today: "2026-10-31" }).length, 0);
});

test("figureSource names the derivation for known figures", () => {
  const f = figureSource("outstanding");
  assert.ok(f && f.formula && Array.isArray(f.inputs));
  assert.equal(figureSource("does_not_exist"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/engine.test.mjs`
Expected: FAIL — `taxProfileReady is not a function`.

- [ ] **Step 3: Implement** in `engine.js`

```javascript
export function taxProfileReady({ country = "", regimeId = "IN_GST", currency = "", taxId = "" } = {}) {
  const missing = [];
  if (!country) missing.push("country");
  if (!regimeId) missing.push("regimeId");
  if (!currency) missing.push("currency");
  if (regimeId && regimeId !== "NONE") {
    const check = taxId ? validateTaxId(taxId, regimeId) : { valid: false, reason: "missing" };
    if (!check.valid) missing.push("taxId");
  }
  return { ready: missing.length === 0, missing };
}

export function closeBlockers({ invoices = [], journals = [], quarantine = [] } = {}) {
  const out = [];
  const unbalanced = journals.filter((j) => !validateJournal(j).valid);
  if (unbalanced.length) out.push({ key: "journal_unbalanced", label: "Unbalanced journals", detail: `${unbalanced.length} journal(s) do not balance` });
  const pending = journals.filter((j) => j.approval && j.approval.status === "pending");
  if (pending.length) out.push({ key: "journal_pending", label: "Journals awaiting approval", detail: `${pending.length} journal(s) held for approval` });
  const mism = invoices.filter((i) => i && i.mismatch && !i.void && i.status !== "void");
  if (mism.length) out.push({ key: "payment_mismatch", label: "Payment mismatches", detail: mism.map((i) => i.number || i.id).join(", ") });
  if (quarantine.length) out.push({ key: "quarantined_records", label: "Damaged records quarantined", detail: `${quarantine.length} record(s)` });
  return out;
}

export function closeWarnings({ invoices = [], journals = [], bankTxns = [], period } = {}) {
  const out = [];
  const open = invoices.filter((i) => i && !i.void && (i.status === "issued" || i.status === "sent" || i.status === "part-paid" || i.status === "overdue"));
  if (open.length) out.push({ key: "open_receivable", label: "Open receivables", detail: `${open.length} invoice(s) still unpaid` });
  const unmatched = bankTxns.filter((t) => t.status === "unmatched");
  if (unmatched.length) out.push({ key: "unmatched_bank", label: "Unmatched bank lines", detail: `${unmatched.length} line(s) not reconciled` });
  return out;
}

const FIGURE_SOURCES = {
  outstanding: { label: "Outstanding", formula: "sum(total - paid - tds) over non-void invoices", inputs: ["invoices", "payments"] },
  overdue: { label: "Overdue", formula: "outstanding where dueDate < today", inputs: ["invoices", "payments"] },
  collected: { label: "Collected this period", formula: "sum(amountPaise) of payments in period", inputs: ["payments"] },
  cash: { label: "Cash & bank", formula: "sum(account balances) from all journals", inputs: ["journals", "coa"] },
  netTax: { label: "Net tax", formula: "output tax - input tax", inputs: ["journals"] },
  revenue: { label: "Revenue", formula: "sum of revenue account postings in period", inputs: ["journals", "coa"] },
};
export function figureSource(key) { return FIGURE_SOURCES[key] || null; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update the engine import list** where the engine is imported (`index.html` top and `test/engine.test.mjs`) to include the new names.

---

### Task 2: Server - mode config, snapshot validation, transition guards

**Files:**
- Create: `server/validate.mjs`
- Modify: `server/routes.mjs` (add `/api/config`; validate before save; tax/close guards)
- Modify: `server/index.mjs` (pass `mode`)
- Test: `test/server.routes.test.mjs`, `test/server.db.test.mjs`

**Interfaces:**
- Consumes: `engine.js` (`validateInvoice`, `validateJournal`, `computeInvoiceTotals`, `taxProfileReady`, `closeBlockers`).
- Produces:
  - `validateSnapshot(state) -> { valid: boolean, errors: [{ path, message }] }`
  - `GET /api/config -> { mode, serverTime, version }`
  - `PUT /state` returns `422 invalid_state` with `errors` when `validateSnapshot` fails.
  - `POST /workspaces/:id/issue` and `POST /workspaces/:id/close` guards (or inline checks where those transitions already happen).

- [ ] **Step 1: Write the failing tests** in `test/server.routes.test.mjs`

```javascript
test("a malformed snapshot is rejected with 422 and field paths", async () => {
  // ... reuse the harness that boots createApiRouter with an in-memory db ...
  const res = await put("/workspaces/" + wsId + "/state", { revision: 1, state: { ...state, invoices: [{ id: "inv_1", totals: { totalPaise: 9.5 } }] } });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "invalid_state");
  assert.ok(res.body.errors.some((e) => e.path.startsWith("invoices")));
});

test("config endpoint reports the runtime mode", async () => {
  const res = await get("/config");
  assert.equal(res.status, 200);
  assert.ok(["production", "demo"].includes(res.body.mode));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server.routes.test.mjs`
Expected: FAIL — `/config` 404; malformed snapshot currently accepted.

- [ ] **Step 3: Implement `server/validate.mjs`**

```javascript
import { validateInvoice, validateJournal, computeInvoiceTotals } from "../engine.js";

const isInt = (v) => Number.isSafeInteger(v);
const isPeriod = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

export function validateSnapshot(state) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  if (!state || typeof state !== "object") { push("state", "must be an object"); return { valid: false, errors }; }
  if (!isPeriod(state.period)) push("period", "must be YYYY-MM");
  if (!state.settings || typeof state.settings !== "object") push("settings", "must be an object");
  if (!state.company || typeof state.company !== "object") push("company", "must be an object");
  for (const key of ["clients", "invoices", "payments", "journals", "expenses", "bills", "bankAccounts", "bankTxns", "quarantine"]) {
    if (state[key] !== undefined && !Array.isArray(state[key])) push(key, "must be an array");
  }
  const seen = new Set();
  (state.invoices || []).forEach((inv, i) => {
    const p = `invoices[${i}]`;
    if (!inv || typeof inv !== "object") { push(p, "must be an object"); return; }
    if (!inv.lineItems || !Array.isArray(inv.lineItems)) { push(`${p}.lineItems`, "must be an array"); return; }
    if (seen.has(inv.id)) push(`${p}.id`, "duplicate id");
    seen.add(inv.id);
    if (!inv.totals || !isInt(inv.totals.totalPaise)) push(`${p}.totals.totalPaise`, "must be a safe integer");
    const check = validateInvoice(inv, { regimeId: (state.settings || {}).regimeId });
    if (check && check.valid === false) push(`${p}`, (check.errors || ["invalid invoice"]).join("; "));
    for (const li of inv.lineItems) {
      if (!isInt(li.ratePaise)) push(`${p}.lineItems.ratePaise`, "must be a safe integer");
    }
    const recomputed = computeInvoiceTotals({
      supplierState: inv.supplierState, placeOfSupply: inv.placeOfSupply,
      regimeId: (state.settings || {}).regimeId, tdsSection: inv.tdsSection || undefined, lineItems: inv.lineItems,
    });
    if (inv.totals && isInt(inv.totals.totalPaise) && recomputed.totalPaise !== inv.totals.totalPaise) {
      push(`${p}.totals.totalPaise`, `does not match line items (expected ${recomputed.totalPaise})`);
    }
  });
  (state.journals || []).forEach((j, i) => {
    const p = `journals[${i}]`;
    const check = validateJournal(j);
    if (!check.valid) push(p, (check.errors || ["unbalanced journal"]).join("; "));
  });
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Wire `/api/config` and validation into `server/routes.mjs`**

```javascript
// near the top of handle(), before auth-gated routes:
if (path === "/api/config" && method === "GET") {
  sendJson(res, 200, { mode, serverTime: new Date().toISOString(), version: 1 });
  return true;
}

// inside the PUT /state handler, after the revision/state shape check:
const check = validateSnapshot(body.state);
if (!check.valid) { sendJson(res, 422, { error: "invalid_state", message: "The workspace did not pass validation", errors: check.errors }); return true; }
```

`createApiRouter` gains a `mode = "production"` parameter; `server/index.mjs` passes `mode: process.env.LEDGER_MODE || "production"`.

- [ ] **Step 5: Run tests**

Run: `node --test test/server.routes.test.mjs test/server.db.test.mjs`
Expected: PASS (existing + new).

---

### Task 3: Client - mode, demo gating, destructive guard

**Files:**
- Modify: `index.html` (boot, `store.js` consumer, demos, `guardDestructive`)
- Modify: `store.js` (`fetchConfig`)
- Test: `test/ui.test.mjs`

**Interfaces:**
- Consumes: `GET /api/config`.
- Produces: `APP_MODE`, `isDemo()`, `guardDestructive({ title, body, confirmLabel, phrase, onConfirm })`, `storeAdapter.fetchConfig()`.

- [ ] **Step 1: Write failing UI tests**

```javascript
test("production mode hides demo strings and the reset control", () => {
  const prev = app.setAppMode;
  app.setAppMode("production");
  state.settings.onboarded = true;
  state.view = "dashboard"; render();
  assert.doesNotMatch(els.view.innerHTML, /Demo workspace/);
  assert.doesNotMatch(els.view.innerHTML, /Reset sample data/);
  state.view = "settings"; render();
  assert.doesNotMatch(els.view.innerHTML, /Reset demo data/);
  app.setAppMode(prev);
});

test("typed confirmation blocks the action until the phrase matches", () => {
  let ran = 0;
  app.guardDestructive({ title: "Reopen", body: "x", confirmLabel: "Reopen", phrase: "2026-10", onConfirm: () => { ran++; } });
  assert.match(els.modalRoot.innerHTML, /Type 2026-10 to confirm/);
  assert.equal(ran, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `setAppMode`/`guardDestructive` undefined.

- [ ] **Step 3: Implement** in `index.html`

Add near `storeAdapter` boot:

```javascript
let APP_MODE = "demo";
const isDemo = () => APP_MODE === "demo";
function setAppMode(m) { APP_MODE = m === "production" ? "production" : "demo"; }
try { if (storeAdapter && storeAdapter.fetchConfig) { const cfg = await storeAdapter.fetchConfig(); setAppMode(cfg.mode); } } catch (e) { setAppMode("demo"); }
```

`store.js`:

```javascript
export async function fetchConfig() { return api("/config"); }
```

Gate demo affordances: wrap the topbar badge (`index.html:1143`), dashboard demo banner (`:2574`), `dashReset` (`:4609`), Settings reset (`:4576`, `:4661`) and the palette reset item (`:1281`) in `isDemo()`.

Add `guardDestructive` (mirrors `confirmAction` but with a typed phrase input):

```javascript
function guardDestructive({ title, body, confirmLabel, phrase, onConfirm }) {
  const close = openDrawer(title, `
    <div class="flag">${esc(body)}</div>
    <div class="field"><label class="f">Type <b class="mono">${esc(phrase)}</b> to confirm</label><input id="gd_phrase" autocomplete="off"></div>`,
    `<button class="btn" id="gd_cancel">Cancel</button><button class="btn danger" id="gd_go" disabled>${esc(confirmLabel)}</button>`);
  el("gd_cancel").onclick = close;
  el("gd_phrase").oninput = (e) => { el("gd_go").disabled = e.target.value.trim() !== phrase; };
  el("gd_go").onclick = () => { close(); onConfirm(); };
}
```

Route the listed high-impact actions through it.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

---

### Task 4: Client - tax-profile gate at issue

**Files:**
- Modify: `index.html` (`markInvoice`, `importCsvRows`, invoice detail/bulk "Mark sent")
- Test: `test/ui.test.mjs`

**Interfaces:**
- Consumes: `taxProfileReady` (engine).
- Produces: `clientTaxProfile()` wrapper returning `{ ready, missing }` for current state.

- [ ] **Step 1: Failing test**

```javascript
test("an invoice cannot be marked sent until the tax profile is confirmed", () => {
  state.settings.regimeId = "IN_GST"; state.company.gstin = ""; state.settings.country = "IN"; state.settings.currency = "INR";
  const inv = testInv("gate1"); state.invoices.push(inv);
  const before = inv.status;
  app.markInvoice(inv.id, "sent");
  assert.equal(inv.status, before, "status unchanged while profile incomplete");
  state.company.gstin = "27AAPFU0939F1ZV";
  app.markInvoice(inv.id, "sent");
  assert.equal(inv.status, "sent");
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
});
```

- [ ] **Step 2-4:** run to fail, implement `clientTaxProfile()` and blocks in `markInvoice` (when moving to sent/issued) and `importCsvRows`, run to pass.

```javascript
const clientTaxProfile = () => taxProfileReady({ country: state.settings.country, regimeId: state.settings.regimeId, currency: state.settings.currency, taxId: state.company.gstin });
function blockIssueIfNotReady() { const t = clientTaxProfile(); if (!t.ready) { toast(`Confirm your tax profile first (${t.missing.join(", ")}). Open Tax settings.`, "err"); return true; } return false; }
```

---

### Task 5: Client - loading, error boundary, empty state, save-failure banner

**Files:**
- Modify: `index.html` (`render`, boot, `saveState`)
- Test: `test/ui.test.mjs`

**Interfaces:**
- Produces: `renderErrorCard(message)`, `emptyState({ title, body, cta })`, `setSaveError(msg)`.

- [ ] **Step 1: Failing tests**

```javascript
test("a thrown view degrades to an error card, not a blank page", () => {
  const original = app.viewDashboard;
  app.__setView("dashboard", () => { throw new Error("boom"); });
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /Something went wrong/);
  assert.match(els.view.innerHTML, /Retry/);
  app.__resetViews();
});
```

- [ ] **Step 2-4:** implement an error boundary around the view dispatch, a boot skeleton, `emptyState`, and a save-error banner; run to pass.

```javascript
function render() {
  // ... existing guards ...
  try {
    const v = el("view");
    v.innerHTML = /* existing dispatch */;
    if (!can("write")) v.innerHTML = readOnlyBanner() + v.innerHTML;
  } catch (err) {
    el("view").innerHTML = renderErrorCard(err && err.message ? err.message : "Unexpected error");
    logOnce(err);
  }
  wireView();
}
function renderErrorCard(message) {
  return `<div class="card"><div class="card-b"><div class="flag"><b>Something went wrong rendering this view.</b> ${esc(message)}</div><div class="advice"><button class="btn sm primary" id="errRetry">Retry</button><button class="btn sm" id="errHome">Go home</button></div></div></div>`;
}
```

---

### Task 6: Client - close guard

**Files:**
- Modify: `index.html` (`viewClose`, `closePeriod`)
- Test: `test/ui.test.mjs`

**Interfaces:**
- Consumes: `closeBlockers`, `closeWarnings`.
- Produces: `state.closeOverride` (per period reason), blocked sign-off UI, override dialog.

- [ ] **Step 1: Failing test**

```javascript
test("a payment mismatch blocks sign-off unless an owner records a reason", () => {
  state.role = "owner";
  state.invoices.push({ id: "inv_mm", number: "INV-MM", mismatch: true, status: "issued", lineItems: [], totals: { totalPaise: 0 }, clientName: "X", date: "2026-10-01", dueDate: "2026-10-15" });
  state.periods = [];
  app.closePeriod(state.period);
  assert.equal(app.periodLock(state.period), null, "not closed while blocked");
  app.overrideClose && app.overrideClose(state.period, "known timing difference");
  assert.ok(app.periodLock(state.period), "closed after override");
  state.invoices = state.invoices.filter((i) => i.id !== "inv_mm");
  state.periods = [];
});
```

- [ ] **Step 2-4:** implement blockers in `closePeriod` (guard), a disabled sign-off button with a blocker list in `viewClose`, and `overrideClose(period, reason)` that calls `closePeriod(period, { override: reason })`; run to pass.

```javascript
function closePeriod(period, opts = {}) {
  const blockers = closeBlockers({ invoices: state.invoices, journals: allJournals(), quarantine: state.quarantine || [] });
  if (blockers.length && !opts.override) { toast(`Cannot sign off: ${blockers.map((b) => b.label).join(", ")}`, "err"); return; }
  const hard = opts.hard !== undefined ? !!opts.hard : state.settings.hardLock === true;
  if (opts.override) { (state.closeOverrides = state.closeOverrides || {})[period] = { reason: opts.override, at: todayISO, by: state.role }; logActivity("period.close.override", `${period}: ${opts.override}`); }
  (state.periods = state.periods || []).push({ period, at: todayISO, by: state.role || "owner", hard });
  logActivity("period.close", `${period}${hard ? " (locked)" : " (soft)"}`); saveState(); render(); toast(`Signed off ${period}${hard ? " and locked" : ""}`, "ok");
}
```

---

### Task 7: Docs

**Files:** Create `docs/figure-sources.md`; modify `docs/BACKLOG.md`, `README.md`.

- [ ] **Step 1:** Add a figure-source map listing each dashboard/statement figure and its derivation.
- [ ] **Step 2:** Add BACKLOG section "P10 - Production hygiene (sub-project 1)" with the seven items.
- [ ] **Step 3:** Update README counts and add the `LEDGER_MODE` env var.

---

### Task 8: Full verification

- [ ] `npm test` green.
- [ ] `npm run test:server` green.
- [ ] `npm run test:all` green.
- [ ] `node /tmp/opencode/frag-audit.mjs` -> 0 findings.
- [ ] Run the server with `LEDGER_MODE=production` and confirm no demo strings via `curl`/rendered state; `LEDGER_MODE=demo` unchanged.

## Self-Review

- Spec coverage: items #1 (Task 3), #2 (Task 3), #3 (Tasks 1,7), #4 (Tasks 1,4), #5 (Task 2), #8 (Task 5), #10 (Tasks 1,6). All covered.
- Placeholder scan: no TBD/TODO; every code step shows code.
- Type consistency: `taxProfileReady`/`closeBlockers`/`closeWarnings`/`figureSource` names match across engine, client and tests; `validateSnapshot` used consistently in server.
