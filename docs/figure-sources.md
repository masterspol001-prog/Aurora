# Figure sources

Every headline number in Aurora Ledger is computed from records in the current
workspace. Nothing is estimated, sampled or hard-coded. This map lists the key
figures, the exact derivation, and the records each one reads.

All money is stored and summed as exact integer minor units (paise, cents). No
figure is produced by floating-point arithmetic.

## Programme helper

`figureSource(key)` in `engine.js` returns `{ label, formula, inputs }` for the
keys below. The client uses it to label "Explain" popovers so a figure can always
be traced back to its definition.

| Key | Label | Formula | Inputs |
| --- | --- | --- | --- |
| `outstanding` | Outstanding | `sum(totalPaise - paid - tds)` over non-void invoices | invoices, payments |
| `overdue` | Overdue | `outstanding` where `dueDate < today` | invoices, payments |
| `collected` | Collected this period | `sum(amountPaise)` of payments in the period | payments |
| `cash` | Cash & bank | sum of cash/bank account balances from journals | journals, coa |
| `netTax` | Net tax | output tax minus input tax | journals, coa |
| `revenue` | Revenue | sum of revenue account postings in the period | journals, coa |
| `profit` | Estimated profit | revenue minus cost of services and expenses | journals, coa |

## Dashboard and statement figures

- **Outstanding / Overdue / Collected / Cash coming in** - derived from the
  invoice and payment arrays, scoped to `state.period` where the label says
  "this period". `openBalance(inv)` is `totalPaise - paid - tds` and never goes
  below zero for display purposes.
- **Cash & bank** - `bankBalance()` and `cashOnHand()` read account openings plus
  the journal postings for cash/bank accounts. They are ledger balances, not
  feeds from a live bank connection.
- **Net tax (GST/VAT)** - `outputTaxPaise()` minus `inputTaxPaise()`, both summed
  from the derived journals for the selected period. This is a computed position,
  not a filed return.
- **Revenue / Profit** - from the profit & loss statement
  (`trialBalance` -> `profitAndLoss` -> `balanceSheet`). Profit is an estimate:
  it excludes accruals, depreciation and any adjustments not yet posted.
- **Margins** - revenue minus cost of services and expenses, expressed against
  revenue. Cost of services and expenses come from the mapped expense accounts.
- **Cash forecast** - expected collections (open invoices weighted by client
  history) net of known commitments and subscriptions. It is a projection from
  existing records, not a bank fact.

## Journal derivation

Most journals are generated on read from source documents:

- invoice -> `buildInvoiceJournal`
- payment -> `buildPaymentJournal`
- expense -> `buildExpenseJournal`
- bill -> `buildBillJournal`

Only manual journals are stored in `state.journals`. Anything a statement shows
can be drilled to the source document via `journalsForSource` /
`openSourceDoc`.

## Known limits

- The tool computes and organises figures. It does not file returns with any
  tax authority and does not connect to a bank.
- Figures are only as complete as the records entered. Open receivables and
  unmatched bank lines are surfaced as close **warnings**, not blockers.
- Hard blockers at sign-off (unbalanced journals, journals awaiting approval,
  hard payment mismatches, quarantined records) indicate the data itself needs
  attention before the books are considered closed.
</content>
