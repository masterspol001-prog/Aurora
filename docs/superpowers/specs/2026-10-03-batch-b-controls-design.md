# Batch B - Approvals, immutable audit, hard lock, year-end close

Date: 2026-10-03
Status: Done

## Why

Batch A made the books explainable. Batch B makes them controlled: changes carry
a before/after record, manual entries can require approval, a signed-off period
can actually be locked, and a financial year can be closed to retained earnings.

## Scope

1. **Before/after audit** - field-level diffs with an optional reason.
2. **Approvals** - manual journals held until approved.
3. **Hard period lock** - block entries dated in a locked period.
4. **Year-end close** - zero the P&L for the year into Retained Earnings (3100).

All four are opt-in or additive so the demo and existing workspaces behave as
before.

## Design

### Before/after audit

- `auditSnapshot(obj)` keeps a whitelist of auditable fields.
- `changeDiff(before, after)` returns `{ field, from, to }[]`.
- `logActivity(action, detail, { before, after, reason, actor })` stores
  `changes` and `reason` on the entry; `recordChange` is the convenience wrapper.
- `auditRows()` passes changes through; the Audit trail view expands each entry
  to show old -> new / reason.
- Hooked into client, invoice, payment, recurring, expense, bill, void, journal
  and period mutations.

### Approvals

- `state.settings.requireApproval` (default off) toggled in the Journal view.
- `requiresApproval("journal")` governs manual entries only.
- A new manual entry gets `approval = { status: "pending" }` and is excluded from
  `allJournals` by `isPostedJournal`; `approveJournal` / `rejectJournal` set the
  status. Rejected entries remain out of the ledger.
- Pending and rejected entries are listed under **Held for approval**.

### Hard period lock

- `closePeriod(period, { hard })` records `hard` on the sign-off; default follows
  `state.settings.hardLock`.
- `isPeriodLocked(period)` is only true for a hard lock.
- `guardPeriod(date, what)` returns false and toasts when the date's month is
  hard-locked; it is called from invoice, payment, expense, bill and journal
  create paths.
- The Close view explains soft vs hard and offers **Switch to hard lock**.

### Year-end close

- `financialYearRange(period)` uses Apr-Mar for India and Jan-Dec elsewhere.
- `yearEndClose(period)` builds one journal that debits revenue accounts and
  credits cost/expense accounts, balancing the difference to 3100 Retained
  Earnings, validates it and posts it with `source: "year_end"`.
- `yearEndClosed(period)` detects an existing year-end journal by its ref.

## Honesty and limits

- The audit log is a working log stored with the workspace, not a tamper-proof
  store; it is included in backups.
- The hard lock is enforced in the app, not by a database constraint.
- Year-end close posts a journal only; it files nothing with any authority.
- Approval applies to manual journals only; auto-generated postings are not
  routed through it.

## Verification

- `npm test` 125 (41 engine + 8 accounting engine + 76 UI); `npm run test:all`
  150, all green; engine audit 0 findings.
- New UI tests cover hard-lock blocking and reopen, journal hold/approve, the
  before/after diff, and a balanced year-end entry to retained earnings.
