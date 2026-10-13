# User-Demanded Capabilities - Gap Backlog

The Aurora Ledger UI redesign (see `docs/superpowers/plans/2026-09-16-aurora-ledger-ui.md`)
only addresses look and feel. This backlog lists what real users of a billing
ledger demand that the prototype cannot do yet. Priorities: P0 = without it the
product is a demo, not usable; P1 = expected by most users; P2 = nice to have.

## Status

- Sprint A (P0, items 1-6): **done**.
- Sprint B (P1): items 7 (reports + client statements), 8 (recurring templates),
  9 (delivery: print/PDF document + email draft), 11 (mobile quick actions +
  full-screen modals) and 12 (FX capture + reverse charge / exempt / zero-rated
  treatments) **done**; item 10 (real auth + enforced roles + audit) **done** in
  the backend increment.
- Sprint C (P2): item 13 (server-side persistence) **done** in the backend
  increment; items 14 (attachments / evidence), 15 (bulk actions + keyboard
  workflow) and 16 (reconciliation assistant) **done** in the P2 depth pass.
- Business-first UX pass: business/accounting view toggle, grouped navigation,
  business-language term map, dashboard rewritten around a snapshot and a task
  inbox, business activity ledger with an accounting expander, collapsed
  regulatory notes, and a read-only Taxes overview. Spec:
  `docs/superpowers/specs/2026-09-21-business-first-ux-design.md`, plan:
  `docs/superpowers/plans/2026-09-21-business-first-ux.md`.
- Auth extension: optional **Google sign-in** (real OAuth 2.0 authorization-code
  + PKCE S256, zero dependencies, off unless `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` are set). The sign-in button only renders when the
  server reports it is configured; existing email accounts are linked on first
  Google login. Implementation: `server/google.mjs`, tests:
  `test/server.google.test.mjs`.

The backend increment is specified in
`docs/superpowers/specs/2026-09-19-backend-auth-persistence-design.md` and
planned in `docs/superpowers/plans/2026-09-19-backend-auth-persistence.md`:
zero-dependency Node + `node:sqlite`, users + workspaces + memberships,
revision-based conflict detection, server-enforced roles, append-only audit log.
The static demo mode remains and is unchanged.

## P0 - Blocking usability

1. **Create and edit clients from the UI.** Today clients are seeded only. Users
   must add a client, edit details, and set the tax registration + state/region.
   -> DONE: **Clients** view, `openClientModal`.
2. **Record and edit payments from the UI.** Payments are seeded only. Users must
   record bank credit, withholding, method, reference, and edit/correct them.
3. **Search and filter everywhere.** Free-text search across invoices, clients
   and amounts, plus filters by period, client, status and reconciliation flags.
4. **Full document lifecycle.** Draft -> issued -> sent -> partially paid -> paid
   -> overdue, with the ability to edit, void and issue a **credit note** (the
   engine already supports credit notes; there is no UI to create one).
5. **Data in and out.** Import invoices/payments from CSV and export/backup the
   whole workspace as JSON (not just the ledger CSV), so data is not trapped.
6. **Overdue reminders and a real "what needs action today" view.** Due dates
   exist but nothing surfaces who to chase and when.

## P1 - Expected by most users

7. **Reports users ask for first:** revenue summary, tax summary ready to
   reconcile against a return, receivables aging (30/60/90), and client
   statements.
8. **Recurring invoices / templates** for retainers, generated per period.
9. **Delivery:** export a shareable invoice (PDF or print view) and email/WhatsApp
   link it to the client.
10. **Auth and multi-user with roles that actually restrict actions** (owner,
    bookkeeper, CA firm), plus an activity/audit log.
11. **Mobile-first experience:** create an invoice and record a payment from a
    phone in under a minute.
12. **Currency and tax edge cases:** FX rate on foreign-currency invoices,
    reverse charge, exemptions/zero-rating, and per-line tax categories.

## P2 - Depth and scale

13. **Server-side persistence and backup** (replace browser `localStorage`).
    -> DONE (backend increment).
14. **Attachment capture** (PO, contract, proof of service) attached to a
    document, feeding the coverage-aware accrual evidence.
    -> DONE: `addAttachment` / `removeAttachment` / `attachMilestoneEvidence`;
    attachments live in the workspace state (2 MB per file, 8 MB total, included
    in the JSON backup) and a proof attached to a milestone evidences it.
15. **Bulk actions and keyboard-first workflow** across the tables.
    -> DONE: invoice multi-select with mark sent / paid / void / export CSV and
    j / k / x / Esc keyboard navigation.
16. **Reconciliation assistant** that proposes matches for unmatched bank credits
    and explains each flag in plain language.
    -> DONE: `proposeMatches` + **Reconcile** view; each suggestion carries a
    confidence and a plain-language reason, and nothing changes until accepted.

## P3 - Sharp & Money (final product pass)

17. **Trust and safety**: destructive actions confirm and can be undone; toasts
    announce to assistive tech; dialogs move/trap/restore focus.
    -> DONE: `confirmAction`, `applyVoid` / `applyUnvoid`, toast action buttons,
    `beginModal` / `endModal` / `handleModalKeys`, `role="status" aria-live`.
18. **Collections**: draft and log payment reminders so overdue money gets chased.
    -> DONE: `reminderStage` / `reminderDraft` (friendly / firm / final),
    **Chase payment** drawer with copy + open-in-email + "mark reminder sent",
    `state.reminders`, and a Chase button on overdue attention items. The app
    still never sends email itself.
19. **Activation and revenue**: guide first-run use and surface the plan limit.
    -> DONE: activity-based activation checklist and an upgrade prompt at the
    plan limit. Payment capture is still out of scope: it needs a provider.

## How this corrects the plan

The redesign plan (Tasks 1-8) stays as the visual foundation, but it is not the
product. To meet demand, sequence after the redesign:

- Sprint A (P0): items 1-6 - make it a usable tool instead of a demo.
- Sprint B (P1): items 7-12 - the reports and workflows users expect.
- Sprint C (P2): items 13-16 - depth, scale and integrations.

Each item gets its own short design note before implementation, and every item
keeps the existing rule: exact money, honest labels, no fake functionality.

## P4 - Action-first product critique (current pass)

Source: the attached 18-point product critique. Each point is addressed below.

20. **Home was navigation, not an action dashboard.**
    -> DONE: `viewDashboard` rebuilt around a money hero (outstanding + one-click
    chase), **What needs your attention**, a money strip (Outstanding / Overdue /
    Expected in 7 days / Collected), **Collect now**, **Cash coming in**
    (`cashComingIn`), **Where the money is** (`moneyMap`), **Tax this period**
    (`taxSnapshot`), **Commitments & recurring** (`recurringSummary`), and a
    sample-data/about framing with a role explainer.
21. **"Explain" everywhere.** Every headline figure links to a plain-language
    breakdown: `openExplain` / `explainRows` for outstanding, overdue, expected,
    collected, tax and recurring.
22. **Customers table too weak / "Open Rs0" ambiguous.**
    -> DONE: operational table with health (healthy / watch / at-risk /
    never-invoiced), outstanding, overdue, last invoice, average days to pay,
    terms and contact; a `openCustomerDetail` drawer with contact, tax profile,
    behaviour note, last reminder and full invoice list (`customerStats`).
23. **Client contact / terms / behaviour not captured.**
    -> DONE: client modal now stores email, phone, payment terms, default tax
    treatment and a behaviour note; terms drive invoice due dates.
24. **Invoices lacked lifecycle and communication intelligence.**
    -> DONE: `invoiceLifecycle` strip (drafted / sent / part-paid / settled /
    voided) and `invoiceComms` communication history in invoice detail.
25. **No payment link.** -> DONE: `paymentLinkFor` builds a UPI intent link from
    the business UPI id when the invoice is open, INR and unconfigured-free; it
    is copyable and clearly not a gateway.
26. **Reconcile was not a workflow.** -> DONE: payments labelled matched vs
    unmatched, a manual assign control, and **Match all high-confidence**
    (`acceptAllHighConfidence`).
27. **Computed-vs-filed tax comparison.** -> DONE: `viewTaxes` splits
    CGST/SGST/IGST and offers **Record as filed** (`recordTaxFiled`), storing only
    the user's own figure and stating the app never files.
28. **Commitments naming unclear.** -> DONE: **What is a commitment?** explainer
    at the top of the view, and the nav reads **Upcoming commitments**.
29. **Audit trail needed actor + roles explanation.** -> DONE: `logActivity`
    records the acting role, `viewAudit` lists every action with actor/time and
    exports CSV, and `rolesExplain` documents what each role can do.
30. **Tests and docs.** -> DONE: UI tests raised from 42 to 49 (113 total, all
    green); README feature table and acceptance walkthrough updated.

## P5 - Full accounting & finance platform (from the "Aurora Ledger" brief)

31. **No real double-entry ledger.** -> DONE: pure engine adds
    `defaultChartOfAccounts`, `validateJournal`, `accountBalances`,
    `trialBalance`, `profitAndLoss`, `balanceSheet`, `cashFlow`, `agingBuckets`
    (8 new engine tests in `test/accounting.test.mjs`).
32. **Documents did not post to the ledger.** -> DONE: invoices, credit notes,
    payments, expenses, bills and bill payments derive balanced journals via
    `allJournals` / `generatedJournals`; manual entries live in `state.journals`.
33. **No banking.** -> DONE: **Banking** view with accounts, opening balances
    (posted to equity), CSV statement import, credit-to-invoice matching,
    debit-to-expense filing and ignore, plus unmatch.
34. **No expenses or input tax.** -> DONE: **Expenses** view writes
    `state.expenses`, posts to mapped accounts + input tax, and feeds set-off.
35. **No vendors or accounts payable.** -> DONE: **Vendors** and
    **Bills / payable** views; bills, bill payments, statements, subscriptions.
36. **Statements/reporting thin.** -> DONE: **Financial statements** with P&L,
    balance sheet, cash flow, trial balance, AR/AP aging, sales by customer,
    expenses by category and tax summary.
37. **No chart of accounts or journal UI.** -> DONE: **Chart of accounts**
    (balances by type, add account) and **Journal** (view any entry; add a
    balanced manual entry).
38. **No cash command center.** -> DONE: home **Financial command center**
    (cash, AR, AP, profit, net cash, net tax, 30/90-day forecast, low-cash
    warning) backed by `financeKpis` / `cashForecast`.
39. **No assistant or data trust surfaces.** -> DONE: **Ask Aurora**
    (`aiAnswer`, deterministic, reads only workspace data), **Vendor & spend
    insights**, and **Data quality** checks.
40. **Month-end close lacked a lock.** -> DONE: soft period sign-off with an
    audit record and reopen (`closePeriod`, `reopenPeriod`, `periodLock`).
41. **Tests and docs.** -> DONE: 115 front-end tests (`npm test`) and 140 total
    (`npm run test:all`), all green; reading of input tax updated; README feature
    table extended; this pass spec written.

## P6 - Batch A: traceability, explanation, alerts, margins, GST summary

42. **Numbers were not click-through traceable.** -> DONE: any statement
    account (`data-glaccount`) opens a general ledger with a running balance
    (`generalLedgerRows`, `openGeneralLedger`); each ledger line can open its
    source document (`openSourceDoc`), and generated journals carry a
    `sourceId` (`journalsForSource`).
43. **Assistant answers did not show their working.** -> DONE: every `aiAnswer`
    now returns `why`, `sources`, `calc` and the contributing `txns`, rendered
    by `explainBlock` ("Why and how this was computed") with drill-down to each
    source document.
44. **Alerts were scattered across views.** -> DONE: one **Smart alerts** view
    (`smartAlerts`, `viewAlerts`) with prioritised, reasoned rules: overdue
    invoices, 30-day cash shortfall, unreconciled bank lines, GST
    computed-vs-filed mismatch, month-over-month unusual vendor spend, expenses
    without receipts and revenue concentration. Advisory only; nothing is sent.
45. **No margin or period comparison.** -> DONE: P&L tab adds gross/net margin
    and a this-month-vs-last table with percentage change, honestly showing
    "no prior data" instead of inventing a baseline (`profitComparison`,
    `profitCompareHtml`).
46. **No HSN/SAC or return-shaped tax view.** -> DONE: Financial statements add
    an HSN/SAC summary and a GSTR-style outward/inward working
    (`hsnSummary`, `taxReturnSummary`), clearly labelled as not a filed return.
47. **Tests and docs.** -> DONE: 121 front-end tests (`npm test`) and 146 total
    (`npm run test:all`), all green; README feature table and test counts
    updated; this backlog entry.

## P7 - Batch B: approvals, immutable audit, hard lock, year-end close

48. **Audit log was append-only text, not before/after.** -> DONE: mutations now
    record field-level `changes` (and a `reason` where relevant) via
    `recordChange` / `changeDiff`; the Audit trail view expands each entry to
    show old -> new values. (Still a working log stored with the workspace, not a
    tamper-proof store; stated as such.)
49. **No approvals workflow.** -> DONE: with **Require approval for manual
    entries** on, new manual journals are held (`approval.status: "pending"`)
    and excluded from `allJournals` until an owner/accountant approves; rejected
    entries stay out of the ledger (`requiresApproval`, `approveJournal`,
    `rejectJournal`).
50. **Period lock was only soft.** -> DONE: sign-off can be a **hard lock**
    (`closePeriod(period, {hard:true})`), which blocks new invoices, payments,
    expenses, bills and journals dated in that period via `guardPeriod`; a soft
    sign-off can be upgraded to hard from the Close view.
51. **No year-end close.** -> DONE: **Close financial year** posts one balanced
    journal zeroing revenue/costs/expenses and carrying the net result to
    Retained Earnings (3100) (`yearEndClose`, `financialYearRange`).
52. **Tests and docs.** -> DONE: 125 front-end tests (`npm test`) and 150 total
    (`npm run test:all`), all green; engine audit 0 findings; README counts and
    feature table updated; workspace backup format bumped to version 6 (approval
    and lock fields ride inside existing structures).

## P8 - Batch C: expanded roles and granular permissions

53. **Only three roles, coarse permissions.** -> DONE: six roles now -
    owner, bookkeeper, accountant, auditor, readonly and staff - backed by a
    permission map (`ROLE_PERMS` / `can` in the client, `ROLE_PERMISSIONS` /
    `roleCan` in `server/db.mjs`). The original three keep their exact behaviour.
54. **No read-only or auditor access.** -> DONE: auditor and read-only roles see
    a banner, get no write actions, and are blocked at every write entry point
    (`can("write")` guards in the modal openers); the audit route is hidden and
    refused without the `audit` permission.
55. **Closing, approvals and members were owner-only by accident, not policy.**
    -> DONE: period lock, hard lock, year-end close and the approval toggle
    require `close`; approve/reject requires `approve`; workspaces require
    `members`. Server checks use `roleCan` for write and audit.
56. **Tests and docs.** -> DONE: 128 front-end tests (`npm test`) and 154 total
    (`npm run test:all`), all green; engine audit 0 findings; README roles table,
    counts and feature table updated.

## P9 - Batch D: exports, pagination, receipts, accessibility

57. **Reports were not exportable.** -> DONE: `statementCsv(tab, period)` emits a
    fully quoted CSV for every statement tab (pl, bs, cf, tb, ar, ap, rev, exp,
    hsn, return, tax) with money columns labelled `...Paise`; the Statements view
    has an **Export tab CSV** button (`exportStatementCsv`) matching the on-screen
    tab.
58. **Long lists rendered unbounded.** -> DONE: `pageSlice` / `pagerHtml` give
    Prev / page-of / Next with clamping; wired into the Journal view (50/page,
    `journalPage`) and Audit view (100/page, `auditPage`).
59. **Expenses could not carry a receipt.** -> DONE: `addAttachment` accepts
    `expenseId` / `billId`, `attachmentsForExpense` / `attachmentsForBill` filter
    by parent, and the expense drawer has a **Receipt / supporting document**
    field (same 2 MB / 8 MB in-workspace caps) that attaches and lists receipts.
60. **Accessibility baseline was thin.** -> DONE: a **Skip to main content**
    link targeting `#view` (now `tabindex="-1"`), labelled landmarks
    (`nav aria-label="Primary"`, `main aria-label="Workspace"`), and the mobile
    action bar hides write buttons for roles without `write`; the toast live
    region, focus-visible ring and reduced-motion handling are retained.
61. **Tests and docs.** -> DONE: 133 front-end tests (`npm test`) and 159 total
    (`npm run test:all`), all green; engine audit 0 findings.
62. **One malformed persisted record blanked the whole app.** -> DONE: a
    workspace whose saved state held an invoice missing required fields threw
    during render and produced a blank screen. `repairWorkspace` now runs at
    boot, quarantines records that fail a shape check (kept in `state.quarantine`
    for recovery, never silently deleted) and reports the count, so a single bad
    row can no longer take the app down.

## P10 - Production hygiene (sub-project 1)

Production-readiness pass #1 of 3. Covers the "do not ship a prototype" items
that are correctness and honesty issues. Sub-project 2 (security, approvals,
audit hardening) and sub-project 3 (encryption, backups, monitoring) follow.

63. **Demo language leaked into hosted use.** -> DONE: a runtime `APP_MODE`
    (`LEDGER_MODE` env, `GET /api/config`) defaults to `production` on the
    server and `demo` for the static/file build. `isDemo()` gates every demo
    affordance (topbar badge, dashboard banner, reset controls, palette reset),
    so a hosted workspace never shows sample-data framing.
64. **Destructive actions were one click away.** -> DONE: `guardDestructive`
    requires a typed phrase (workspace name, period, `VOID`, member email) before
    high-impact actions run; demo reset is removed entirely outside demo mode.
65. **Figures had no stated source.** -> DONE: `figureSource(key)` plus
    `docs/figure-sources.md` map every headline figure to its formula and inputs.
66. **Invoices could be issued without a valid tax profile.** -> DONE:
    `taxProfileReady` (engine) blocks issue/import until country, regime,
    currency and a valid tax id are present; drafts stay free.
67. **The server trusted client data.** -> DONE: `server/validate.mjs` shares the
    engine validator; `PUT /state` returns **422 `invalid_state`** with per-field
    errors, and `GET /api/config` reports server mode/time/version.
68. **No loading, error or empty states.** -> DONE: a boot skeleton, a render
    error boundary (`renderErrorCard` with Retry / Go home), `emptyState` with a
    call to action, and a persistent `setSaveError` banner when a save fails.
69. **Close could be signed off with broken data.** -> DONE: `closeBlockers`
    (unbalanced journals, pending approvals, hard payment mismatches, quarantined
    records) hard-blocks sign-off; `closeWarnings` (open receivables, unmatched
    bank lines) informs without blocking. An owner can override with a recorded
    reason written to the audit trail (`state.closeOverrides`).
