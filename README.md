# Fragmentation-Aware Billing Ledger

A working prototype of a billing ledger for boutique consultancy founders and
owner-operators. It treats money as exact, shows the consequences of billing
decisions before you make them, works across countries and currencies, and never
pretends to be an accountant.

## Run it

```bash
# from this directory
npm test          # 146 tests: 46 engine + 8 accounting engine + 92 end-to-end UI (node:test)
npm run test:server  # 26 backend tests (node:test)
npm run test:all     # everything (174 tests)
npm run serve     # static demo server on http://localhost:8090
npm run server    # full backend (accounts, workspaces, persistence) on http://localhost:8091
```

Open `http://localhost:8090/index.html` for the offline demo, or
`http://localhost:8091` for server mode.

## Server mode (accounts + persistence)

```bash
npm run server
# then open http://localhost:8091
```

Server mode adds a zero-dependency Node + SQLite backend (`server/`). Register
with an email and password; the first registered user creates a workspace and
becomes its owner. A user can belong to several workspaces and switch between
them. Roles are enforced by the server:

| Role | Can do |
|---|---|
| owner | everything, plus closing periods, approvals and member management |
| bookkeeper | ledger writes and exports; no closing, approvals or member management |
| accountant | read, reports, exports, the audit log and approvals; no ledger writes |
| auditor | read-only plus the audit log and exports |
| readonly | view and export only |
| staff | enter transactions; no closing, approvals or member management |

Concurrent edits are caught with a revision conflict (HTTP 409) instead of
silently overwriting. Every mutating request is written to an append-only audit
log. Sessions are opaque random tokens stored only as SHA-256 hashes in an
`HttpOnly`, `SameSite=Strict` cookie; passwords are scrypt-hashed. Data lives in
`server/data/ledger.db` (gitignored). Set `LEDGER_PORT`, `LEDGER_DB` and
`LEDGER_MODE` to change the port, database file and runtime mode. `LEDGER_MODE`
defaults to `production` (demo affordances hidden); set it to `demo` to show the
sample-data framing. The static demo is always demo mode and still works with no
backend.

### Google sign-in (optional, real OAuth 2.0)

Server mode can also offer **Continue with Google**. It is off by default and the
button appears only when the server is configured. Set:

```bash
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret
# Optional; defaults to http://localhost:$LEDGER_PORT/api/auth/google/callback
export GOOGLE_REDIRECT_URI=https://your-host/api/auth/google/callback
# Optional comma-separated allowlist of email domains
export GOOGLE_ALLOWED_DOMAINS=yourcompany.com
npm run server
```

Register `GOOGLE_REDIRECT_URI` as an authorized redirect URI in the Google Cloud
Console. The flow is a standard authorization-code + PKCE (S256) exchange with a
single-use, 10-minute `state` bound to a `SameSite=Lax` cookie; the returned
`id_token` is checked for audience, issuer, expiry and a verified email. No email
on the allowlist (when set) is rejected. An existing password account with the
same email is linked to Google on first sign-in; a Google-created account has no
usable password until you set one. The static demo never shows the button.

## What is real and what is prototype

- **Real:** all money math (integer minor units, no floats), GSTIN format +
  mod-36 checksum validation, CGST/SGST/IGST splitting, TDS rates and progressive
  capture, multi-currency formatting, credit notes, fragmentation recommendation,
  invoice-to-payment asymmetry detection, coverage-aware accrual, running
  balance, ledger construction, queue aging. All of it is in `engine.js` and
  covered by `test/engine.test.mjs`.
- **Global:** ten tax regimes (India GST, UAE VAT, UK VAT, EU VAT, Australia
  GST, New Zealand GST, Singapore GST, Canada GST/HST, US sales tax, no indirect
  tax) and ten currencies (INR, USD, EUR, GBP, AED, AUD, NZD, SGD, CAD, JPY).
  Only India splits tax into CGST/SGST/IGST; every other regime renders a single
  tax line. Registration-ID checks (GSTIN, ABN, TRN, UK/EU VAT, etc.) validate
  format and checksum only - they cannot prove a number is active or owned.
- **Prototype:** the workspace is seeded with a clearly labelled demo dataset
  ("Demo workspace"). In the static demo, state is saved in the browser
  (`localStorage`) so a reload keeps your workspace. In server mode the same
  state is stored per workspace in SQLite and shared through accounts. Plans are
  illustrative; choosing one takes no payment. No filing, no payment gateway.
- **Not claimed:** accounting or tax correctness, or a replacement for a CA.
  See the **Accuracy & scope** view and the "Regulatory accuracy notes" shown on
  every relevant screen and at the bottom of this file.

## Layout

```
billing-ledger/
├── engine.js              pure, DOM-free billing/accounting engine
├── index.html             self-contained interactive prototype (imports engine.js)
├── store.js               storage adapter: localStorage demo vs server API
├── server/                zero-dependency Node + SQLite backend
│   ├── index.mjs          HTTP server: static app + /api on one port
│   ├── db.mjs             schema, queries, workspace snapshots
│   ├── auth.mjs           scrypt passwords, cookies, tokens
│   ├── routes.mjs         API routes, role checks, rate limiting
│   ├── google.mjs         Google OAuth (PKCE, id_token checks)
│   ├── http.mjs           JSON helpers
│   └── static.mjs         static file serving (path-traversal safe)
├── test/engine.test.mjs   41 engine unit tests
├── test/accounting.test.mjs 8 double-entry engine tests
├── test/ui.test.mjs       84 end-to-end tests that boot the real UI module
├── test/server.*.test.mjs 24 backend tests
└── package.json
```

## Features (mapped to the brief)

| Requirement | Where |
|---|---|
| Fixed-point money, never float | `engine.js` `toPaise` / `asPaise` / `pctOf` / `roundHalfUp` |
| GST split (CGST/SGST intra-state, IGST inter-state) | `gstSplit`, `computeInvoiceTotals` |
| GSTIN validation | `validateGSTIN` (format + official mod-36 checksum) |
| TDS on taxable value excl. GST | `computeTds` |
| Progressive TDS capture (194J needs nature + hours + period, etc.) | `tdsRequirements`, `validateTdsCapture`, invoice modal |
| Fragmentation recommendation, urgent at the 5th invoice | `recommendFragmentation`, `fragmentationState` |
| Role-aware recommendation (owner / bookkeeper / accountant) | sidebar "Viewing as", `recommendFragmentation` |
| Invoice-to-payment asymmetry flags | `detectPaymentAsymmetry` |
| Coverage-aware accrual for research / fixed-fee commitments | `coverageAwareAccrual`, Commitments view |
| Balance history with running balance | `runningBalance`, Balance history view |
| Billing ledger with balanced debit/credit + CSV export | `buildBillingLedger`, Billing ledger view |
| Preview queue with priority / aging / next action | `queueItemStatus`, Preview queue view |
| Month-end close reconciliation | `monthEndClose`, Month-end close view |
| Plain-language demo readout of the calculation and rules | **Demo readout** view |
| GSTIN, place of supply, HSN/SAC on invoices | `computeInvoiceTotals`, invoice detail modal |
| Multi-currency money (INR/USD/EUR/GBP/AED/AUD/NZD/SGD/CAD/JPY) | `CURRENCIES`, `formatMoney` |
| Global tax regimes (single tax line outside India) | `TAX_REGIMES`, `taxSplit`, `taxRegime` |
| Registration-ID validation per regime (GSTIN, ABN, TRN, VAT, ...) | `validateTaxId`, per-regime validators |
| Credit notes that reduce revenue, tax and receivable | `buildBillingLedger`, ledger |
| Plans + usage meter (illustrative, no payment taken) | **Plans** view, `PLANS` |
| Country / currency / business setup, saved in the browser | **Settings** view, `saveState` / `boot` |
| Honest "what's verified / what's not covered" page | **Accuracy & scope** view, `REGULATORY_CAVEATS` |
| Aurora Ledger UI: command palette, dark mode, keyboard-first shell | `openPalette`, `toggleTheme` (Ctrl-K, Ctrl-J) |
| Client management (add/edit, tax ID, region) | **Clients** view, `openClientModal` |
| Payment recording (bank credit, withholding, method, reference) | **Payments** view, `openPaymentModal` |
| Search + filters across invoices, clients, payments, status | `invQuery` / `invStatus` / `clientQuery` / `payQuery` |
| Document lifecycle (draft / sent / paid / overdue / void) + credit notes | `invStatus`, `markInvoice`, `voidInvoice`, `openCreditNote` |
| Needs-action centre (overdue, missing capture, pending review) | **Needs action** view, `actionItems` |
| CSV import for invoices and payments | Settings, `importCsvRows` |
| Full JSON workspace backup / restore | Settings, `exportWorkspace` / `importWorkspace` |
| Client statements (debit / credit, outstanding) | Client row **Statement**, `statementRows` |
| Invoice delivery: printable document + email draft | `openInvoiceDoc`, `invoiceDocumentHtml`, `invoiceMailto` |
| Recurring / retainer templates (manual generate-due) | **Recurring** view, `generateRecurring` |
| FX capture on foreign-currency invoices + base equivalent | `baseEquivalent`, invoice modal currency + rate |
| Tax treatments: reverse charge, exempt, zero-rated | `taxTreatmentLabel`, invoice modal |
| Mobile quick actions (invoice / payment) + full-screen modals | `#mobileActions`, mobile-style |
| Accounts, multiple workspaces per user, server persistence | `server/`, `store.js` |
| Server-enforced roles (owner / bookkeeper / accountant) | `server/routes.mjs` |
| Revision conflict detection (no silent overwrite) | `saveWorkspaceState`, `store.js` |
| Append-only audit log | `audit_log`, `/api/workspaces/:id/audit` |
| Optional Google sign-in (real OAuth 2.0 + PKCE, env-configured) | `server/google.mjs`, `/api/auth/google/*` |
| Reconciliation assistant (proposed payment matches + reasons) | `proposeMatches`, **Reconcile** view |
| Bulk invoice actions + keyboard workflow (j/k/x, Esc) | `bulkMarkSelected`, `handleInvoiceKeys`, Invoices view |
| Attachments: PO / contract / proof-of-service, feeding milestone evidence | `addAttachment`, `attachMilestoneEvidence`, Commitments + invoice detail |
| Business/accounting view toggle (Advanced detail) | `setAccountingDetail`, `#detailToggle` |
| Action-first home dashboard (money hero, attention, collect-now, cash coming in, money map, tax snapshot) | `viewDashboard`, `overdueSummary`, `cashComingIn`, `moneyMap`, `taxSnapshot` |
| Double-entry ledger core (chart of accounts, journals, trial balance, P&L, balance sheet, cash flow) | `defaultChartOfAccounts`, `validateJournal`, `trialBalance`, `profitAndLoss`, `balanceSheet`, `cashFlow` in `engine.js` |
| Automatic posting of invoices, payments, credit notes, expenses and bills to balanced journals | `buildInvoiceJournal`, `buildPaymentJournal`, `buildExpenseJournal`, `buildBillJournal`, `allJournals` |
| Banking: accounts, opening balances, CSV statement import, matching credits to invoices, filing debits as expenses | **Banking** view, `openBankImport`, `bankSuggestions`, `matchTxnToInvoice` |
| Expenses with categories, input tax, bank/cash source and receipt attachments | **Expenses** view, `openExpenseModal`, `expenseAccountFor`, `attachmentsForExpense` |
| Vendors & accounts payable: purchase bills, payments, statements, recurring subscriptions | **Bills / payable** + **Vendors** views, `openBillModal`, `openBillPay`, `openVendorDetail` |
| Financial statements: P&L, balance sheet, cash flow, trial balance, AR/AP aging, sales & expense breakdowns, tax summary, per-tab CSV export | **Financial statements** view, `viewStatements`, `statementCsv`, `exportStatementCsv` |
| Chart of accounts and manual journal entries (must balance) | **Chart of accounts** + **Journal** views, `openAccountModal`, `openJournalModal` |
| Rule-based assistant over your own data ("Ask Aurora") | **Ask Aurora** view, `aiAnswer` |
| Cash-flow forecast (30/60/90), low-cash warning, financial command center | `cashForecast`, `financeKpis`, `dashFinance` |
| Tax set-off (output minus input minus TDS credits) | **Taxes overview** view, `netTaxPaise` |
| Period sign-off (soft lock with audit record) | **Close this month** view, `closePeriod`, `periodLock` |
| Vendor/spend insights and data-quality checks | **Vendor & spend insights** + **Data quality** views |
| Click-through traceability: number to source document to journal to general ledger | `generalLedgerRows`, `openGeneralLedger`, `journalsForSource`, `openSourceDoc` |
| Explainable answers: why, sources read, calculation and the transactions behind every Aurora reply | `aiAnswer` explanation fields, `explainBlock` |
| Smart alerts (overdue, low cash, unreconciled feed, GST mismatch, unusual spend, missing receipts, concentration) with a stated reason | **Smart alerts** view, `smartAlerts` |
| Profitability margins and month-over-month comparison | `profitComparison`, P&L tab |
| HSN/SAC summary and GSTR-style outward/inward return working | `hsnSummary`, `taxReturnSummary`, Financial statements |
| Immutable before/after audit trail (field-level diffs with reasons) | `recordChange`, `changeDiff`, Audit trail view |
| Manual journal approval workflow (held out of the ledger until approved) | `requiresApproval`, `approveJournal`, `rejectJournal`, Journal view |
| Hard period lock that blocks entries dated in a closed period | `isPeriodLocked`, `guardPeriod`, Close this month view |
| Year-end close posting the result to Retained Earnings (3100) | `yearEndClose`, `financialYearRange`, Close this month view |
| Granular, server-enforced permissions across six roles (owner / bookkeeper / accountant / auditor / readonly / staff) | `ROLE_PERMS`, `can`, `ROLE_PERMISSIONS`, `roleCan` in `server/db.mjs` |
| Pagination for long journal and audit tables (prev / page-of / next) | `pageSlice`, `pagerHtml`, `journalPage`, `auditPage` |
| Grouped navigation (Home / Money / Customers / Taxes / Reports) | `NAV`, `navItems()` |
| Explain-anywhere panels ("How this is calculated") | `openExplain`, `explainRows` |
| Operational customers table (health, outstanding/overdue, last invoice, avg days to pay, terms, contact) + customer drawer | `viewClients`, `customerStats`, `openCustomerDetail` |
| Invoice lifecycle strip, communication history, UPI payment link | `invoiceLifecycle`, `invoiceComms`, `paymentLinkFor` |
| Payments workflow: matched vs unmatched, manual assign, Match all high-confidence | `viewPayments`, `viewReconcile`, `acceptAllHighConfidence` |
| Computed-vs-filed tax comparison (records your filing, never files) | `taxSnapshot`, `recordTaxFiled` |
| Audit trail view with acting role + role explainer | `viewAudit`, `rolesExplain`, `logActivity` actor |
| Client payment terms drive invoice due dates | client `terms`, invoice modal due date |
| Read-only Taxes overview (GST + TDS, no invented input credit) | `viewTaxes`, `taxSummary()` |
| Confirm-before-destroy + undo for void, bulk void, reset, detach | `confirmAction`, `applyVoid` / `applyUnvoid`, toast actions |
| Accessible dialogs: focus move, Tab trap, Escape, focus restore, `aria-live` toasts | `beginModal` / `endModal` / `handleModalKeys`, `#toast` |
| Accessibility baseline: skip-to-content link, labelled landmarks, focus-visible ring, reduced-motion support | `.skip-link`, `nav aria-label`, `main aria-label`, `:focus-visible` |
| First-run activation checklist (profile, invoice, payment, chase) | `onboardingSteps`, `onboardingCard` |
| Payment reminders / dunning drafts (friendly, firm, final) with copy + mailto + log | `reminderStage`, `reminderDraft`, `openChase`, `markReminderSent` |
| Printable payment receipt | `receiptHtml`, invoice detail |
| Upgrade prompt when the plan limit is reached | `upgradeBanner`, `overPlan` |

## Acceptance walkthrough

1. Open **Home**. The hero shows outstanding money and, if anything is late, a one-click
   **Chase** for the biggest overdue customer. Below it: **Collect now**, **Cash coming in**,
   **Where the money is**, **Tax this period** and **Commitments & recurring**, each with an
   **Explain** panel that shows exactly how the figure was calculated.
2. Click **+ New invoice**, choose **Acme Retail**, enter a rate, and save.
   The projected recommendation in the modal already says **Urgent**; after saving, open
   **Customers** and Acme Retail's health is **Watch**, and open its drawer to see the
   consolidation recommendation and full invoice/payment history.
3. Click **+ New invoice**, choose **Mira Rao**, pick **194J**. The extra
   progressive-capture fields appear (nature, hours, service period). Try to
   save without filling them: saving is blocked with a clear error.
4. Open **Balance history**: each invoice shows invoice -> payment -> TDS credit
   with a running balance. The Acme sprint-2 payment carries 2 asymmetry flags
   (short bank credit and TDS mismatch).
5. Open **Commitments** and read the **What is a commitment?** explainer, then toggle
   milestone evidence. The research commitment sits at 50% evidence against an 80%
   threshold, so half is deferred; the retainer is fully recognizable.
6. Open **Billing ledger** and click **Export CSV**. Debits equal credits and
   the footer shows **balanced**.
7. Open **Payments**: receipts are labelled matched or unmatched. Record a payment without
   linking it, then open **Reconcile** and use **Match all high-confidence** or a manual
   assign. Finally open **Audit trail** to see each action with the acting role.
8. Switch **Viewing as** between owner / bookkeeper / accountant. The state does
   not change; the recommendation wording does, and the audit view explains each role.
9. Open **Demo readout** for the worked example: each calculation step in plain
   language, the paise check, the rules the engine enforces, and the live
   fragmentation state per client.
10. Open **Settings**, change **Country / tax regime** to e.g. **United Kingdom -
    VAT**. The currency switches to GBP and the workspace is relabelled from
    "Demo workspace" to "Live workspace" once you save. Open **+ New invoice**:
    the tax is now a single **VAT** line in **£** with UK VAT rates, and no
    CGST/SGST.
11. Open **Taxes overview**: the breakdown splits CGST/SGST/IGST, and **Computed vs
    filed** lets you record the figure you filed so the two can be compared (the app
    never files anything, and says so).
12. Open **Plans**: the usage meter shows documents used this period against the
    plan limit. Choosing a plan updates the workspace limit; no payment is taken.
13. Open **Accuracy & scope**: a plain list of what the engine verifies (each
    backed by a test) and, in the same place, what it does not cover.

## Regulatory accuracy notes

- TDS is computed on the taxable value excluding GST. Certain sections (for
  example 194J) can require TDS on the gross amount including GST - confirm with
  your CA.
- GST treatment (place of supply, reverse charge, exemptions) depends on facts
  this prototype does not fully capture.
- Outside India, tax is shown as a single line; intra-country variants (for
  example US state and local sales tax, or Canadian provincial tax) are not
  modelled beyond a single combined rate.
- Registration-ID checks validate format and checksum only. A syntactically
  valid ID may still be inactive or belong to someone else.
- Rates and regimes are examples and change over time; this is not legal or tax
  advice.
- This tool computes and organises figures. It does not file returns and is not
  a substitute for professional advice.

## Launch checklist

- [ ] `npm test` (146), `npm run test:server` (26) and `npm run test:all` (174) all green.
- [ ] `node /tmp/opencode/frag-audit.mjs` (engine invariant audit) reports 0 findings.
- [ ] Copy `.env.example` to your environment and set `LEDGER_MODE=production`,
      `LEDGER_PORT`, `LEDGER_DB`. Leave Google vars blank to hide the button.
- [ ] Serve behind HTTPS so `x-forwarded-proto: https` is present; the server then
      adds `Strict-Transport-Security`.
- [ ] Confirm `GET /api/config` reports `"mode":"production"` (no demo framing).
- [ ] Back up `server/data/ledger.db` (see below) before first real use.

## Security and operations

- Response headers on every request: `Content-Security-Policy` (same-origin,
  inline module/styles allowed), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive
  `Permissions-Policy`, and HSTS when served over HTTPS.
- Sessions are opaque random tokens stored only as SHA-256 hashes in an
  `HttpOnly`, `SameSite=Strict` cookie; passwords are scrypt-hashed; login is
  rate limited (10 attempts / 15 min). Cross-site form posts need the
  `x-ledger-client: 1` header (CSRF guard).
- Workspace isolation is enforced server-side: a non-member gets `403` for any
  workspace route, and role permissions (owner / bookkeeper / accountant /
  auditor / readonly / staff) are checked on the server, not just the client.
- `PUT /state` validates against the shared engine and returns `422` on malformed
  data; concurrent writes are rejected with `409` using revisions.
- No secrets are committed. `.env.example` contains placeholders only.

### Backups and recovery

- The whole database is the single SQLite file `LEDGER_DB` (default
  `server/data/ledger.db`). Back it up with a filesystem copy or
  `sqlite3 ledger.db ".backup backup.db"`.
- To restore, stop the server and replace the database file, then start again.
- In-app, **Settings -> Download backup** exports the workspace JSON and
  **Restore backup** imports it; damaged records are quarantined rather than
  deleted.

## Known limitations

- This is not a security-certified product and has not had an external audit.
- No automatic email, no payment gateway, no bank feed, no tax-authority filing.
- The reconciliation and audit features are app-level controls, not a
  tamper-proof store.
- Figures are only as complete as the records entered; closing the period warns
  on open receivables and unmatched bank lines and blocks on broken data.
#   A u r o r a  
 