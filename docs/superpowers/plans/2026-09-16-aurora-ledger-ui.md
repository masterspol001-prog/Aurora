# Aurora Ledger UI Redesign - Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Execute task-by-task. Do not git commit unless the user asks.

**Goal:** Rebuild the billing-ledger prototype's interface into a cohesive, responsive, light/dark "Aurora Ledger" design while keeping `engine.js` and all behaviour unchanged.

**Architecture:** All work is in `billing-ledger/index.html`. Add a CSS token layer, a primitive component layer, a new app shell (icon rail + contextual top bar), restyled views, and an interaction layer (theme persistence, command palette, drawer-style modals). `state` shape gains only `settings.theme` and `ui.railCollapsed`.

**Tech Stack:** Vanilla HTML/CSS/ES modules, `node:test` for tests, no build step.

## Global Constraints

- Do not modify `engine.js`.
- Do not commit to git (user instruction).
- No emoji in UI copy; no new dependencies; no build step.
- Keep `explore` module extractable: `test/ui.test.mjs` reads the `<script type="module">` block and boots it against a DOM stub. Do not reference real browser APIs at import time beyond `document`, `Blob`, `URL`, `setTimeout`, `localStorage` (guarded in try/catch).
- Preserve honesty copy: demo-workspace label, "no payment is taken", Accuracy & scope, caveats.
- All money uses tabular numerals and right alignment.
- Respect `prefers-reduced-motion`; visible focus rings; AA contrast.
- Verification command for every task: `cd billing-ledger && npm test` (expect all green).

---

### Task 1: Design token layer + theme toggle + persistence

**Files:**
- Modify: `billing-ledger/index.html` (replace the existing `<style>` block; add theme helpers near `state`)

**Interfaces:**
- Produces: CSS custom properties (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--brand`, `--brand-soft`, `--accent`, `--success`, `--warn`, `--danger`), `applyTheme()`, `toggleTheme()`.
- `state.settings.theme` in `{ "light", "dark" }`; `state.ui.railCollapsed` boolean.

- [ ] **Step 1:** In the module, add after `state` construction:

```js
state.ui = { railCollapsed: false };
```
and extend `boot()`'s settings default merge to include `theme: "light"`, and `resetDemo()`'s settings object likewise.

- [ ] **Step 2:** Add theme helpers:

```js
function applyTheme() {
  document.documentElement?.setAttribute?.("data-theme", state.settings.theme || "light");
}
function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  applyTheme(); saveState(); render();
}
```

- [ ] **Step 3:** Replace the `<style>` block with tokens + base:

```css
:root{--bg:#f6f7fb;--surface:#fff;--surface-2:#eef1f7;--border:#e3e7ef;--text:#0f172a;--muted:#64748b;--brand:#4f46e5;--brand-soft:#eef0ff;--accent:#f59e0b;--success:#059669;--warn:#b45309;--danger:#dc2626;--radius:14px;--radius-sm:9px;--sp:4px;--shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px -12px rgba(15,23,42,.18);--dur:180ms}
[data-theme="dark"]{--bg:#0b1020;--surface:#131a2e;--surface-2:#1b2438;--border:#26304a;--text:#eef2ff;--muted:#9aa7c7;--brand:#8b8cf9;--brand-soft:#20264a;--accent:#fbbf24;--success:#34d399;--warn:#fbbf24;--danger:#f87171;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 30px -14px rgba(0,0,0,.7)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.num,.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.num{text-align:right}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
```

- [ ] **Step 4:** In `render()`, call `applyTheme()` first, and set `data-theme` on the stub-safe element (`document.documentElement` may be undefined under the test stub; the `?.` guards handle it).

- [ ] **Step 5:** Run `npm test`; expect 48 pass.

- [ ] **Step 6:** Checkpoint (no commit).

---

### Task 2: App shell (icon rail + contextual top bar)

**Files:** Modify `billing-ledger/index.html` (`renderNav`, `renderTopbar`, page `<body>` static markup)

**Interfaces:**
- Consumes: `state.ui.railCollapsed`, `toggleTheme`, `NAV`.
- Produces: `els.railToggle` handler, `els.themeToggle` handler, `els.cmdk` handler; `openPalette()` referenced in Task 7.

- [ ] **Step 1:** Static body markup becomes a grid shell:

```html
<div class="app">
  <aside id="rail" class="rail"><div class="brand">AL</div><nav id="nav"></nav><div class="rail-foot"><button id="railToggle" class="icon-btn" aria-label="Collapse navigation">«</button></div></aside>
  <div class="main"><header id="topbar"></header><main id="view"></main></div>
  <div id="toast"></div><div id="modalRoot"></div>
</div>
```

- [ ] **Step 2:** `renderNav()` renders icon + label buttons and applies `rail.collapsed` from state; add toggle that flips `state.ui.railCollapsed`, `saveState()`, `render()`.

- [ ] **Step 3:** `renderTopbar()` includes: title + sub (workspace/regime/period/demo label), a search button labelled `Search or jump…` with `⌘K`, plan docs meter badge, theme toggle, role `<select id="role">`, `roleNote`, and `+ New invoice`.

- [ ] **Step 4:** Add shell CSS (`.app{display:grid;grid-template-columns:248px 1fr;min-height:100vh}`; `.rail.collapsed{width:64px}`; rail active indicator using `--brand`; sticky topbar with `backdrop-filter`).

- [ ] **Step 5:** Run `npm test`; expect 48 pass (stub ignores layout).

- [ ] **Step 6:** Checkpoint.

---

### Task 3: Primitive components

**Files:** Modify `billing-ledger/index.html` (CSS additions; small render helpers)

**Interfaces:**
- Produces: `kpi(label, value, meta, trend)`, `badge(text, tone)`, `meter(pct, tone)`, `emptyState(title, hint)`, `openDrawer(title, bodyHtml, onClose)`, `closeModal()` (existing, keep name), `toast(msg, kind)` (existing).

- [ ] **Step 1:** Add CSS for `.btn`(default/primary/ghost/danger/sm), `.icon-btn`, `.field`, `.input/.select`, `.card`, `.card-h`, `.card-b`, `.badge`(tone classes `b-good/b-warn/b-urgent/b-muted/b-brand`), `.table` (sticky head, zebra-free, row hover), `.meter > i`, `.pill`, `.timeline`, `.empty`, `.drawer` + `.drawer-b` + `.drawer-f`, `.toast` variants, `.skel`.

- [ ] **Step 2:** Implement `openDrawer(title, bodyHtml, onClose)` reusing `modalRoot`, with overlay click + Escape to close:

```js
function openDrawer(title, bodyHtml, onClose) {
  el("modalRoot").innerHTML = `<div class="drawer-wrap" id="dw"><div class="drawer" role="dialog" aria-modal="true"><div class="drawer-h"><h2>${esc(title)}</h2><button class="icon-btn" id="closeM" aria-label="Close">×</button></div><div class="drawer-b">${bodyHtml}</div></div></div>`;
  const close = () => { el("modalRoot").innerHTML = ""; onClose && onClose(); };
  el("closeM").onclick = close;
  el("dw").onclick = (e) => { if (e.target.id === "dw") close(); };
  return close;
}
```

- [ ] **Step 3:** Assert the DOM stub tolerates the new markup (`querySelectorAll` returns `[]`, so no per-row wiring assumptions).

- [ ] **Step 4:** Run `npm test`; expect 48 pass.

- [ ] **Step 5:** Checkpoint.

---

### Task 4: Dashboard redesign

**Files:** Modify `billing-ledger/index.html` (`viewDashboard`)

- [ ] **Step 1:** Order: onboarding banner (unchanged copy) -> attention strip (urgent/consolidation advice) -> 4 `kpi()` stat cards -> fragmentation cards with severity accents -> recent documents table.
- [ ] **Step 2:** Keep exact strings the tests assert: `Billed this period`, `Open receivable`, `Proactive consolidation`, `Urgent`, `5 invoice`.
- [ ] **Step 3:** Run `npm test`; expect 48 pass.
- [ ] **Step 4:** Checkpoint.

---

### Task 5: Invoice detail drawer + new-invoice drawer

**Files:** Modify `billing-ledger/index.html` (`openInvoiceDetail`, `renderInvoiceModal`, `openInvoiceModal`, `saveDraft`, `wireView`)

- [ ] **Step 1:** Convert `openInvoiceDetail` to `openDrawer(inv.number, bodyHtml)`; keep every field/label and the `data-inv` row wiring.
- [ ] **Step 2:** Convert the new-invoice modal to a two-column drawer: left = form, right = sticky live totals + recommendation preview. Keep ids `d_client`, `d_date`, `d_desc`, `d_qty`, `d_rate`, `d_gst`, and (India only) `d_tds`; keep `saveBtn`, `cancelBtn`, `closeM`.
- [ ] **Step 3:** Keep `d_gst`/`d_tds` wiring; guard `d_tds` absence under non-GST regimes.
- [ ] **Step 4:** Run `npm test`; expect 48 pass (tests drive `newInvoiceBtn`, `d_client`, `d_rate`, `d_gst`, `d_tds`, `saveBtn`, `cancelBtn`).
- [ ] **Step 5:** Checkpoint.

---

### Task 6: Restyle remaining views

**Files:** Modify `billing-ledger/index.html` (`viewInvoices`, `viewQueue`, `viewBalance`, `viewCommitments`, `viewLedger`, `viewClose`, `viewReadout`, `viewPlans`, `viewAccuracy`, `viewSettings`)

- [ ] **Step 1:** Apply primitives (card headers, badges, meters, tables, step/timeline lists). Preserve every assertion string: `Usage this period`, `of 500 documents`, `No payment is taken`, `Practice`; `What this tool computes`, `Ledger balance`, `Not covered`, `checksum only`, `Regulatory accuracy notes`; `Business details`, `VAT`, `Live workspace`; `Paise check`, `They match exactly`, `Exact money`, `urgent consolidation`, `balanced`.
- [ ] **Step 2:** Ensure no `NaN`/`undefined` renders for any view under a non-GST regime and both themes.
- [ ] **Step 3:** Run `npm test`; expect 48 pass.
- [ ] **Step 4:** Checkpoint.

---

### Task 7: Command palette, responsive, accessibility

**Files:** Modify `billing-ledger/index.html`

- [ ] **Step 1:** Implement `openPalette()` listing: jump-to-view items (all `NAV`), `New invoice`, `Toggle theme`, `Reset demo`. Filter on input; Enter runs the highlighted item. Bind `Cmd/Ctrl+K` and the topbar search button.
- [ ] **Step 2:** Responsive CSS: `.app{grid-template-columns:1fr}` below 1024px with rail as a top strip; tables convert to stacked cards below 720px via `@media` and `.table--stack` classes.
- [ ] **Step 3:** Accessibility: `aria-current` on active nav (already present), focus-visible rings, focus trap on drawer open, Escape closes palette and drawer.
- [ ] **Step 4:** Run `npm test`; expect 48 pass.

---

### Task 8: Tests for the redesign + final verification

**Files:** Modify `billing-ledger/test/ui.test.mjs`; update `billing-ledger/README.md`

- [ ] **Step 1:** Add tests:
  - shell renders nav + topbar (`/Search or jump/`, `/New invoice/`)
  - `toggleTheme` flips `state.settings.theme` and re-renders
  - command palette opens and jumps to a view
  - invoice drawer opens and closes
  - both themes + non-GST regime render every view without `NaN/undefined` (extend existing all-views test to loop `theme` in `["light","dark"]`)
- [ ] **Step 2:** Expose test hooks needed on `globalThis.__frag` (e.g. `toggleTheme`, `openPalette`) without breaking existing exports.
- [ ] **Step 3:** Run `npm test`; expect all green (48 + new).
- [ ] **Step 4:** Update `README.md`: new shell/theme/palette, updated test count, note light/dark.
- [ ] **Step 5:** Restart/verify preview: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8090/index.html` -> `200`.

---

## Self-Review

- **Spec coverage:** token layer (T1), shell (T2), primitives (T3), views (T4-T6), palette/responsive/a11y (T7), state persistence (T1), testing (T8). All spec sections mapped.
- **Placeholder scan:** CSS in Tasks 2/3/6 is described by exact class names rather than repeated wholesale; token and interaction code is complete.
- **Type consistency:** `openDrawer`, `applyTheme`, `toggleTheme`, `openPalette`, `state.ui.railCollapsed`, `state.settings.theme` used consistently across tasks.

## Notes

- No git commits: user instructed no commits. "Checkpoint" means run tests and pause.
- If any existing test asserts on markup that changes shape, update the assertion only if the underlying behaviour is unchanged.
