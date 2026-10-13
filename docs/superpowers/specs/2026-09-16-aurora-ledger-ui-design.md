# Aurora Ledger - UI Redesign Design Spec

Date: 2026-09-16
Status: approved (user directed fast completion)
Scope: visual + layout rebuild of the Fragmentation-Aware Billing Ledger prototype

## 1. Goal

Redesign the prototype's interface so it delivers, at once:

- Demo/pitch "wow" on first open.
- Everyday usability: fast scanning, low friction, keyboard friendly.
- A modern SaaS feel without looking generic.
- A distinctive, consistent identity ("Aurora Ledger").

## 2. Constraints and non-negotiables

- Single self-contained `index.html` importing `engine.js`; no build step, no framework, no new runtime dependencies.
- All money math and engine behaviour unchanged. `engine.js` is not touched for visual reasons.
- All 48 existing tests must stay green; `test/ui.test.mjs` extracts the module script and boots it against a DOM stub, so the module must remain extractable and must not reference real browser APIs at import time beyond what the stub provides.
- Honesty rule preserved: demo data stays labelled, plans state no payment is taken, accuracy/scope and caveats remain visible.
- No emoji in the UI. No fake functionality or fake numbers.
- Must remain accessible: keyboard reachable, visible focus, AA contrast, and `prefers-reduced-motion` respected.

## 3. Architecture

Layered, all inside `index.html`:

1. **Token layer** - CSS custom properties on `:root` (light) and `[data-theme="dark"]`: color ramps + semantic tokens (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--brand`, `--accent`, `--success`, `--warn`, `--danger`, `--info`), type scale, spacing scale (4px base), radii, elevation, motion durations, z-index. Every component reads tokens only.
2. **Primitive layer** - buttons, inputs, selects, fields, badges/pills, cards, tables, meters/progress, tabs, tooltip, modal/drawer, toast, empty state, skeleton.
3. **Shell layer** - icon rail (collapsible), contextual top bar (breadcrumb/title, workspace + period, search/command trigger, plan usage badge, theme toggle, role switcher), main content region, toast region.
4. **View layer** - the ten existing views restyled on the new primitives: dashboard, invoices, queue, balance, commitments, ledger, close, readout, plans, accuracy, settings.
5. **Interaction layer** - command palette (Cmd/Ctrl+K), theme + rail persistence, focus management in modals/drawers, keyboard shortcuts.

Data flow is unchanged: `state` -> `render()` selects a view -> `wireView()` attaches handlers -> `engine.js` pure functions compute. Redesign changes markup/CSS/handlers only.

## 4. Visual direction

- **Type:** Inter (system-ui fallback) for UI; ui-monospace for numbers/codes. All money uses `font-variant-numeric: tabular-nums` and right alignment.
- **Color:** calm neutral canvas with a deep indigo/violet brand and a warm accent; semantic tones for reconcilation states. Light and dark are both first-class.
- **Numerals:** oversized, confident KPI numbers (editorial influence) balanced by dense, quiet tables.
- **Surfaces:** soft borders + subtle layered elevation instead of heavy shadows; 12-16px radii; generous whitespace on dashboards, compact on tables.
- **Motion:** 150-250ms ease transitions for hover, theme switch, view mount, palette open; disabled under `prefers-reduced-motion`.

## 5. Component and view changes

- **App shell:** collapsible left rail with icons + labels, active indicator; top bar becomes contextual. Workspace name, regime, period, docs/plan meter, theme toggle, role switcher.
- **Dashboard:** insight-first. Alert/attention cards above KPIs; KPIs as stat cards with trend/label; fragmentation intelligence as cards with severity accents; recent documents table restyled.
- **Invoices:** filter/search bar, denser table, row opens the invoice detail as a right-side drawer (replacing the centered modal) while keeping the same fields and totals.
- **New invoice:** becomes a drawer/wizard with live preview panel; progressive TDS capture and regime-aware tax rows unchanged in logic.
- **Queue / Balance / Commitments / Ledger / Close:** restyled tables, pills, timelines and step lists; CSV export unchanged.
- **Plans:** plan cards with usage meter and honest "no payment taken" note.
- **Accuracy & scope:** verified-vs-not-covered two-column layout preserved and restyled.
- **Settings:** grouped form sections; regime switch auto-sets currency (existing behaviour).
- **Command palette:** jump to any view, new invoice, toggle theme, reset demo.
- **Responsive:** rail collapses below 1024px; tables convert to stacked cards below ~720px.

## 6. State additions

- `state.settings.theme` ("light" | "dark") and `state.ui.railCollapsed` persisted under the existing `STORE_KEY`. No other state shape changes. Migration is tolerant of older saved payloads.

## 7. Testing

- Extend `test/ui.test.mjs`: shell renders (rail + top bar), theme toggle flips `data-theme` and persists, command palette opens and navigates, invoice drawer opens/closes, all views render under both themes and under a non-GST regime with no `NaN`/`undefined`.
- Keep `test/engine.test.mjs` untouched.
- Target: 48 existing tests green plus the new UI cases.

## 8. Out of scope

Framework migration, backend, auth, real payments, new billing features, engine changes, and any change to regulatory/caveat wording semantics.

## 9. Success criteria

- Opening the preview shows a visibly redesigned, cohesive, responsive interface in both themes.
- Every existing feature remains reachable and functional; all tests pass.
- The demo dataset is still clearly labelled and no claim exceeds what the engine verifies.
