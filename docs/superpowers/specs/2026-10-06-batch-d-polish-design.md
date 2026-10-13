# Batch D - exports, pagination, receipts, accessibility

Date: 2026-10-06
Status: DONE
Scope: fourth and final batch of the 20-area 10/10 checklist (low/medium
priority). No new finance behaviour, no schema change, no build step.

## Goals

Close the smaller gaps that stopped several areas from scoring a clean 10/10:
report exportability, long-list usability, expense documentation, and baseline
accessibility of the shell.

## 1. Per-report CSV export

- `statementCsv(tab, period)` builds a fully quoted CSV for every entry in
  `STATEMENT_TABS` (pl, bs, cf, tb, ar, ap, rev, exp, hsn, return, tax). Each
  report owns its own column layout; money columns are labelled `...Paise` so the
  integer-minor-unit convention is explicit and lossless.
- `exportStatementCsv()` writes the CSV for the currently selected tab using
  `downloadText` and confirms with a toast. The Statements view gains an
  **Export tab CSV** button (`data-stmtexport`) next to the tab strip, so the
  export always matches what is on screen.

## 2. Pagination for long lists

- `pageSlice(items, pageKey, pageSize)` reads the page number from persisted
  workspace state, clamps it to the valid range, and returns the visible slice
  plus `{ page, pages }`.
- `pagerHtml(pageKey, page, pages, total)` renders Prev / "Page x of y" / Next,
  disabling the ends and rendering nothing when there is a single page.
- Wired into the Journal view (50 rows/page, `journalPage`) and the Audit view
  (100 rows/page, `auditPage`), which previously rendered unbounded tables.

## 3. Expense receipt attachments

- `addAttachment` now accepts `expenseId` and `billId` (previously invoice /
  commitment / milestone only), and the record carries both fields.
- `attachmentsForExpense(id)` / `attachmentsForBill(id)` filter the workspace
  attachment store by parent.
- The expense drawer gains a **Receipt / supporting document** field: selecting a
  file attaches it immediately (same 2 MB / 8 MB caps and in-workspace storage as
  invoice attachments) and lists existing receipts with an `open` link. New
  expenses generate their id up front so a receipt can be attached before save.

## 4. Accessibility pass

- A **Skip to main content** link (`.skip-link`) is the first focusable element
  and targets `#view`, which is now `tabindex="-1"`; it is hidden until focused.
- Landmarks are labelled: `<nav aria-label="Primary">` and
  `<main aria-label="Workspace">`.
- The mobile action bar hides its write buttons (+ Invoice, + Payment) for roles
  without the `write` permission, matching the desktop topbar.
- The existing toast live region (`role="status" aria-live="polite"`), global
  `:focus-visible` ring and `prefers-reduced-motion` handling are retained.

## Tests

- 5 new front-end tests (133 front-end, 159 total, all green):
  - every statement tab exports a multi-column CSV with a header;
  - pagination slices and clamps out-of-range pages, and omits a single-page pager;
  - an expense receipt attaches, filters by parent and renders in the drawer;
  - the shell exposes the skip link, labelled landmarks and the live region;
  - a malformed persisted invoice is quarantined at boot instead of blanking the app.
- Engine audit harness: 0 findings.

## Post-release hardening

- Preview surfaced a **corrupted persisted workspace** (an invoice saved with only
  `id` and `totals`, missing `lineItems` / `clientName` / `date`), which threw
  during render and produced a blank page. Beyond repairing that workspace,
  `repairWorkspace()` now runs on every boot: it shape-checks invoices, moves bad
  records to `state.quarantine` (preserved, not deleted) and toasts the count.
  Quarantine rides along in the saved snapshot.

## Honesty notes

- CSV money is exported in paise to avoid display-rounding loss; the column name
  says so.
- Attachments live inside the workspace (localStorage / server snapshot), are
  size-capped, and are not a substitute for a document-management system.
- Accessibility work is a baseline (skip link, landmarks, focus, reduced
  motion); a full WCAG audit and screen-reader testing are still recommended.
