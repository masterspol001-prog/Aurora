# Sub-project 1 - Production hygiene & correctness

Date: 2026-10-08
Status: APPROVED FOR IMPLEMENTATION
Scope: first of three production-readiness sub-projects. Covers items #1, #2,
#3, #4, #5, #8 and #10 of the production checklist. Items #6, #7 (security,
approvals, audit) are sub-project 2; item #9 (encryption, backups, monitoring)
is sub-project 3. This spec does not touch them.

Constraints carried over: no build step, no new runtime dependencies, exact
integer minor units, every existing route id keeps working, demo mode behaves
exactly as before, all existing tests stay green.

## Goal

Make the app safe to run as a real ledger: no demo affordances in production,
destructive actions guarded, tax profile confirmed before anything is issued,
writes validated so a malformed record can never be persisted or blank the app,
every figure tied to the ledger, and closing a period blocked while unresolved
errors exist.

## Approach (chosen)

Mode-aware shell plus shared validation. One codebase. The server imports the
existing DOM-free `engine.js` so business rules have a single source of truth.
Rejected alternatives: a build-time production bundle (this project has no build
step, two variants would drift) and a server-authoritative rewrite (disproportionate,
discards tested code).

## 1. Mode and configuration

- New env `LEDGER_MODE`: `production` (default) or `demo`.
- New route `GET /api/config` returns `{ mode, serverTime, version }`.
- Client boot fetches `/api/config`. Missing server or fetch failure means the
  static build, which is always `demo`.
- Module-level `APP_MODE` plus `isDemo()`. Every demo affordance checks
  `isDemo()`; nothing else branches on mode.
- The workspace "Live workspace / Demo workspace" badge is replaced by nothing in
  production and by the demo badge in demo mode.

## 2. Demo language and destructive guards (items 1, 2)

Demo-only (rendered only when `isDemo()`):
- "Demo workspace" badge in the topbar.
- Sample-data banner on the dashboard.
- "Reset demo data" in the command palette, dashboard banner and Settings.
- The free-plan "Demo workspace" feature string stays in the pricing data but is
  only relevant in demo mode.

`guardDestructive({ title, body, confirmLabel, phrase, onConfirm })` renders a
typed-confirmation dialog: the confirm button stays disabled until the user types
`phrase` exactly. Applied to:
- Reset demo data: phrase is the workspace name (demo only).
- Reopen a signed-off period / reopen a closed financial year: phrase is the
  period (for example `2026-10`).
- Bulk void: phrase is `VOID`.
- Remove a member: phrase is the member email.
- Delete workspace: phrase is the workspace name.

Every other destructive action keeps the existing `confirmAction` dialog.

## 3. Tax-profile gate (item 4)

- `taxProfileReady()` returns `{ ready, missing: [...] }`. It is ready when:
  - a country and regime are set;
  - a currency is set;
  - for every regime other than `NONE`, `validateTaxId(company.gstin, regimeId).valid`
    is true (the company tax id lives in `company.gstin` today; the regime's
    `validateId` decides the accepted format).
- Drafts save and edit freely.
- Issuing (finalising) an invoice, "Generate due" auto-issue, and any path that
  finalises an invoice are blocked while not ready. The block message names the
  missing fields and links to Tax settings.
- Server re-checks `taxProfileReady` on the issue transition. If a client issues
  without it, the write is rejected with 422 `tax_profile_incomplete`.

## 4. Authoritative status and server validation (item 5)

- Invoice/payment status stays derived from data by a single formula in
  `engine.js` and is never stored as independent truth.
- New `server/validate.mjs` imports `engine.js` and validates a workspace
  snapshot before persistence:
  - top-level shape: expected collections are arrays, `settings`/`company` are
    objects, `period` matches `YYYY-MM`;
  - money: every `*Paise` value is a safe integer (no floats, no NaN);
  - invoices: `validateInvoice` passes, `lineItems` is an array, computed totals
    equal stored totals;
  - journals: `validateJournal` balances to the paise;
  - ids: unique within each collection.
- On failure the server returns **422** with `{ error: "invalid_state",
  errors: [{ path, message }] }`. Nothing is persisted.
- The client shows the field-level errors inline and keeps the user's local
  changes so nothing is lost.
- Revision conflicts stay 409 as today.

## 5. Figure provenance audit (item 3)

- `figureSource(key)` returns, for each dashboard and statement figure, the
  derivation (which journals/accounts/invoices feed it).
- Every KPI and statement number renders a "source" affordance (`data-figsrc`)
  that opens the explanation panel showing the derivation.
- A sweep removes any hard-coded or sample-derived number from a displayed
  figure. Deliverable: a figure-source map in `docs/figure-sources.md` listing
  each figure and its derivation.

## 6. Loading, error and empty states (item 8)

- Boot renders a skeleton until `/api/config` and the workspace load resolve.
- `render()` wraps the view dispatch in an error boundary: a thrown view renders
  an error card with the message, a Retry button and a "Go home" button, never a
  blank page. The error is logged once per distinct message.
- `saveState` failures surface a persistent banner (offline / 409 / 422) with a
  Retry action.
- One `emptyState({ title, body, cta })` helper standardises empty tables and
  lists.

## 7. Close guard (item 10)

- `closeBlockers(period)` returns hard blockers:
  - unresolved payment mismatches (payment asymmetry flagged on invoices);
  - journals that do not balance;
  - journals still pending approval;
  - records currently in `state.quarantine`.
- `closeWarnings(period)` returns non-blocking items: open receivables, missing
  receipts, unmatched bank lines.
- Sign-off is disabled while any hard blocker exists. An owner may override only
  through a typed-reason dialog; the reason is stored on the period record and
  written to the audit log, and shown thereafter.
- `closePeriod` re-checks blockers; the server rejects a close that has blockers
  without an override reason (422 `close_blocked`).

## 8. Files touched

- `index.html`: APP_MODE boot, `isDemo`, demo gating, `guardDestructive`,
  `taxProfileReady` gate, figure-source affordances, skeleton/error/empty
  helpers, close guard UI.
- `engine.js`: `taxProfileReady`, `closeBlockers`, `closeWarnings`, `figureSource`
  (DOM-free, unit-testable).
- `server/validate.mjs` (new): snapshot validation using `engine.js`.
- `server/routes.mjs`: `/api/config`; call validation before
  `saveWorkspaceState`; tax-profile and close-blocker checks on their transitions.
- `server/index.mjs`: pass `LEDGER_MODE` into the router.
- `store.js`: fetch `/api/config`, expose mode.
- Tests: `test/engine.test.mjs`, `test/ui.test.mjs`, `test/server.routes.test.mjs`.
- Docs: `docs/superpowers/specs/2026-10-08-production-hygiene-design.md`,
  `docs/BACKLOG.md`, `README.md`.

## 9. Tests and acceptance

Tests:
- engine: `taxProfileReady` (India GST, VAT, none), `closeBlockers` /
  `closeWarnings`, `figureSource`.
- UI: production hides demo strings and reset; typed confirmation blocks until
  the phrase matches; issue blocked until tax profile ready; error boundary
  renders a card and Retry; close disabled with blockers and allowed with an
  owner override reason.
- server: snapshot with malformed money / unbalanced journal / bad invoice ->
  422 with field paths and no persistence; issue without tax profile -> 422;
  close with blockers without override -> 422.

Acceptance (maps to the production bar):
- With `LEDGER_MODE=production` the DOM contains no demo strings and no reset
  control; demo mode is unchanged.
- A malformed write is rejected and never persisted; a broken view degrades to an
  error card.
- An invoice cannot be issued before the tax profile is confirmed.
- A period with a payment mismatch or unbalanced journal cannot be signed off
  without a recorded owner override.
- No displayed figure is synthetic.
- `npm run test:all` green and the engine audit harness reports 0 findings.

## 10. Non-goals

- Item 9: encryption at rest, backups/recovery, monitoring/alerts, HTTPS
  termination. Sub-project 3.
- Item 6/7 beyond current: per-route role tests and approval for close/tax
  changes. Sub-project 2. (The close override reason and its audit are included
  here because they are inseparable from the close guard.)
