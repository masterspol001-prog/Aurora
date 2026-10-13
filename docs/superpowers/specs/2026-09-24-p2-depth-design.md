# P2 depth pass - attachments, bulk actions, reconciliation assistant

Status: implemented and verified. Completes backlog P2 items 14-16.

## Constraints kept

Single `index.html` + `engine.js`, no build step, no npm dependencies, exact
integer money, honest labels, no fake functionality, demo (`localStorage`) and
server (SQLite snapshot) modes share one code path, all prior tests stay green.

## 14. Attachments

- `state.attachments: [{ id, name, type, size, kind, invoiceId, commitmentId,
  milestoneIndex, addedAt, dataUrl }]`.
- Stored as base64 data URLs **inside the workspace state** so the same code
  works in demo mode and server mode and attachments travel in the JSON backup.
- Limits, enforced with a clear message: 2 MB per file, 8 MB per workspace. This
  is not object storage and is not encrypted at rest; said so in the UI.
- Attached from the invoice detail modal (PO / contract / other) and from a
  commitment milestone ("Attach evidence").
- Feeding accrual: attaching a proof sets `milestone.evidence = attachmentId`.
  `coverageAwareAccrual` already treats any truthy evidence as evidenced, so the
  recognize/defer amounts update with no engine change. Removing the attachment
  clears the evidence flag it set.

## 15. Bulk actions + keyboard workflow

- Invoices view gains a selection column, a select-all box and a bulk toolbar
  (Mark sent, Mark paid, Export CSV, Void, Clear) shown only when something is
  selected.
- Keyboard on the Invoices view (ignored while typing or a modal is open):
  `j` / `k` move focus, `x` toggles selection, `Esc` clears.
- Bulk handlers are pure state mutations (`bulkMarkSelected`, `bulkVoidSelected`,
  `bulkExportSelectedCsv`) so they are unit-testable without DOM events.
- Selection (`state.invSelection`) is transient and never persisted.

## 16. Reconciliation assistant

- New pure engine function `proposeMatches({ payments, invoices, currency })`.
  The caller supplies each invoice's `openPaise`. For every payment, candidates
  are scored: same customer + exact amount = high confidence; same customer
  partial/over = medium; exact amount for a different customer = medium with an
  explicit "confirm before applying" warning; otherwise unmatched.
- Every proposal carries a plain-language `reason`.
- New **Reconcile** view lists suggestions with the reason and confidence label
  and only changes data when the user clicks Accept (which links the payment to
  the invoice and marks it paid when settled). A second section lists linked
  receipts that still carry a flag, using the existing `reconcileInvoice`.
- The nav shows a count of pending suggestions.

## Verification

- `engine.js`: 5 new `proposeMatches` tests (exact, partial, cross-customer,
  unmatched, void/settled exclusion).
- `ui.test.mjs`: 5 new tests covering suggestion+accept, bulk mark/void,
  attachment attach/detach, milestone-evidence feed/clear, and route reachability.
- `npm test` 77/77, `npm run test:all` 100/100, engine audit 0 findings.
