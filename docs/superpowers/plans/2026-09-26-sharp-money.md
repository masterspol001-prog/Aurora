# Sharp & Money implementation plan

Spec: `docs/superpowers/specs/2026-09-26-sharp-money-design.md`

## Phase 1 - Sharp & Safe

1. Head: meta description, inline SVG favicon, branded title.
2. CSS: toast action button, toast flex, dialog focus reset.
3. `#toast` -> `role="status" aria-live="polite"`.
4. `toast(msg, kind, opts)` action support.
5. Modal lifecycle helpers `beginModal`/`endModal`/`focusDialog` +
   `handleModalKeys` (Escape + Tab trap), registered on `document`.
6. Rewire `openDrawer`, `openPalette`, `openInvoiceDetail`, `closeModal`,
   `confirmAction` to the lifecycle.
7. `applyVoid`/`applyUnvoid`; `voidInvoice` confirms then applies; bulk void
   confirms then applies; `resetDemo` confirms then `doResetDemo`.
8. `removeAttachment` undo toast.
9. Invoice search: extract `invoiceRowsHtml`, add `#invRows`/`#invCount`, add
   `paintInvoiceRows`, wire search to it.

## Phase 2 - Money Maker

10. `state.reminders`, `state.ui.onboardingDismissed`; persist in save/export/
    import/reset/boot; `emptyState` gains `reminders`.
11. `onboardingSteps()` + `onboardingCard()` on Home + dismiss wiring.
12. `reminderStage`, `reminderDraft`, `openChase`, `markReminderSent`; Chase
    buttons on invoice detail and overdue attention items; wiring.
13. `receiptHtml` + per-payment Receipt button.
14. `overPlan()` upgrade banner on Home.
15. Export new symbols on `__frag`.

## Verification

- `npm run test:all` green; add UI tests for the new pure functions/mutations.
- Engine audit `/tmp/opencode/frag-audit.mjs` -> 0 findings.
- Smoke-test server mode on 8091 (index 200, API reachable).
