# Aurora Ledger - Full Accounting & Finance Platform

Date: 2026-09-30
Status: implemented

## Goal

Turn the billing-ledger prototype into a credible small-business finance
platform: keep the existing billing engine, add a real double-entry ledger and
the operational workflows around it (banking, expenses, vendors/AP), and expose
statements, tax set-off, forecasting, an assistant and data-quality checks -
without a build step, without new dependencies, and without pretending to do
anything a small app cannot honestly do.

## Hard constraints

- Single `index.html` + `engine.js`, no bundler, no npm runtime deps.
- Money is integer minor units everywhere; no float arithmetic on money.
- Demo mode (`localStorage`) must behave exactly as before; all prior tests stay
  green, and all existing route ids keep working.
- No fake capability: no filing, no payment gateway, no server-side email, no
  guarantee of tax correctness.
- Every posted journal must balance to the paise.

## Architecture

### Pure ledger core (`engine.js`)

New, DOM-free and unit-tested:

- `defaultChartOfAccounts()` - assets, liabilities, equity, revenue, COGS,
  expenses; each account has a normal balance and a cash-flow class.
- `validateJournal(entry)` - at least two lines, no debit-and-credit line,
  debits equal credits.
- `accountMovement`, `accountBalances` (normal-balance aware).
- `trialBalance`, `profitAndLoss`, `balanceSheet`, `cashFlow`, `agingBuckets`.

### Derived posting layer (`index.html`)

Documents are not silently mutated into stored entries. Instead journals are
derived on read:

- `buildInvoiceJournal` - Dr Accounts Receivable; Cr Sales + Output tax.
- `buildPaymentJournal` - Dr Bank + Dr Input tax/TDS credit; Cr Receivable.
- `buildCreditNoteJournal` - reverse of an invoice.
- `buildExpenseJournal` - Dr expense + Input tax; Cr bank/cash.
- `buildBillJournal` - Dr expense + Input tax; Cr Accounts Payable.
- `buildBillPaymentJournal` - Dr Payable; Cr Bank.
- `generatedJournals()` concatenates these; `allJournals()` adds manual entries
  in `state.journals`.

Because the source records are the existing invoices/payments/etc., old
workspaces keep working and no migration is needed. Foreign-currency invoices
are excluded from the ledger (documented in the statements view) until an FX
posting model exists.

### State

Added: `coa`, `journals`, `bankAccounts`, `bankTxns`, `expenses`, `vendors`,
`bills`, `billPayments`, `subscriptions`, `periods`. All are persisted by
`saveState`, included in export/import (backup version 5), hydrated on boot and
present in the server `emptyState`. Demo seed adds two bank accounts, four
vendors, five expenses, two bills (one paid), three subscriptions and a bank
feed with matched plus two unmatched lines; opening balances post to equity so
the balance sheet balances.

## Views

- Home: **Financial command center** (`dashFinance`) - cash, AR, AP, estimated
  profit, net cash, net tax, 30/90-day forecast, low-cash warning.
- Finance: **Banking**, **Expenses**, **Bills / payable**, **Vendors**,
  **Financial statements**, **Chart of accounts**, **Journal**.
- Home: **Ask Aurora** (rule-based assistant).
- More: **Vendor & spend insights**, **Data quality**.
- Taxes: input GST and set-off added to **Taxes overview**.
- Close: soft period sign-off / reopen.

## Honesty and limits

- Statements are computed from recorded journals and labelled as such.
- Input tax credit is recorded but eligibility is the user's to confirm.
- Set-off and forecast are computations, not assessments.
- The assistant is deterministic, calls no external model and cannot mutate data.
- Period close is a soft lock: it records who closed the period; it does not
  hard-prevent edits.
- The bank feed is separate from the books until matched; nothing contacts a bank.

## Testing

- `test/accounting.test.mjs` - 8 engine tests (balancing, trial balance, P&L,
  balance sheet, cash-flow classes, aging, normal balance).
- `test/ui.test.mjs` - added finance tests: journals balance, invoice posting,
  bank balance and matching, expense posting, payables, statements on every tab,
  chart of accounts/journal rendering, assistant, forecast, data quality,
  insights, close sign-off, home command center.
- Totals: `npm test` 115; `npm run test:all` 140; all green.
