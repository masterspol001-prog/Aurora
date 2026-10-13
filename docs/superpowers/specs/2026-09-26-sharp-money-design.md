# Sharp & Money: final product pass

Date: 2026-09-26
Status: approved (both phases)

## Problem

A static audit of `index.html` found trust, accessibility and commercial gaps
that stop the prototype from feeling like a sellable product:

1. Destructive actions (void, bulk void, reset demo, remove attachment) run with
   no confirmation and no undo.
2. `#toast` has no `role="status"`/`aria-live`, so all feedback is silent to
   assistive tech.
3. Drawers/modals declare `aria-modal` but never move focus in, trap Tab, or
   restore focus on close.
4. Invoice search re-renders the entire app per keystroke.
5. Weak first-run: one welcome line, no guided path to value.
6. No collections workflow: overdue invoices offer only "View invoice"; there is
   no reminder/dunning draft. This is the main revenue gap for a receivables tool.
7. No in-app upgrade prompt tied to the plan limit.

Empty states already exist across tables, so item 9 of the audit is dropped.

## Scope

Two phases, both in scope, tests kept green, no commits.

### Phase 1 - Sharp & Safe

- `confirmAction({title, body, confirmLabel, danger, onConfirm})` modal.
  Applied to single void, bulk void and reset demo.
- Undo: `toast(msg, kind, {label, onAction})` gains an action button. Void and
  bulk void expose "Undo"; attachment removal exposes "Undo".
- `#toast` becomes `role="status" aria-live="polite"`.
- Modal focus lifecycle: `beginModal()` remembers `document.activeElement`,
  `endModal()` clears and restores focus. Dialogs get `tabindex="-1"` and are
  focused on open. A global key handler closes on Escape and traps Tab inside
  `#modalRoot`. Applies to drawer, palette, invoice detail and confirm.
- Invoice search updates only the invoice table body (new `#invRows`) instead of
  re-rendering the whole app, so the caret never jumps.
- Branded `<title>`, meta description, inline SVG favicon.

### Phase 2 - Money Maker

- Activation checklist on Home, derived from `state.activity` so seeded demo data
  does not count: confirm tax profile, create an invoice, record a payment, chase
  a payment. Progress bar, deep links, dismissible (`state.ui.onboardingDismissed`).
- Collections: pure `reminderStage(inv)` and `reminderDraft(inv, stage)` for
  friendly / firm / final stages; a "Chase payment" action on open invoices and
  on overdue attention items; drawer with editable message, copy, open-in-email
  (mailto) and "Mark reminder sent" which appends to `state.reminders` and logs
  activity.
- Printable payment receipt: pure `receiptHtml(payment)` plus a per-payment
  "Receipt" button in invoice detail, routed through the existing `printHtml`.
- Upgrade prompt on Home when `overPlan()`.

## Honest limits (unchanged)

No payment gateway, payment links or server-side email. Reminders open the user's
own mail client and are never sent by the app. Attachments stay in workspace
state and are not encrypted at rest.

## Data changes

- `state.reminders: []` (id, invoiceId, stage, at, channel, amountPaise).
- `state.ui.onboardingDismissed: false`.
- `saveState` payload, `exportWorkspace` (version 4), `importWorkspace`,
  `resetDemo`, `boot` and server `emptyState` all carry `reminders`.
  `ui` is already saved wholesale, so `onboardingDismissed` rides along.

## Testing

New pure functions and state mutations are exported on `__frag` and covered by
`test/ui.test.mjs`: `reminderStage`, `reminderDraft`, `receiptHtml`,
`onboardingSteps`, `applyVoid`, `applyUnvoid`, `markReminderSent`. Existing
engine/server suites must stay green (`npm run test:all`).
