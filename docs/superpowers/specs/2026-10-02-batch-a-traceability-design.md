# Batch A - Traceability, explainability, alerts, margins and GST summary

Date: 2026-10-02
Status: Done

## Why

The full finance platform (P5) made the books correct, but the numbers were still
opaque: a figure on a report could not be clicked back to the transaction and the
journal that produced it, the assistant gave a number without showing its work,
risk signals were spread across views, and there was no margin comparison or
HSN/GSTR-shaped tax view.

Batch A closes the five "trust and interpretation" gaps the 20-area review found,
without changing the data model, the role contract or the demo behaviour.

## Scope

1. **Click-through traceability** - number -> source document -> journal -> general
   ledger -> report.
2. **Explainable AI** - every Aurora answer states why it was asked, which record
   types it read, the calculation, and the contributing transactions.
3. **Centralised smart alerts** - one prioritised, reasoned view.
4. **Profitability margins + period comparison** - margins and MoM change on P&L.
5. **HSN/SAC summary + GSTR-style return working.**

## Design

### Traceability

- `journalsForSource(sourceId)` finds the generated journals for a document.
- `generalLedgerRows(code, from, to)` returns every journal line for an account
  with a running balance signed by the account's normal side.
- `openGeneralLedger(code, from, to)` renders it in a drawer; each line with a
  `sourceId` shows a **source** button.
- `openSourceDoc(source, sourceId)` routes to the invoice / expense / bill /
  payment / credit note that created the entry.
- Statement account names (`stmtLines`), trial-balance rows and chart-of-accounts
  codes are buttons carrying `data-glaccount`.
- No new stored fields: `sourceId` already existed on generated journals.

### Explainable AI

- `aiAnswer` returns, in addition to `title`/`body`/`go`:
  - `why` - the interpretation of the question,
  - `sources` - the record types read,
  - `calc` - the human-readable formula,
  - `txns` - the contributing transactions (with `source`/`sourceId` where known).
- `explainBlock(a)` renders these under a collapsible "Why and how this was
  computed" panel, with an **open** button per transaction.
- The assistant remains deterministic, reads only workspace data, calls no
  external model and cannot mutate anything.

### Smart alerts

- `smartAlerts()` evaluates rules over existing data only:
  overdue invoices; a 30-day cash shortfall vs cash on hand; unreconciled bank
  lines; GST computed-vs-filed mismatch; month-over-month vendor spend > 1.5x;
  expenses without receipts; revenue concentration >= 40% in one customer.
- Each alert carries `level` (high / medium / low), `title`, `why` (the reason it
  fired) and a `go` link. Sorted high-first; high count shown in the nav badge.
- The **Smart alerts** view (`viewAlerts`) is advisory: nothing is escalated or
  sent automatically.

### Margins and comparison

- `profitComparison()` compares the selected month with the previous month from
  posted journals and computes gross/net margins and percentage deltas.
- `profitCompareHtml()` renders the table; a month with no prior revenue shows
  "no prior data" rather than an invented baseline.

### HSN/SAC and return working

- `hsnSummary()` groups the selected month's invoice lines by HSN/SAC + rate.
- `taxReturnSummary()` produces rate-banded outward (sales) and inward
  (expenses + bills) supplies with a net position.
- Both are surfaced as **HSN / SAC** and **Tax return** tabs on Financial
  statements and are labelled as working summaries, not filed returns.

## Honesty and limits

- Alerts and the assistant are rule-based over stored records and state their
  reason; no external service is contacted.
- The return view is a GSTR-style working only and does not file anything.
- Margins use this month's revenue as the denominator; comparison needs a prior
  month to be meaningful.
- Foreign-currency invoices remain excluded from posting and therefore from
  these reports.

## Verification

- `npm test` 121 (41 engine + 8 accounting engine + 72 UI); `npm run test:all`
  146, all green.
- Engine audit `/tmp/opencode/frag-audit.mjs`: 0 findings.
- New UI tests cover the general-ledger running balance, journal source linking,
  the Aurora explanation block, smart alerts and nav route, margin comparison,
  and the HSN/return tabs rendering without `NaN`/`undefined`.
