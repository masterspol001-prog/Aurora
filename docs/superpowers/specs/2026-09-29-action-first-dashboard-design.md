# Action-first product pass - design

Date: 2026-09-29
Status: implemented
Scope: `index.html` (prototype UI), `server/db.mjs` (empty state), tests, docs.

## Why

The product was feature-rich but the home screen behaved like navigation: a
snapshot and a set of links. A founder opening the app wants to know one thing -
what do I do about my money right now? This pass turns each screen into an
action surface and closes the operational gaps in customers, invoices, payments,
tax, commitments and audit.

## Principles (unchanged)

- Money is exact integer minor units. No float arithmetic, ever.
- No fake functionality: no invented tax, no fake charges, no server-side email,
  no payment gateway. The app drafts and records; it never sends or files.
- Label demo data. Every derived figure must be explainable.
- Keep the single-file, no-build, no-dependency constraint. Demo mode must
  behave exactly as before.

## What changed

### 1. Home becomes an action dashboard (`viewDashboard`)

Pure, testable helpers feed small render functions:

- `overdueSummary()` - count, total, oldest age, invoice list.
- `cashComingIn(days)` - open invoices due within the window.
- `moneyMap()` - invoiced / received / outstanding / overdue / unmatched /
  recurring next 30 days.
- `taxSnapshot()` - taxable, CGST/SGST/IGST, total tax, TDS, invoice count.
- `recurringSummary()` - active templates, next-30-day value, due count.
- `explainRows(kind)` - rows + note + total for each explainable figure.
- `customerStats(clientId)` - billed, outstanding, overdue, oldest overdue days,
  last invoice, last payment, collected, average days to pay, terms, health.

Sections: hero (greeting, outstanding, chase CTA), attention, money strip,
collect-now, cash coming in, money map, tax, commitments & recurring, recent
activity, about-this-data (sample framing + role explainer). `openExplain`
renders the "How this is calculated" drawer.

### 2. Customers are operational (`viewClients`, `openCustomerDetail`)

The table shows health (healthy / watch / at-risk / never-invoiced), outstanding
and overdue, last invoice, average days to pay, terms and contact. The drawer
adds the tax profile, behaviour note, last reminder, the consolidation
recommendation and the full invoice list. Client records gain `email`, `phone`,
`terms`, `taxTreatment` and `note`; `terms` now drives the due date on new
invoices.

### 3. Invoice lifecycle and communication (`invoiceLifecycle`, `invoiceComms`)

A lifecycle strip (drafted / sent / part-paid / settled / voided) and a
communication history built from reminders and invoice status changes. "Mark
sent" records `sentAt`.

### 4. Payment link (`paymentLinkFor`)

Builds a `upi://pay` intent link from the business UPI id for an open INR
invoice. Copyable. Explicitly not a gateway - the bank statement remains the
source of truth.

### 5. Payments and reconciliation as a workflow

Payments are labelled matched or unmatched, with a jump to Reconcile. Reconcile
adds a manual assign control and **Match all high-confidence**, which accepts
only proposals the engine scored as high confidence.

### 6. Computed vs filed tax (`recordTaxFiled`)

Taxes view splits CGST/SGST/IGST and compares the computed output tax with the
figure the user records as filed, storing only their own number and stating the
app never files.

### 7. Commitments and audit

Commitments gains a "What is a commitment?" explainer. `logActivity` now records
the acting role; a new **Audit trail** view lists every action with actor and
time and exports CSV, plus a role explainer.

## Non-goals

- No tax filing, no payment processing, no server-side email.
- No scheduler: recurring invoices still generate manually.
- No change to the demo/server split or the file-based architecture.

## Verification

- `npm test` - 90 tests (41 engine + 49 UI).
- `npm run test:all` - 113 tests, all green.
- Engine audit harness - 0 findings.
- New UI tests cover customer health, overdue/cash/explain, invoice lifecycle,
  payment link gating, tax snapshot, accept-all matching and the audit view.
