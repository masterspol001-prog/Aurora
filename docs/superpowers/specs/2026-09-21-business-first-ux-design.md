# Aurora Ledger - Business-First UX Design Spec

Date: 2026-09-21
Status: awaiting user review
Scope: information architecture, navigation, dashboard, labels and progressive
disclosure inside the existing single-file prototype (`index.html`)

## 1. Goal

Make Aurora Ledger answer a founder's question - "what is happening with my
business finances, and what do I need to do today?" - without hiding the
rigorous double-entry engine underneath.

The accounting stays exactly as it is. The interface stops leading with
accounting modules and starts with decisions, money and next actions.

## 2. Core principle

> Don't make the founder understand accounting. Make the accounting
> understandable to the founder.

Default view = business language and business actions.
Advanced view = the current accounting detail, one level deeper.

## 3. Constraints and non-negotiables

- `engine.js` is unchanged. All money math, tax/TDS logic, reconciliation and
  ledger postings keep their current behaviour and tests.
- Keep every existing view id and route working (`dashboard`, `action`,
  `invoices`, `clients`, `payments`, `recurring`, `queue`, `balance`,
  `commitments`, `ledger`, `close`, `reports`, `readout`, `plans`, `accuracy`,
  `settings`). Deep links, the command palette and existing tests must survive.
- Single self-contained `index.html`; no build step, no framework, no new
  runtime dependencies.
- Demo mode (`localStorage`) and server mode both keep working. The redesign is
  markup, CSS and view-helper only.
- Honesty rule preserved: demo data stays labelled; no number is invented. In
  particular, input tax credit is not tracked by the engine, so the Taxes view
  says so rather than implying a net-GST figure it cannot substantiate.
- No emoji. Keyboard reachable, visible focus, AA contrast,
  `prefers-reduced-motion` respected. Amounts stay tabular and exact.

## 4. Decisions taken with the user

1. **Global Advanced toggle** (`accountingDetail`), not per-view-only
   disclosure, not a hybrid.
2. **Regroup the existing nav, keep all routes.** No merging of views into new
   pages, no sub-tab routing rewrite.
3. **One new read-only Taxes view** rather than three new tax pages or a pure
   link-out.

## 5. Navigation restructure

`NAV` becomes an array of named sections; each item keeps its current `id` and
`abbr`, gains a `label` that resolves through the term map (section 7), plus an
optional `count` key for the existing badge logic.

| Section | Items (route id) |
|---|---|
| Home | Home (`dashboard`), Needs your attention (`action`) |
| Money | Invoices (`invoices`), Payments (`payments`), Recurring bills (`recurring`), Upcoming commitments (`commitments`), Money In & Out (`ledger`) |
| Customers | Customers (`clients`) |
| Taxes | Taxes overview (`taxes`), Tax settings (`tax-settings`) |
| Reports | Business reports (`reports`), Close this month (`close`) |
| Utility (bottom) | Ready to review (`queue`), Balance history (`balance`), Demo readout (`readout`), Plans (`plans`), Accuracy & scope (`accuracy`), Settings (`settings`) |

- Two new routes: `taxes` and `tax-settings`.
- `renderNav()` renders group headings (hidden when the rail is collapsed to
  icons, showing items only) and keeps the existing counts for invoices,
  clients, payments, recurring, queue, plans and the attention count.
- `renderTopbar()` title lookup and the command palette both iterate the
  flattened section list, so palette entries keep working and pick up the new
  labels automatically.

## 6. Business / accounting detail toggle

- New persisted state: `state.settings.accountingDetail` (boolean, default
  `false`). Tolerant migration of older saved payloads.
- Control appears in two places:
  - Topbar segmented control `Business view | Accounting view` (`id=
    detailToggle`).
  - A row in Settings.
- When `false` (business view):
  - Nav uses business labels (section 7).
  - `viewLedger` shows the business activity table (section 9).
  - Debit/credit columns, tax-account names and the full regulatory caveat list
    are collapsed behind inline expanders.
- When `true` (accounting view):
  - Nav uses accounting labels.
  - `viewLedger` opens directly on the debit/credit ledger.
  - Caveat lists render expanded.

## 7. Term map (single source of truth for vocabulary)

A `TERMS` object plus `term(key)` helper centralizes the translation so the same
phrase is not hand-written in many places. Detailed surfaces keep the accounting
word even in business view (the invoice document, the ledger expander, accuracy
& scope).

| Key | Business label (default) | Accounting label |
|---|---|---|
| `ledger` | Money In & Out | Billing ledger |
| `receivables` | Money customers owe you | Accounts Receivable |
| `gstOutput` | GST collected | GST Output |
| `tdsReceivable` | TDS credits | TDS Receivable |
| `recurring` | Recurring bills | Recurring |
| `commitments` | Upcoming commitments | Commitments |
| `close` | Close this month | Month-end close |
| `reports` | Business reports | Reports |
| `queue` | Ready to review | Preview queue |
| `monthEnd` | Close this month | Month-end close |

## 8. Dashboard rewrite (`viewDashboard`)

Top to bottom:

1. **Snapshot header** - "September business snapshot", the company/period line,
   and a one-line persona note for the owner ("You see who owes you money, what
   you collected, taxes, and what is next.").
2. **Business health strip** - six exact-figure stats: Billed, Collected,
   Outstanding, GST collected, TDS credits, Upcoming. Sourced from a new
   `snapshot()` helper, using the metric definitions below.
3. **"What needs your attention?"** - the count ("4 things need action") and up
   to four task cards from `attentionItems()` (section 10), plus
   `Open task inbox ->` (`data-go="action"`). Hidden entirely when the count is
   zero, replaced by a short "Nothing needs your attention today" line.
4. **Action cards** (item 3 of the brief) - Money coming in, Invoices, Payments,
   Tax, This month. Each card shows one headline number plus one obvious action
   `View ->` with a `data-go` target. No card is decorative; every one navigates.
5. **Recent money activity** - a business table (Date, Customer, Activity,
   Amount, Status) built by `businessActivityRows()`, with
   `View accounting entries ->` linking to the ledger.
6. **Cash-flow watch** - the existing fragmentation intelligence card, retitled
   in business language and kept, because it is the prototype's differentiator.
7. **Tax note** - one line: "Tax information is based on your current settings.
   Review before issuing." plus `View tax & compliance details ->`, which
   expands the caveat list (section 12).

## 9. Billing ledger view (`viewLedger`)

- Default (business): table with Date, Customer, Activity, Amount, Status, using
  `businessActivityRows()` derived from invoices (`Invoice`) and payments
  (`Payment`, `Received`). Period filter behaviour is unchanged.
- `View accounting entries ->` expander reveals the current debit/credit ledger
  table and its balanced/gap badge, unchanged.
- The expander starts open when `accountingDetail` is true.
- CSV export keeps the full accounting columns regardless of the toggle.

## 10. Task inbox (`viewAction`)

Retitled "Needs your attention". `actionItems()` is extended (not replaced) so
each item carries:

- `headline` - what happened ("Acme Retail invoice unpaid").
- `amountPaise` - the figure that matters, when there is one.
- `due` - due date or period, when relevant.
- `why` - one sentence on why it matters.
- `label` - the primary action text ("View invoice", "Review", "Continue",
  "Review settings").
- `go` - the existing navigation target.

Existing categories are kept and re-worded: overdue invoice, payment due soon,
reconciliation asymmetry, client consolidation, TDS credit review, month-end
close remaining items, tax settings confirmation. The empty state stays honest
("Nothing needs your attention today").

## 11. Metric definitions (`snapshot()`)

All figures are integer minor units, aggregated over `state.period`, and read
from data the engine already produces. No new computation of money.

| Figure | Definition |
|---|---|
| Billed | Sum of non-void invoice totals dated in the period |
| Collected | Sum of payments dated in the period |
| Outstanding | Sum of remaining balances across all non-void unpaid / part-paid invoices (not period-limited) |
| GST collected | Sum of tax on period invoices (zero for non-GST regimes) |
| TDS credits | Sum of TDS withheld on period invoices |
| Upcoming | Sum of outstanding invoice balances whose due date is today or later |

A metric with no underlying data renders as the currency zero, never blank and
never fabricated. Remaining commitment value is shown on the Money flows
(Upcoming commitments) surface, not folded into "Upcoming".

### 11.1 New read-only Taxes view (`viewTaxes`)

Presents only what the engine can substantiate:

- **GST collected** for the period (sum of tax on period invoices).
- **TDS credits** (withheld on period invoices) and **TDS withheld** as separate
  figures with the sections they came from.
- **Registration and default treatment** from settings (GSTIN, regime, default
  tax treatment, base currency), with validity feedback reusing the existing
  validator output.
- **Input tax credit is not tracked** - shown as an explicit note, not a number.
- Every figure links to the invoices that produced it.
- A `Tax settings` card reuses the extracted `taxSettingsCard()`.
- Caveats available via the collapsed disclosure (section 12).

`viewTaxSettings()` is a thin wrapper rendering the same `taxSettingsCard()` so
the `tax-settings` route is a real destination; `viewSettings` keeps including
the card, so nothing is removed from the existing screen.

## 12. Regulatory notes

`REGULATORY_CAVEATS` is retained in full. A `caveatCollapsed(title)` helper
renders one summary line plus a `<details>` block containing the full list. It
replaces the wall-of-warnings card at the top of the dashboard, invoices,
ledger, close and settings.

The invoice document and the Accuracy & scope view keep their full notes
un-collapsed: one is a legal artifact, the other is explicitly about limits.

## 13. State additions

- `state.settings.accountingDetail` (boolean, default false).
- `state.ui.ledgerDetail` (boolean, default false) for the ledger expander.

No other state shape changes. `view` remains persisted as today.

## 14. Files touched

- `index.html` - NAV sections, `TERMS`/`term`, `snapshot()`,
  `attentionItems()`, `businessActivityRows()`, `taxSummary()`,
  `caveatCollapsed()`, `taxSettingsCard()` extraction, rewritten `viewDashboard`
  and `viewAction`, adapted `viewLedger`, new `viewTaxes`/`viewTaxSettings`,
  topbar toggle, `__frag` additions.
- `test/ui.test.mjs` - updated expectations plus new cases.
- `README.md` - navigation/labels and the business/accounting view described.
- `docs/BACKLOG.md` - mark this UX pass done.

## 15. Testing

- `engine.test.mjs` untouched; 36 engine tests stay green.
- New/updated UI cases:
  - nav renders the section headings and the two new routes.
  - founder default uses business labels; toggling `accountingDetail` switches
    the ledger nav label to "Billing ledger".
  - dashboard renders the snapshot strip, the attention panel and the action
    cards; no `undefined` or `NaN`.
  - task inbox cards expose a headline and an action label.
  - ledger default shows the business table with an Activity column and no
    Debit/Credit header; the expander reveals the debit/credit ledger; the
    toggle opens it by default.
  - Taxes view renders GST collected and TDS credits and states input credit is
    not tracked.
  - caveat disclosure renders collapsed with full text available.
  - palette still reaches every route after the regroup.
- Target: all existing tests green plus the new cases; `npm run test:all`
  (client + server) green.

## 16. Out of scope

Engine changes, backend changes, new billing features, real filing, payment
gateways, framework migration, per-view tab routing, and any change to the
meaning of regulatory or caveat wording.

## 17. Success criteria

- First open answers "what needs my attention today?" before showing any
  accounting module.
- A founder can read the dashboard, inbox and ledger without knowing debit from
  credit; an accountant can still reach every double-entry detail in one click.
- Every existing route, feature and test remains functional.
- No claim exceeds what the engine verifies.
