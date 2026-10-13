# Aurora Ledger Business-First UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Aurora Ledger prototype into a business-first product: a grouped, business-worded navigation; a dashboard that answers "what needs my attention today?"; a task inbox; and a global Advanced toggle that keeps every double-entry detail one level deeper, without changing `engine.js` or breaking any existing route.

**Architecture:** All changes live in the single `index.html` module script plus its stylesheet and `test/ui.test.mjs`. A `TERMS`/`term()` vocabulary layer plus a persisted `state.settings.accountingDetail` flag drive every label and disclosure decision. New pure view helpers (`snapshot()`, `businessActivityRows()`, `taxSummary()`, `caveatCollapsed()`) read the existing `state` and engine outputs; no money is recomputed.

**Tech Stack:** Vanilla ES modules in one HTML file, `node:test` headless UI harness (`test/ui.test.mjs` extracts and boots the module against a DOM stub). No build step, no dependencies.

## Global Constraints

- Do not modify `engine.js`. It is the verified money core and its 36 tests must stay green unchanged.
- Do not commit anything. The user has instructed that nothing be committed. Omit every `git commit` step; leave changes in the working tree only.
- Do not touch other projects in `/workspace`. All paths below are under `/workspace/billing-ledger/`.
- Keep every existing view id reachable: `dashboard`, `action`, `invoices`, `clients`, `payments`, `recurring`, `queue`, `balance`, `commitments`, `ledger`, `close`, `reports`, `readout`, `plans`, `accuracy`, `settings`. Only two ids are added: `taxes`, `tax-settings`.
- Money stays exact integer minor units formatted with the existing `p()` / `money()` helpers. Never introduce float math on money and never invent a figure.
- Default is business view (`state.settings.accountingDetail === false`); `state.ui.ledgerDetail === false`.
- No emoji. Use `&rarr;` for arrow glyphs. Keep AA contrast, keyboard access and `prefers-reduced-motion` behaviour.
- Honesty rule: demo data stays labelled; the Taxes view must state that input tax credit is not tracked rather than imply a net figure.
- Existing suites must stay green at all times: `node --test test/engine.test.mjs test/ui.test.mjs`; full gate is `npm run test:all`.
- The UI test harness re-reads `index.html` at import, so every task's test command is `node --test test/ui.test.mjs`.

---

### Task 1: Vocabulary layer and detail state

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (state seed ~378-379; add helpers after ~495)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (append)

**Interfaces:**
- Consumes: existing `state`, `saveState()`, `render()`, `el()`, `esc()`.
- Produces:
  - `TERMS` object: `{ [key]: { business: string, accounting: string } }`
  - `term(key) -> string` (returns `key` when unknown)
  - `setAccountingDetail(on: boolean) -> void`
  - `state.settings.accountingDetail: boolean`, `state.ui.ledgerDetail: boolean`

- [ ] **Step 1: Write the failing test**

Append to `/workspace/billing-ledger/test/ui.test.mjs`:

```js
test("business and accounting vocabulary resolve through one term map", () => {
  const { term, TERMS } = app;
  state.settings.accountingDetail = false;
  assert.equal(term("ledger"), "Money In & Out");
  assert.equal(term("recurring"), "Recurring bills");
  assert.equal(term("gstOutput"), "GST collected");
  assert.equal(term("receivable"), "receivable");
  state.settings.accountingDetail = true;
  assert.equal(term("ledger"), "Billing ledger");
  assert.equal(term("gstOutput"), "GST Output");
  assert.equal(term("tdsReceivable"), "TDS Receivable");
  state.settings.accountingDetail = false;
  assert.equal(TERMS.receivables.business, "Money customers owe you");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - `term` is not a function (app does not expose it yet).

- [ ] **Step 3: Add the state fields**

In `index.html`, change the `state` seed:

```js
  ui: { railCollapsed: false },
  settings: { regimeId: "IN_GST", currency: "INR", country: "IN", plan: "free", onboarded: false, theme: "light", baseCurrency: "INR" },
```

to:

```js
  ui: { railCollapsed: false, ledgerDetail: false },
  settings: { regimeId: "IN_GST", currency: "INR", country: "IN", plan: "free", onboarded: false, theme: "light", baseCurrency: "INR", accountingDetail: false },
```

- [ ] **Step 4: Add the vocabulary helpers**

In `index.html`, immediately after `const p = (n) => money(n);`, insert:

```js
// Business-first vocabulary. Detailed surfaces keep the accounting word.
const TERMS = {
  ledger: { business: "Money In & Out", accounting: "Billing ledger" },
  receivables: { business: "Money customers owe you", accounting: "Accounts Receivable" },
  gstOutput: { business: "GST collected", accounting: "GST Output" },
  tdsReceivable: { business: "TDS credits", accounting: "TDS Receivable" },
  recurring: { business: "Recurring bills", accounting: "Recurring" },
  commitments: { business: "Upcoming commitments", accounting: "Commitments" },
  close: { business: "Close this month", accounting: "Month-end close" },
  reports: { business: "Business reports", accounting: "Reports" },
  queue: { business: "Ready to review", accounting: "Preview queue" },
};
function term(key) {
  const t = TERMS[key];
  if (!t) return key;
  return state.settings.accountingDetail ? t.accounting : t.business;
}
function setAccountingDetail(on) {
  state.settings.accountingDetail = !!on;
  if (!state.settings.accountingDetail) state.ui.ledgerDetail = false;
  saveState();
  render();
}
```

- [ ] **Step 5: Expose the helpers to the test harness**

In `index.html`, add to the `globalThis.__frag = { ... }` object: `TERMS, term, setAccountingDetail,` (place them right after `state, render,`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: PASS for the new test; all previously passing UI tests still pass.

- [ ] **Step 7: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all tests pass. Do not commit.

---

### Task 2: Grouped navigation, contextual topbar and detail toggle

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (NAV 637-654; renderNav 656-681; renderTopbar 683-709; openPalette 766-767; styles before `</style>` at 147)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (append)

**Interfaces:**
- Consumes: `term()` (Task 1), `actionItems()` (currently present; enriched in Task 3), `dueRecurringCount()`, `setAccountingDetail()`.
- Produces:
  - `NAV`: array of `{ group: string, items: Array<{ id, label, abbr }> }`
  - `navItems() -> Array<{ id, label, abbr }>` (flattened)
  - `navLabel(item) -> string`
  - `roleNoteText() -> string`
  - `navButton(item) -> string` (HTML)
  - topbar element `#detailToggle` with `[data-detail]` buttons

- [ ] **Step 1: Write the failing test**

Append to `/workspace/billing-ledger/test/ui.test.mjs`:

```js
test("navigation is grouped into sections and keeps every route", () => {
  const ids = app.navItems().map((n) => n.id);
  const required = ["dashboard", "action", "invoices", "clients", "payments", "recurring", "commitments", "ledger", "taxes", "tax-settings", "reports", "close", "queue", "balance", "readout", "plans", "accuracy", "settings"];
  for (const id of required) assert.ok(ids.includes(id), `${id} should be reachable`);
  assert.deepEqual(app.NAV.map((s) => s.group), ["Home", "Money", "Customers", "Taxes", "Reports", "More"]);
});

test("the detail toggle switches nav and ledger vocabulary", () => {
  state.settings.accountingDetail = false;
  state.view = "dashboard"; render();
  assert.match(els.nav.innerHTML, /Money In/);
  assert.match(els.nav.innerHTML, /Recurring bills/);
  assert.match(els.topbar.innerHTML, /detailToggle/);
  els.detailToggle.querySelectorAll = () => [];
  app.setAccountingDetail(true);
  assert.match(els.nav.innerHTML, /Billing ledger/);
  assert.match(els.nav.innerHTML, /Recurring</);
  app.setAccountingDetail(false);
  assert.match(els.nav.innerHTML, /Money In/);
});
```

Note: the stub's `Fake` has `querySelectorAll() { return []; }`, so wiring the toggle is a no-op under test; the test drives `setAccountingDetail()` directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - `app.navItems` is not a function.

- [ ] **Step 3: Replace the NAV definition**

Replace `index.html:637-654` (the whole `const NAV = [ ... ];`) with:

```js
const NAV = [
  { group: "Home", items: [
    { id: "dashboard", label: "Home", abbr: "HM" },
    { id: "action", label: "Needs your attention", abbr: "NA" },
  ] },
  { group: "Money", items: [
    { id: "invoices", label: "Invoices", abbr: "IN" },
    { id: "payments", label: "Payments", abbr: "PM" },
    { id: "recurring", label: "Recurring bills", abbr: "RC" },
    { id: "commitments", label: "Upcoming commitments", abbr: "CM" },
    { id: "ledger", label: "Money In & Out", abbr: "LG" },
  ] },
  { group: "Customers", items: [
    { id: "clients", label: "Customers", abbr: "CU" },
  ] },
  { group: "Taxes", items: [
    { id: "taxes", label: "Taxes overview", abbr: "TX" },
    { id: "tax-settings", label: "Tax settings", abbr: "TS" },
  ] },
  { group: "Reports", items: [
    { id: "reports", label: "Business reports", abbr: "RP" },
    { id: "close", label: "Close this month", abbr: "MC" },
  ] },
  { group: "More", items: [
    { id: "queue", label: "Ready to review", abbr: "PQ" },
    { id: "balance", label: "Balance history", abbr: "BH" },
    { id: "readout", label: "Demo readout", abbr: "DR" },
    { id: "plans", label: "Plans", abbr: "PL" },
    { id: "accuracy", label: "Accuracy & scope", abbr: "AS" },
    { id: "settings", label: "Settings", abbr: "ST" },
  ] },
];
const navItems = () => NAV.flatMap((s) => s.items);
function navLabel(n) {
  if (n.id === "ledger") return term("ledger");
  if (n.id === "recurring") return term("recurring");
  if (n.id === "commitments") return term("commitments");
  if (n.id === "close") return term("close");
  if (n.id === "reports") return term("reports");
  if (n.id === "queue") return term("queue");
  return n.label;
}
function roleNoteText() {
  return {
    owner: "You see who owes you money, what you collected, taxes, and what is next.",
    bookkeeper: "You see workflow and reconciliation actions.",
    ca_firm: "You see filing and escalation framing.",
  }[state.role] || "";
}
```

- [ ] **Step 4: Rewrite renderNav**

Replace the body of `renderNav()` (`index.html:656-667`, from the opening `el("nav").innerHTML = NAV.map(...)` through the `}).join("");`) with:

```js
function navButton(n) {
  let count = "";
  if (n.id === "invoices") count = `<span class="count">${state.invoices.length}</span>`;
  if (n.id === "clients") count = `<span class="count">${state.clients.length}</span>`;
  if (n.id === "payments") count = `<span class="count">${state.payments.length}</span>`;
  if (n.id === "recurring") { const d = dueRecurringCount(); if (d) count = `<span class="count">${d}</span>`; }
  if (n.id === "queue") count = `<span class="count">${state.invoices.filter((i) => i.preview).length}</span>`;
  if (n.id === "plans") count = `<span class="count">${state.settings.plan}</span>`;
  if (n.id === "action") { const n2 = actionItems().length; count = n2 ? `<span class="count">${n2}</span>` : ""; }
  return `<button data-view="${n.id}" class="${state.view === n.id ? "active" : ""}" aria-current="${state.view === n.id ? "page" : "false"}"><span class="abbr">${n.abbr}</span><span class="lbl">${esc(navLabel(n))}</span>${count}</button>`;
}

function renderNav() {
  el("nav").innerHTML = NAV.map((sec) => `
    <div class="nav-group">
      <div class="nav-group-h">${esc(sec.group)}</div>
      ${sec.items.map((n) => navButton(n)).join("")}
    </div>`).join("");
  el("nav").querySelectorAll("button").forEach((b) => b.onclick = () => { state.view = b.dataset.view; saveState(); render(); });
```

Then, in the same `renderNav()`, replace the inline `roleNote` map block:

```js
  const roleNote = {
    owner: "You see business consequences and money decisions.",
    bookkeeper: "You see workflow and reconciliation actions.",
    ca_firm: "You see filing/escalation framing.",
  };
  el("roleNote").textContent = roleNote[state.role];
```

with:

```js
  el("roleNote").textContent = roleNoteText();
```

- [ ] **Step 5: Update the topbar title lookup and add the toggle**

In `renderTopbar()`, change:

```js
      <h1>${esc(NAV.find((n) => n.id === state.view)?.label || "")}</h1>
```

to:

```js
      <h1>${esc(navLabel(navItems().find((n) => n.id === state.view) || { id: state.view, label: "" }))}</h1>
```

Immediately before `<select id="periodPicker"` in the toolbar, insert:

```html
      <div class="seg" id="detailToggle" role="group" aria-label="Detail level">
        <button data-detail="0" class="${state.settings.accountingDetail ? "" : "on"}">Business</button>
        <button data-detail="1" class="${state.settings.accountingDetail ? "on" : ""}">Accounting</button>
      </div>
```

After `el("cmdk").onclick = openPalette;`, add:

```js
  const dt = el("detailToggle");
  if (dt) dt.querySelectorAll("[data-detail]").forEach((b) => { b.onclick = () => setAccountingDetail(b.dataset.detail === "1"); });
```

- [ ] **Step 6: Update the command palette to use the flattened list**

In `openPalette()`, change:

```js
    ...NAV.map((n) => ({ label: n.label, kind: "Go to", run: () => go(n.id) })),
```

to:

```js
    ...navItems().map((n) => ({ label: navLabel(n), kind: "Go to", run: () => go(n.id) })),
```

- [ ] **Step 7: Add the group heading styles**

In the base `<style>` block, immediately before `</style>` at `index.html:147`, add:

```css
  .nav-group-h { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 12px 10px 4px; }
  .app.rail-collapsed .nav-group-h { display: none; }
  .attn { border-left: 3px solid currentColor; }
  .why { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  details.caveat summary { cursor: pointer; font-weight: 650; }
  details.caveat[open] summary { margin-bottom: 8px; }
```

- [ ] **Step 8: Expose navItems to the harness**

Add `NAV, navItems, navLabel, roleNoteText,` to the `globalThis.__frag` object.

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: PASS for the two new tests. Previously passing tests still pass (the command palette and title lookups were updated).

- [ ] **Step 10: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all pass. Do not commit.

---

### Task 3: Snapshot metrics, business activity rows and the task inbox

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (`actionItems()` 834-854; `viewAction()` 856-865; add `snapshot()`/`businessActivityRows()` near the ledger helpers ~1472; helper `attentionItems` alias)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (append)

**Interfaces:**
- Consumes: `invoicesInPeriod()`, `isVoid()`, `openBalance()`, `invStatus()`, `p()`, `todayISO`, `invoiceById()`, `client()`, `clientRecommendation()`, `monthEndClose()`.
- Produces:
  - `snapshot() -> { billed, collected, outstanding, gstCollected, tdsCredits, upcoming }` (all integer paise)
  - `businessActivityRows() -> Array<{ date, clientName, activity, ref, amountPaise, status, inv }>` sorted newest first
  - `actionItems()` returning items that additionally carry `headline`, `actionLabel`, and optionally `amountPaise`, `due`, `why`
  - `attentionItems` (alias of `actionItems`)

- [ ] **Step 1: Write the failing test**

Append to `/workspace/billing-ledger/test/ui.test.mjs`:

```js
test("snapshot metrics are exact integers from existing data", () => {
  const s = app.snapshot();
  for (const k of ["billed", "collected", "outstanding", "gstCollected", "tdsCredits", "upcoming"]) {
    assert.ok(Number.isInteger(s[k]), `${k} must be an integer`);
    assert.ok(s[k] >= 0, `${k} must not be negative`);
  }
});

test("business activity rows merge invoices and payments newest first", () => {
  const rows = app.businessActivityRows();
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.activity === "Invoice"));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date, "rows sorted newest first");
});

test("task inbox items carry a headline, a why and an action", () => {
  const items = app.attentionItems();
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(it.headline, "headline present");
    assert.ok(it.actionLabel, "action label present");
    assert.ok(it.why, "why present");
  }
  state.view = "action"; render();
  assert.match(els.view.innerHTML, /Needs your attention/);
  assert.match(els.view.innerHTML, /data-go=/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - `app.snapshot` is not a function.

- [ ] **Step 3: Add snapshot and business activity helpers**

Immediately before `// ---- Ledger -----`, insert:

```js
function snapshot() {
  const invs = invoicesInPeriod().filter((i) => !isVoid(i));
  const billed = invs.reduce((a, i) => a + i.totals.totalPaise, 0);
  const pays = state.payments.filter((x) => x.date.slice(0, 7) === state.period);
  const collected = pays.reduce((a, r) => a + r.amountPaise, 0);
  const outstanding = state.invoices.filter((i) => !isVoid(i)).reduce((a, i) => a + openBalance(i), 0);
  const gstCollected = invs.reduce((a, i) => a + (i.totals.totalTaxPaise ?? i.totals.gstPaise ?? 0), 0);
  const tdsCredits = invs.reduce((a, i) => a + (i.totals.tdsPaise || 0), 0);
  const upcoming = state.invoices
    .filter((i) => !isVoid(i) && openBalance(i) > 0 && i.dueDate >= todayISO)
    .reduce((a, i) => a + openBalance(i), 0);
  return { billed, collected, outstanding, gstCollected, tdsCredits, upcoming };
}

function businessActivityRows() {
  const rows = [];
  for (const i of state.invoices) {
    if (isVoid(i)) continue;
    rows.push({ date: i.date, clientName: i.clientName, activity: "Invoice", ref: i.number, amountPaise: i.totals.totalPaise, status: invStatus(i), inv: i });
  }
  for (const y of state.payments) {
    const inv = invoiceById(y.invoiceId);
    rows.push({ date: y.date, clientName: inv?.clientName || client(y.clientId)?.name || "-", activity: "Payment", ref: y.invoiceNumber || y.reference || "-", amountPaise: y.amountPaise, status: "received", inv });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
```

- [ ] **Step 4: Run the failing snapshot tests again**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: the two new snapshot/activity tests PASS; the inbox test still FAILS.

- [ ] **Step 5: Enrich actionItems**

Replace `actionItems()` (`index.html:834-854`) entirely with:

```js
function actionItems() {
  const items = [];
  for (const inv of state.invoices) {
    if (isVoid(inv)) continue;
    const open = openBalance(inv);
    if (!open) continue;
    if (inv.dueDate < todayISO) {
      items.push({ tone: "urgent", view: "invoices", headline: `${inv.clientName} invoice unpaid`, title: `Overdue · ${inv.number} · ${inv.clientName}`, detail: `${p(open)} was due ${inv.dueDate}`, why: `Overdue since ${inv.dueDate}. Chase it or record a payment.`, actionLabel: "View invoice", amountPaise: open, due: inv.dueDate, inv });
    } else if (inv.dueDate <= addDays(todayISO, 7)) {
      items.push({ tone: "warn", view: "invoices", headline: `${inv.clientName} payment due soon`, title: `Due soon · ${inv.number} · ${inv.clientName}`, detail: `${p(open)} due ${inv.dueDate}`, why: "Due within the next 7 days. A reminder now avoids a late payment.", actionLabel: "View invoice", amountPaise: open, due: inv.dueDate, inv });
    }
    const pay = paymentsFor(inv.id);
    if (pay.length) {
      const t = inv.totals;
      const asym = detectPaymentAsymmetry({ invoice: { totalPaise: t.totalPaise, tdsPaise: t.tdsPaise }, payment: pay[pay.length - 1] });
      if (!asym.clean) {
        items.push({ tone: "urgent", view: "balance", headline: `Payment mismatch on ${inv.number}`, title: `Reconciliation · ${inv.number}`, detail: `${asym.flags.length} flag${asym.flags.length === 1 ? "" : "s"} on ${inv.clientName}`, why: "A receipt does not line up with the invoice. Check it before closing.", actionLabel: "Review", inv });
      }
    }
  }
  for (const c of state.clients) {
    const r = clientRecommendation(c.id);
    if (r.level === "urgent") {
      items.push({ tone: "warn", view: "queue", headline: `Consider consolidating ${c.name}`, title: `Consolidate ${c.name}`, detail: r.reason, why: "Many small invoices make the ledger harder to audit.", actionLabel: "Review", client: c });
    }
  }
  const close = monthEndClose({ period: state.period, invoices: state.invoices.map((i) => ({ date: i.date, totalPaise: i.totals.totalPaise })), payments: state.payments, role: state.role });
  const remaining = close.steps.filter((s) => !s.done).length;
  if (remaining) {
    items.push({ tone: "warn", view: "close", headline: "Close this month", title: `${remaining} month-end item${remaining === 1 ? "" : "s"} remaining`, detail: `${remaining} of ${close.steps.length} close steps remaining`, why: "Finish the month so the figures can be trusted.", actionLabel: "Continue" });
  }
  if (!state.settings.onboarded) {
    items.push({ tone: "warn", view: "settings", headline: "Confirm your tax profile", title: "Tax settings need confirmation", detail: "Business details and tax registration", why: "Tax figures depend on your current settings.", actionLabel: "Review settings" });
  }
  return items;
}
const attentionItems = () => actionItems();
```

- [ ] **Step 6: Rewrite viewAction**

Replace `viewAction()` (`index.html:856-865`) with:

```js
function viewAction() {
  const items = actionItems();
  if (!items.length) return `<div class="card"><div class="card-b"><div class="empty">Nothing needs your attention today. Every invoice is settled and every client pattern is acceptable.</div></div></div>`;
  return `<div class="card"><div class="card-h"><h2>Needs your attention</h2><span class="hint">${items.length} item${items.length === 1 ? "" : "s"}</span></div>
    <div class="card-b grid">${items.map((it) => `
      <div class="reco ${it.tone === "urgent" ? "urgent" : "warn"} attn" style="color:var(--${it.tone})">
        <h3 style="color:var(--ink)">${esc(it.headline || it.title)}</h3>
        <div class="pill-row" style="justify-content:space-between"><b class="num">${it.amountPaise ? p(it.amountPaise) : esc(it.detail)}</b>${it.due ? `<span class="subtle">Due ${esc(it.due)}</span>` : ""}</div>
        <p style="color:var(--muted)">${esc(it.why || it.detail)}</p>
        <div class="advice"><button class="btn primary sm" data-go="${it.view}">${esc(it.actionLabel || "Open")}</button></div>
      </div>`).join("")}</div></div>`;
}
```

- [ ] **Step 7: Expose the new helpers**

Add `snapshot, businessActivityRows, attentionItems,` to the `globalThis.__frag` object.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all three new tests PASS. The existing "voiding an invoice ... clears it from needs-action" and "fifth invoice upgrades..." tests still pass.

- [ ] **Step 9: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all pass. Do not commit.

---

### Task 4: Business-first dashboard and collapsed caveats

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (`viewDashboard()` 1257-1302; add `monthName()`/`caveatCollapsed()` near it)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (replace the old dashboard test)

**Interfaces:**
- Consumes: `snapshot()`, `businessActivityRows()`, `actionItems()`, `term()`, `roleNoteText()`, `kpi()`, `recoBlock()`, `p()`.
- Produces:
  - `monthName(period) -> string`
  - `caveatCollapsed() -> string` (a `<details class="caveat">` block)

- [ ] **Step 1: Replace the old dashboard test**

In `/workspace/billing-ledger/test/ui.test.mjs`, replace the test:

```js
test("dashboard renders totals and upfront fragmentation", () => {
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /Billed this period/);
  assert.match(els.view.innerHTML, /Open receivable/);
  assert.match(els.view.innerHTML, /Proactive consolidation/);
});
```

with:

```js
test("dashboard leads with a business snapshot and an action inbox", () => {
  state.view = "dashboard"; render();
  const html = els.view.innerHTML;
  assert.match(html, /business snapshot/);
  assert.match(html, /What needs your attention\?/);
  assert.match(html, /Money coming in/);
  assert.match(html, /Outstanding/);
  assert.match(html, /View accounting entries/);
  assert.match(html, /Proactive consolidation/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("regulatory notes are collapsed behind a summary line", () => {
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /Tax information is based on your current settings/);
  assert.match(els.view.innerHTML, /<details/);
  state.view = "accuracy"; render();
  assert.match(els.view.innerHTML, /Regulatory accuracy notes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - "business snapshot" not found (old dashboard still renders). The collapsed-caveats test also fails.

- [ ] **Step 3: Add monthName and caveatCollapsed**

Immediately after the `// ---- Dashboard ---` comment and before `function viewDashboard()`, insert:

```js
function monthName(m) {
  const d = new Date(m + "-01T00:00:00Z");
  return d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}
function caveatCollapsed() {
  return `<details class="caveat"><summary>Tax information is based on your current settings. Review before issuing.</summary><ul>${REGULATORY_CAVEATS.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></details>`;
}
```

- [ ] **Step 4: Rewrite viewDashboard**

Replace `viewDashboard()` (`index.html:1257-1302`) entirely with:

```js
function viewDashboard() {
  const s = snapshot();
  const attn = actionItems();
  const invs = invoicesInPeriod().filter((i) => !isVoid(i));
  const pays = state.payments.filter((x) => x.date.slice(0, 7) === state.period);
  const openCount = state.invoices.filter((i) => !isVoid(i) && openBalance(i) > 0).length;
  const recos = state.clients.map((c) => ({ c, r: clientRecommendation(c.id) }))
    .filter((x) => x.r.state !== "single_invoice_optimized" && x.r.state !== "consolidated_clean");
  const urgent = recos.filter((x) => x.r.level === "urgent");
  const actionCard = (l, v, m, view) => `<div class="card kpi"><div class="lbl">${esc(l)}</div><div class="val">${v}</div><div class="meta">${esc(m)}</div><div class="advice" style="margin-top:8px"><button class="btn sm" data-go="${view}">View &rarr;</button></div></div>`;

  return `
  ${state.settings.onboarded ? "" : `<div class="card"><div class="card-b"><div class="reco warn" style="color:var(--warn)"><h3 style="color:var(--ink)">Welcome - set up your workspace</h3><p style="color:#374151">This is a demo workspace using sample data. Choose your country and currency, enter your business details, then start issuing documents. Nothing is sent anywhere.</p><div class="advice"><button class="btn primary sm" data-go="settings">Open settings</button></div></div></div></div>`}

  <div class="card">
    <div class="card-h"><h2>${esc(monthName(state.period))} business snapshot</h2><span class="hint">${esc(roleNoteText())}</span></div>
    <div class="card-b"><div class="grid kpi">
      ${kpi("Billed", p(s.billed), `${invs.length} invoices`)}
      ${kpi("Collected", p(s.collected), `${pays.length} receipts`)}
      ${kpi("Outstanding", p(s.outstanding), "Across all customers")}
      ${kpi("GST collected", p(s.gstCollected), "On this period's invoices")}
      ${kpi("TDS credits", p(s.tdsCredits), "Withheld on invoices")}
      ${kpi("Upcoming", p(s.upcoming), "Due today or later")}
    </div></div>
  </div>

  <div class="card">
    <div class="card-h"><h2>What needs your attention?</h2><span class="hint">${attn.length ? `${attn.length} thing${attn.length === 1 ? "" : "s"} need action` : "Nothing pending"}</span></div>
    <div class="card-b grid">
      ${attn.length ? attn.slice(0, 4).map((it) => `
        <div class="reco ${it.tone === "urgent" ? "urgent" : "warn"} attn" style="color:var(--${it.tone})">
          <h3 style="color:var(--ink)">${esc(it.headline)}</h3>
          <p style="color:var(--muted)">${esc(it.detail)}</p>
          ${it.why ? `<div class="why">${esc(it.why)}</div>` : ""}
          <div class="advice"><button class="btn primary sm" data-go="${it.view}">${esc(it.actionLabel || "Open")}</button></div>
        </div>`).join("") : `<div class="empty">Nothing needs your attention today.</div>`}
      ${attn.length ? `<div class="advice" style="margin-top:4px"><button class="btn sm" data-go="action">Open task inbox &rarr;</button></div>` : ""}
    </div>
  </div>

  <div class="grid kpi">
    ${actionCard("Money coming in", p(s.upcoming), `${openCount} open invoices`, "invoices")}
    ${actionCard("Invoices", p(s.outstanding), `${openCount} outstanding`, "invoices")}
    ${actionCard("Payments", p(s.collected), `${pays.length} received this period`, "payments")}
    ${actionCard("Tax", p(s.gstCollected), `TDS credits ${p(s.tdsCredits)}`, "taxes")}
    ${actionCard("This month", p(s.billed), `${p(s.collected)} collected`, "reports")}
  </div>

  <div class="card">
    <div class="card-h"><h2>Recent money activity</h2><div class="toolbar"><button class="btn sm" data-go="ledger">View accounting entries &rarr;</button></div></div>
    <div class="card-b" style="padding:0"><table>
      <thead><tr><th>Date</th><th>Customer</th><th>Activity</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${businessActivityRows().slice(0, 8).map((r) => `<tr class="${r.inv ? "clickable" : ""}" ${r.inv ? `data-inv="${r.inv.id}"` : ""}><td class="mono">${r.date}</td><td>${esc(r.clientName)}</td><td>${esc(r.activity)}</td><td class="num">${p(r.amountPaise)}</td><td><span class="badge ${r.activity === "Payment" ? "b-good" : "b-muted"}">${esc(r.activity === "Payment" ? "Received" : r.status)}</span></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No activity yet.</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="card">
    <div class="card-h"><h2>Cash-flow watch</h2><span class="hint">${recos.length} customer${recos.length === 1 ? "" : "s"} needing attention</span></div>
    <div class="card-b grid">
      ${urgent.length ? `<div class="reco urgent"><h3>${urgent.length} urgent consolidation${urgent.length === 1 ? "" : "s"}</h3><p>${esc(urgent.map((x) => x.c.name).join(", "))} crossed the 5-invoice threshold this period. Left unresolved, the ledger stops being auditable.</p></div>` : ""}
      ${recos.length ? recos.map(({ c, r }) => recoBlock(r, c.id)).join("") : `<div class="empty">Every client is on a single-invoice or acceptable pattern this period.</div>`}
    </div>
  </div>

  <div class="card"><div class="card-b">${caveatCollapsed()}</div></div>`;
}
```

- [ ] **Step 5: Expose the helpers**

Add `monthName, caveatCollapsed,` to the `globalThis.__frag` object.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: both replaced/new dashboard tests PASS. The "role switch changes recommendation wording" test still passes (both `roleNoteText()` and `recoBlock` vary by role). The "fifth invoice upgrades..." test still passes (it asserts on the invoices view).

- [ ] **Step 7: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all pass. Do not commit.

---

### Task 5: Business ledger with an accounting expander

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (`viewLedger()` 1487-1518; `wireView()` near 1749)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (replace the old ledger test)

**Interfaces:**
- Consumes: `term("ledger")`, `businessActivityRows()`, `buildBillingLedger()`, `ledgerSource()`, `caveatCollapsed()`, `state.ui.ledgerDetail`, `state.settings.accountingDetail`, `exportLedgerCsv()`.
- Produces: element `#ledgerDetailToggle` that flips `state.ui.ledgerDetail`; `#exportCsv` stays present in both modes.

- [ ] **Step 1: Replace the old ledger test**

In `/workspace/billing-ledger/test/ui.test.mjs`, replace the test:

```js
test("ledger export is balanced and free of NaN", () => {
  state.view = "ledger"; render();
  assert.match(els.view.innerHTML, /balanced/);
  els.exportCsv.onclick();
```

with:

```js
test("ledger defaults to the business view and reveals balanced accounting entries", () => {
  state.settings.accountingDetail = false;
  state.ui.ledgerDetail = false;
  state.view = "ledger"; render();
  assert.match(els.view.innerHTML, /Activity/);
  assert.doesNotMatch(els.view.innerHTML, /Debit<\/th>/);
  els.ledgerDetailToggle.onclick();
  assert.match(els.view.innerHTML, /Debit<\/th>/);
  assert.match(els.view.innerHTML, /balanced/);
  els.exportCsv.onclick();
```

Leave the rest of that test (the CSV assertions) unchanged. Also add a focused test after it:

```js
test("accounting detail opens the ledger entries without a toggle", () => {
  app.setAccountingDetail(true);
  state.view = "ledger"; render();
  assert.match(els.view.innerHTML, /Debit<\/th>/);
  assert.match(els.view.innerHTML, /balanced/);
  app.setAccountingDetail(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - the default ledger still renders the debit/credit table and there is no `#ledgerDetailToggle`.

- [ ] **Step 3: Rewrite viewLedger**

Replace `viewLedger()` (`index.html:1487-1518`) entirely with:

```js
function viewLedger() {
  const filter = state.ledgerClient || "all";
  const rows = buildBillingLedger(ledgerSource(filter === "all" ? undefined : filter));
  const debit = rows.reduce((a, r) => a + r.debitPaise, 0);
  const credit = rows.reduce((a, r) => a + r.creditPaise, 0);
  const showEntries = state.settings.accountingDetail || state.ui.ledgerDetail;
  const biz = businessActivityRows().filter((r) => filter === "all" || r.inv?.clientId === filter);
  return `
  <div class="card">
    <div class="card-h">
      <h2>${esc(term("ledger"))}</h2>
      <div class="toolbar">
        <select id="ledFilter" style="width:auto">
          <option value="all" ${filter === "all" ? "selected" : ""}>All customers</option>
          ${state.clients.map((c) => `<option value="${c.id}" ${filter === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
        ${state.settings.accountingDetail ? "" : `<button class="btn sm" id="ledgerDetailToggle">${showEntries ? "Hide accounting entries" : "View accounting entries &rarr;"}</button>`}
        <button class="btn" id="exportCsv">Export CSV</button>
      </div>
    </div>
    <div class="card-b" style="padding:0">
      <table>
        <thead><tr><th>Date</th><th>Customer</th><th>Activity</th><th class="num">Amount</th><th>Status</th></tr></thead>
        <tbody>${biz.map((r) => `<tr class="${r.inv ? "clickable" : ""}" ${r.inv ? `data-inv="${r.inv.id}"` : ""}><td class="mono">${r.date}</td><td>${esc(r.clientName)}</td><td>${esc(r.activity)}</td><td class="num">${p(r.amountPaise)}</td><td><span class="badge ${r.activity === "Payment" ? "b-good" : "b-muted"}">${esc(r.activity === "Payment" ? "Received" : r.status)}</span></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No activity.</td></tr>`}</tbody>
      </table>
    </div>
  </div>
  ${showEntries ? `<div class="card">
    <div class="card-h"><h2>Accounting entries</h2><span class="hint">Every posting debits and credits in exact minor units</span></div>
    <div class="card-b" style="padding:0">
      <table class="ledger">
        <thead><tr><th>Date</th><th>Ref</th><th>Type</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th>Note</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="mono">${r.date}</td><td class="mono">${esc(r.ref)}</td><td><span class="tag">${r.type}</span></td>
          <td>${esc(r.account)}</td><td class="num">${r.debitPaise ? p(r.debitPaise) : "-"}</td>
          <td class="num">${r.creditPaise ? p(r.creditPaise) : "-"}</td><td class="muted">${esc(r.note)}</td>
        </tr>`).join("") || `<tr><td colspan="7" class="empty">No ledger entries.</td></tr>`}
        </tbody>
        <tfoot><tr><th colspan="4">Totals</th><th class="num">${p(debit)}</th><th class="num">${p(credit)}</th><th>${debit === credit ? `<span class="badge b-good">balanced</span>` : `<span class="badge b-urgent">gap ${p(debit - credit)}</span>`}</th></tr></tfoot>
      </table>
    </div>
  </div>` : ""}
  <div class="card"><div class="card-b">${caveatCollapsed()}</div></div>`;
}
```

- [ ] **Step 4: Wire the expander**

In `wireView()`, immediately after the `ledFilter` binding:

```js
  const lf = el("ledFilter"); if (lf) lf.onchange = (e) => { state.ledgerClient = e.target.value; render(); };
```

add:

```js
  const ldt = el("ledgerDetailToggle"); if (ldt) ldt.onclick = () => { state.ui.ledgerDetail = !state.ui.ledgerDetail; render(); };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: both ledger tests PASS. The CSV test portion still passes because `#exportCsv` exists in the business view and the accounting table still balances.

Note: `exportLedgerCsv` recomputes from `buildBillingLedger` and is unchanged, so the CSV still has the full Debit/Credit columns regardless of the toggle.

- [ ] **Step 6: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all pass. Do not commit.

---

### Task 6: Taxes overview, tax-settings route and remaining caveat collapses

**Files:**
- Modify: `/workspace/billing-ledger/index.html` (`render()` dispatch 745-760; `viewSettings()` 1699-1737; add `viewTaxes()`/`viewTaxSettings()`/`taxSettingsCard()`/`taxSummary()`; `wireView()`; collapse caveats in `viewInvoices` ~1358 and `viewClose` ~1543)
- Test: `/workspace/billing-ledger/test/ui.test.mjs` (append; extend the all-views loop)

**Interfaces:**
- Consumes: `snapshot()`, `caveatCollapsed()`, `kpi()`, `regime()`, `idNoun()`, `validateTaxId()`, `p()`, `setAccountingDetail()`.
- Produces:
  - `taxSummary() -> { gstCollected, tdsCredits, bySection }`
  - `viewTaxes() -> string`
  - `viewTaxSettings() -> string`
  - `taxSettingsCard() -> string`
  - two dispatch routes: `taxes`, `tax-settings`
  - element `#s_detail` inside the tax settings card

- [ ] **Step 1: Write the failing tests**

Append to `/workspace/billing-ledger/test/ui.test.mjs`:

```js
test("taxes overview reports GST and TDS and is honest about input credit", () => {
  state.view = "taxes"; render();
  const html = els.view.innerHTML;
  assert.match(html, /GST collected/);
  assert.match(html, /TDS credits/);
  assert.match(html, /Input tax credit is not tracked/);
  assert.doesNotMatch(html, /NaN|undefined/);
  state.view = "tax-settings"; render();
  assert.match(els.view.innerHTML, /Tax settings/);
  assert.match(els.view.innerHTML, /s_regime|Country \/ tax regime/);
});
```

Then in the existing test `"every view renders under a non-GST regime without errors"`, change:

```js
  const views = ["dashboard", "action", "invoices", "clients", "payments", "queue", "balance", "commitments", "ledger", "close", "reports", "readout", "plans", "accuracy", "settings"];
```

to:

```js
  const views = ["dashboard", "action", "invoices", "clients", "payments", "queue", "balance", "commitments", "ledger", "taxes", "tax-settings", "close", "reports", "readout", "plans", "accuracy", "settings"];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: FAIL - `taxes` route renders nothing ("GST collected" not found).

- [ ] **Step 3: Add taxSummary and the Taxes view**

Immediately after `function viewClose() { ... }`, insert:

```js
// ---- Taxes ----------------------------------------------------------------

function taxSummary() {
  const invs = invoicesInPeriod().filter((i) => !isVoid(i));
  const s = snapshot();
  const bySection = {};
  for (const i of invs) {
    const amt = i.totals.tdsPaise || 0;
    if (!amt) continue;
    const sec = i.tdsSection || "none";
    bySection[sec] = (bySection[sec] || 0) + amt;
  }
  return { gstCollected: s.gstCollected, tdsCredits: s.tdsCredits, bySection };
}

function viewTaxes() {
  const s = snapshot();
  const t = taxSummary();
  const taxCheck = state.company.gstin ? validateTaxId(state.company.gstin, state.settings.regimeId) : { valid: true, reason: "" };
  const sections = Object.entries(t.bySection);
  return `
  <div class="card">
    <div class="card-h"><h2>Taxes overview</h2><span class="hint">${esc(state.period)} · from recorded invoices</span></div>
    <div class="card-b"><div class="grid kpi">
      ${kpi("GST collected", p(s.gstCollected), "Output tax on this period's invoices")}
      ${kpi("TDS credits", p(s.tdsCredits), "Withheld by customers")}
      ${kpi("Outstanding", p(s.outstanding), "Still to be collected")}
    </div></div>
  </div>
  <div class="grid two">
    <div class="card"><div class="card-h"><h2>TDS by section</h2></div>
      <div class="card-b" style="padding:0"><table>
        <thead><tr><th>Section</th><th class="num">Credit</th></tr></thead>
        <tbody>${sections.map(([sec, amt]) => `<tr><td class="mono">${esc(sec)}</td><td class="num">${p(amt)}</td></tr>`).join("") || `<tr><td colspan="2" class="empty">No TDS recorded this period.</td></tr>`}</tbody>
      </table></div></div>
    <div class="card"><div class="card-h"><h2>Registration</h2></div>
      <div class="card-b">
        <div class="pill-row" style="justify-content:space-between"><span class="subtle">${esc(idNoun())}</span><b class="mono">${esc(state.company.gstin || "-")}</b></div>
        <div class="pill-row" style="justify-content:space-between;margin-top:8px"><span class="subtle">Regime</span><b>${esc(regime().label)}</b></div>
        <div class="pill-row" style="justify-content:space-between;margin-top:8px"><span class="subtle">Base currency</span><b>${esc(state.settings.baseCurrency || state.settings.currency)}</b></div>
        ${state.company.gstin ? `<div class="${taxCheck.valid ? "okline" : "flag"}" style="margin-top:10px">${taxCheck.valid ? `Valid ${esc(idNoun())}.` : `Invalid: ${esc(taxCheck.reason)}`}</div>` : ""}
        <div class="subtle" style="margin-top:10px">Input tax credit is not tracked. This view reports output tax and TDS credits only.</div>
      </div></div>
  </div>
  <div class="card"><div class="card-b">${caveatCollapsed()}</div></div>`;
}

function viewTaxSettings() {
  return taxSettingsCard();
}
```

- [ ] **Step 4: Extract taxSettingsCard and simplify viewSettings**

Replace `viewSettings()` (`index.html:1699-1737`) entirely with:

```js
function taxSettingsCard() {
  const s = state.settings;
  const taxCheck = state.company.gstin ? validateTaxId(state.company.gstin, s.regimeId) : { valid: true, reason: "" };
  return `
  <div class="card">
    <div class="card-h"><h2>Tax settings</h2><span class="hint">These drive every calculation</span></div>
    <div class="card-b">
      <div class="row c2">
        <div class="field" style="margin:0"><label class="f">Country / tax regime</label>
          <select id="s_regime">${Object.values(TAX_REGIMES).filter((x) => x.id !== "NONE").map((x) => `<option value="${x.id}" ${x.id === s.regimeId ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin:0"><label class="f">Currency</label>
          <select id="s_currency">${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === s.currency ? "selected" : ""}>${c.code} - ${esc(c.name)}</option>`).join("")}</select>
        </div>
      </div>
      <div class="row c2" style="margin-top:12px">
        <div class="field" style="margin:0"><label class="f">${esc(idNoun())}</label><input id="s_taxid" value="${esc(state.company.gstin || "")}" placeholder="Registration number"></div>
        <div class="field" style="margin:0"><label class="f">Supplier state / region code</label><input id="s_state" value="${esc(state.company.state || "")}"></div>
      </div>
      ${state.company.gstin ? `<div class="${taxCheck.valid ? "okline" : "flag"}" style="margin-top:10px">${taxCheck.valid ? `Valid ${esc(idNoun())}.` : `Invalid: ${esc(taxCheck.reason)}`}</div>` : `<div class="subtle" style="margin-top:10px">No ${esc(idNoun())} entered.</div>`}
      <div class="row c2" style="margin-top:12px">
        <div class="field" style="margin:0"><label class="f">Base currency (for FX equivalents)</label>
          <select id="s_baseCurrency">${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === (s.baseCurrency || s.currency) ? "selected" : ""}>${c.code} - ${esc(c.name)}</option>`).join("")}</select>
          <div class="subtle">Foreign-currency invoices capture a rate and show an indicative base equivalent. No live FX feed.</div>
        </div>
      </div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn sm" id="s_detail">${s.accountingDetail ? "Switch to business view" : "Switch to accounting view"}</button>
        <span class="subtle">Accounting view shows debit / credit entries and full tax-account detail.</span>
      </div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn primary" id="s_save">Save settings</button>
        <button class="btn" id="exportJson">Download backup</button>
        <button class="btn" id="importCsvBtn">Import CSV</button>
        <label class="btn" for="importJson" style="display:inline-block">Restore backup</label>
        <input type="file" id="importJson" accept="application/json" style="display:none">
        <button class="btn" id="s_reset">Reset demo data</button>
      </div>
    </div>
  </div>`;
}

function viewSettings() {
  return `
  <div class="card">
    <div class="card-h"><h2>Business details</h2><span class="hint">Your workspace</span></div>
    <div class="card-b">
      <div class="field" style="margin:0"><label class="f">Business name</label><input id="s_name" value="${esc(state.company.name)}"></div>
    </div>
  </div>
  ${taxSettingsCard()}
  <div class="card"><div class="card-b">${caveatCollapsed()}</div></div>`;
}
```

Note: `#s_name`, `#s_regime`, `#s_currency`, `#s_taxid`, `#s_state`, `#s_baseCurrency`, `#s_save`, `#exportJson`, `#importCsvBtn`, `#importJson`, `#s_reset` are all still present after `viewSettings()` renders, so the existing settings test keeps passing.

- [ ] **Step 5: Add the dispatch routes**

In `render()`, after:

```js
  else if (state.view === "settings") v.innerHTML = viewSettings();
```

insert before it:

```js
  else if (state.view === "taxes") v.innerHTML = viewTaxes();
  else if (state.view === "tax-settings") v.innerHTML = viewTaxSettings();
```

- [ ] **Step 6: Wire the s_detail button**

In `wireView()`, after the `sv` (`#s_save`) block, add:

```js
  const sd = el("s_detail");
  if (sd) sd.onclick = () => setAccountingDetail(!state.settings.accountingDetail);
```

- [ ] **Step 7: Collapse the remaining caveat walls**

In `viewInvoices()` and `viewClose()`, replace the trailing regulatory card:

```html
  <div class="card"><div class="card-b"><div class="caveat"><b>Regulatory accuracy notes</b><ul>${REGULATORY_CAVEATS.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div></div></div>
```

(and the `viewClose` variant using `(x)` as the map parameter) with:

```html
  <div class="card"><div class="card-b">${caveatCollapsed()}</div></div>
```

Do not change the caveat rendering in `viewAccuracy()` - it keeps the full "Regulatory accuracy notes" list.

- [ ] **Step 8: Expose the new helpers**

Add `taxSummary, viewTaxes,` to the `globalThis.__frag` object.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: the new Taxes test and the extended all-views test PASS. The existing settings test still passes (`#s_regime`, `#s_name`, `#s_taxid`, `#s_currency`, `#s_save` all render), and the accuracy test still finds "Regulatory accuracy notes".

- [ ] **Step 10: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && node --test test/ui.test.mjs`
Expected: all pass. Do not commit.

---

### Task 7: Documentation and full verification

**Files:**
- Modify: `/workspace/billing-ledger/README.md`
- Modify: `/workspace/billing-ledger/docs/BACKLOG.md`
- Test: run the full suite

**Interfaces:**
- Consumes: everything above.
- Produces: updated docs and a verified green build.

- [ ] **Step 1: Update the README feature table and test count**

In `/workspace/billing-ledger/README.md`, add rows to the feature table after the mobile quick actions row:

```markdown
| Business/accounting view toggle (Advanced detail) | `setAccountingDetail`, `#detailToggle` |
| Business-first dashboard (snapshot, attention inbox, action cards) | `viewDashboard`, `snapshot()` |
| Grouped navigation (Home / Money / Customers / Taxes / Reports) | `NAV`, `navItems()` |
| Read-only Taxes overview (GST + TDS, no invented input credit) | `viewTaxes`, `taxSummary()` |
```

Update the test counts in the Run block from `58 tests: 36 engine + 22 end-to-end UI` to the numbers printed by the suite in Step 3, and refresh the file-structure note if the UI test count changed.

- [ ] **Step 2: Update the backlog**

In `/workspace/billing-ledger/docs/BACKLOG.md`, add an entry under the completed items:

```markdown
- Business-first UX pass: business/accounting view toggle, grouped navigation,
  business-language term map, dashboard rewritten around a snapshot and a task
  inbox, business activity ledger with an accounting expander, collapsed
  regulatory notes, and a read-only Taxes overview. Spec:
  `docs/superpowers/specs/2026-09-21-business-first-ux-design.md`.
```

- [ ] **Step 3: Run the full suite**

Run: `cd /workspace/billing-ledger && npm run test:all`
Expected: all engine, UI and server tests pass, 0 failures. Record the exact pass count.

- [ ] **Step 4: Run the engine audit harness**

Run: `node /tmp/opencode/frag-audit.mjs`
Expected: `0 findings`. If the harness is missing, recreate it is out of scope; instead run `node --test test/engine.test.mjs` and confirm 36 pass.

- [ ] **Step 5: Smoke-test the server mode**

Run: `cd /workspace/billing-ledger && LEDGER_PORT=8091 node server/index.mjs` in a background terminal, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8091/index.html
```

Expected: `200`. Then check that the served module still contains the new routes:

```bash
curl -s http://127.0.0.1:8091/index.html | grep -c "taxes"
```

Expected: a non-zero count. Stop the server with the background terminal kill tool (never `pkill`).

- [ ] **Step 6: Update the preview**

Re-request the preview for port 8091 so the user sees the redesigned first screen, and confirm the preview connectivity check passes (no `mcai-preview-error` meta).

- [ ] **Step 7: Checkpoint (no commit)**

Run: `cd /workspace/billing-ledger && npm run test:all`
Expected: all pass. Do not commit.

---

## Self-Review

**Spec coverage**

- Section 5 nav restructure -> Task 2.
- Section 6 detail toggle -> Tasks 1, 2 (topbar), 6 (`#s_detail`).
- Section 7 term map -> Task 1 (used in Tasks 2, 5).
- Section 8 dashboard -> Task 4.
- Section 9 ledger -> Task 5.
- Section 10 task inbox -> Task 3.
- Section 11 metric definitions -> Task 3 (`snapshot`).
- Section 11.1 Taxes -> Task 6.
- Section 12 regulatory collapse -> Tasks 4 (dashboard), 5 (ledger), 6 (invoices, close, settings).
- Sections 13-15 state, files, tests -> Tasks 1-7.
- README/backlog -> Task 7.

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every command has expected output.

**Type consistency:** `snapshot()` keys (`billed`, `collected`, `outstanding`, `gstCollected`, `tdsCredits`, `upcoming`) match their uses in Tasks 4 and 6. `businessActivityRows()` row shape (`date`, `clientName`, `activity`, `ref`, `amountPaise`, `status`, `inv`) matches Tasks 4 and 5. `actionItems()` item keys (`tone`, `view`, `headline`, `detail`, `why`, `actionLabel`, optional `amountPaise`, `due`, `inv`, `client`) match Tasks 3 and 4. `caveatCollapsed()` and `term()` signatures are consistent across Tasks 4, 5 and 6. `modalRoot`-free `#ledgerDetailToggle` and `#s_detail` ids are wired exactly once each.

**Note for the implementer:** after every task, delete no files and stage nothing. The project instruction is to leave everything uncommitted in the working tree.
