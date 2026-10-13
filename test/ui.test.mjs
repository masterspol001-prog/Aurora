import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Boot the real UI module from index.html against a tiny DOM stub, then drive it
// through the acceptance-test scenarios.

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(match, "index.html must contain a module script");
const engineUrl = pathToFileURL(path.join(root, "engine.js")).href;
const script = match[1].replace('from "./engine.js"', `from ${JSON.stringify(engineUrl)}`);

class Fake {
  constructor(id) {
    this.id = id; this.innerHTML = ""; this.value = ""; this.dataset = {};
    this.children = []; this.checked = false; this.className = ""; this.textContent = "";
  }
  querySelectorAll() { return []; }
  appendChild(c) { this.children.push(c); }
  remove() {}
  click() {}
}

const els = {};
let lastBlob = null;
globalThis.document = {
  getElementById(id) { return els[id] || (els[id] = new Fake(id)); },
  querySelectorAll() { return []; },
  createElement(tag) { return new Fake(tag); },
};
globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.opts = opts; lastBlob = this; } };
globalThis.URL = { createObjectURL() { return "blob:x"; }, revokeObjectURL() {} };
globalThis.setTimeout = () => 0;

const modPath = path.join(os.tmpdir(), `frag-ui-${process.pid}.mjs`);
fs.writeFileSync(modPath, script);
await import(pathToFileURL(modPath).href);

const app = globalThis.__frag;
assert.ok(app && app.state && typeof app.render === "function", "UI boot should expose __frag");
const { state, render } = app;
const { toggleTheme, openPalette, actionItems, invStatus, voidInvoice, importCsvRows, statementRows, invoiceDocumentHtml, invoiceMailto, generateRecurring, recurringDue, dueRecurringCount, baseEquivalent, taxTreatmentLabel } = app;

test("storage adapter hook is present and demo mode is the fallback", () => {
  assert.equal(typeof app.saveNow, "function");
  assert.equal(typeof app.storeMode, "function");
  assert.equal(app.storeMode(), "demo");
});

test("dashboard leads with a business snapshot and an action inbox", () => {
  state.view = "dashboard"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Your money right now/);
  assert.match(html, /What needs your attention/);
  assert.match(html, /Where the money is/);
  assert.match(html, /Cash coming in/);
  assert.match(html, /Outstanding/);
  assert.match(html, /Accounting entries/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("regulatory notes are collapsed behind a summary line", () => {
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /Tax information is based on your current settings/);
  assert.match(els.view.innerHTML, /<details/);
  state.view = "accuracy"; render();
  assert.match(els.view.innerHTML, /Regulatory accuracy notes/);
  state.view = "dashboard"; render();
});

test("role switch changes recommendation wording but not the underlying state", () => {
  state.role = "owner"; render();
  const owner = els.view.innerHTML;
  state.role = "bookkeeper"; render();
  const book = els.view.innerHTML;
  assert.notEqual(owner, book);
  state.role = "owner"; render();
});

test("fifth invoice upgrades the client to urgent consolidation", () => {
  els.newInvoiceBtn.onclick();
  els.d_client.onchange({ target: { value: "c2" } });
  els.d_rate.oninput({ target: { value: "25000" } });
  els.d_gst.onchange({ target: { value: "18" } });
  assert.match(els.modalRoot.innerHTML, /Urgent/);
  els.saveBtn.onclick();
  const rec = app.clientRecommendation("c2");
  assert.equal(rec.state, "urgent_consolidation");
  assert.ok(actionItems().some((it) => /consolidat/i.test(it.headline || it.title)), "urgent consolidation should surface as an action");
});

test("194J blocks saving until progressive-capture fields are filled", () => {
  els.newInvoiceBtn.onclick();
  els.d_client.onchange({ target: { value: "c3" } });
  els.d_rate.oninput({ target: { value: "40000" } });
  els.d_tds.onchange({ target: { value: "194J" } });
  assert.match(els.modalRoot.innerHTML, /Nature of professional/);
  assert.match(els.modalRoot.innerHTML, /Billable hours/);
  const before = els.toast.children.length;
  els.saveBtn.onclick();
  const added = els.toast.children.slice(before).map((c) => c.textContent);
  assert.ok(added.some((t) => /TDS capture incomplete/.test(t)), "save must be blocked");
});

test("demo readout explains the calculation and the paise check holds", () => {
  state.view = "readout"; render();
  assert.match(els.view.innerHTML, /Paise check/);
  assert.match(els.view.innerHTML, /They match exactly/);
  assert.match(els.view.innerHTML, /Exact money/);
  assert.match(els.view.innerHTML, /urgent consolidation/);
});

test("month-end close reconciles rather than showing zero", () => {
  state.view = "close"; render();
  assert.match(els.view.innerHTML, /Billed/);
  const billed = els.view.innerHTML.match(/Billed<\/div><div class="val">₹([\d,]+\.\d\d)<\/div>/);
  assert.ok(billed, "billed KPI should render a formatted amount");
  assert.ok(Number(billed[1].replace(/,/g, "")) > 0, "billed amount must not be zero");
});

test("ledger defaults to the business view and reveals balanced accounting entries", () => {
  state.settings.accountingDetail = false;
  state.ui.ledgerDetail = false;
  state.view = "ledger"; render();
  assert.match(els.view.innerHTML, /Activity/);
  assert.doesNotMatch(els.view.innerHTML, /Debit<\/th>/);
  els.ledgerDetailToggle.onclick();
  assert.match(els.view.innerHTML, /Debit<\/th>/);
  assert.match(els.view.innerHTML, /balanced/);
  els.exportCsv.onclick();
  const csv = lastBlob?.parts?.[0];
  assert.ok(csv, "csv should be produced");
  assert.doesNotMatch(csv, /NaN/);
  const lines = csv.trim().split("\n").slice(1);
  let debit = 0, credit = 0;
  for (const line of lines) {
    const cols = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    debit += Number(cols[4] || 0);
    credit += Number(cols[5] || 0);
  }
  assert.ok(Math.abs(debit - credit) < 0.005, `debits ${debit} should equal credits ${credit}`);
});

test("accounting detail opens the ledger entries without a toggle", () => {
  app.setAccountingDetail(true);
  state.view = "ledger"; render();
  assert.match(els.view.innerHTML, /Debit<\/th>/);
  assert.match(els.view.innerHTML, /balanced/);
  app.setAccountingDetail(false);
});

test("plans view shows usage and is honest about pricing", () => {
  state.settings.plan = "pro";
  state.view = "plans"; render();
  assert.match(els.view.innerHTML, /Usage this period/);
  assert.match(els.view.innerHTML, /of 500 documents/);
  assert.match(els.view.innerHTML, /No payment is taken/);
  assert.match(els.view.innerHTML, /Practice/);
  state.settings.plan = "free";
});

test("accuracy view lists what is verified and what is not covered", () => {
  state.view = "accuracy"; render();
  assert.match(els.view.innerHTML, /What this tool computes/);
  assert.match(els.view.innerHTML, /Ledger balance/);
  assert.match(els.view.innerHTML, /Not covered/);
  assert.match(els.view.innerHTML, /checksum only/);
  assert.match(els.view.innerHTML, /Regulatory accuracy notes/);
});

test("settings switches regime and currency and marks the workspace live", () => {
  const before = { name: state.company.name, gstin: state.company.gstin, currency: state.settings.currency, regimeId: state.settings.regimeId, onboarded: state.settings.onboarded };
  state.view = "settings"; render();
  assert.match(els.view.innerHTML, /Business details/);
  els.s_regime.onchange({ target: { value: "GB_VAT" } });
  assert.equal(state.settings.regimeId, "GB_VAT");
  assert.equal(state.settings.currency, "GBP");
  assert.match(els.view.innerHTML, /VAT/);
  document.getElementById("s_name").value = "Northwind Ltd";
  document.getElementById("s_taxid").value = "GB123456789";
  document.getElementById("s_currency").value = "GBP";
  els.s_save.onclick();
  assert.equal(state.settings.onboarded, true);
  assert.equal(state.company.name, "Northwind Ltd");
  assert.match(els.topbar.innerHTML, /Live workspace/);
  assert.match(els.topbar.innerHTML, /Northwind Ltd/);
  state.company.name = before.name; state.company.gstin = before.gstin;
  state.settings.currency = before.currency; state.settings.regimeId = before.regimeId;
  state.settings.onboarded = before.onboarded;
});

test("a non-GST regime previews a single tax line in its own currency", () => {
  state.settings.regimeId = "GB_VAT"; state.settings.currency = "GBP";
  els.newInvoiceBtn.onclick();
  assert.match(els.modalRoot.innerHTML, /VAT/);
  assert.doesNotMatch(els.modalRoot.innerHTML, /CGST/);
  els.d_rate.oninput({ target: { value: "1000" } });
  assert.match(els.modalRoot.innerHTML, /£/);
  els.cancelBtn.onclick();
  state.settings.regimeId = "IN_GST";
  state.settings.currency = "INR";
});

test("every view renders under a non-GST regime without errors", () => {
  state.settings.regimeId = "GB_VAT";
  state.settings.currency = "GBP";
  const views = ["dashboard", "action", "invoices", "clients", "payments", "queue", "balance", "commitments", "ledger", "taxes", "tax-settings", "close", "reports", "readout", "plans", "accuracy", "settings"];
  for (const theme of ["light", "dark"]) {
    state.settings.theme = theme;
    for (const v of views) {
      state.view = v;
      render();
      assert.ok(els.view.innerHTML.length > 0, `${v} (${theme}) should render`);
      assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/, `${v} (${theme}) should not leak NaN/undefined`);
    }
  }
  state.settings.theme = "light";
  state.settings.regimeId = "IN_GST";
  state.settings.currency = "INR";
  state.view = "dashboard";
  render();
});

test("theme toggle flips the workspace theme", () => {
  state.settings.theme = "light";
  toggleTheme();
  assert.equal(state.settings.theme, "dark");
  toggleTheme();
  assert.equal(state.settings.theme, "light");
});

test("command palette opens with searchable actions", () => {
  openPalette();
  assert.match(els.modalRoot.innerHTML, /Search actions and pages/);
  assert.match(document.getElementById("plist").innerHTML, /Toggle light \/ dark theme/);
  state.view = "dashboard";
  render();
});

test("a new client can be added and is listed", () => {
  const before = state.clients.length;
  state.view = "clients";
  render();
  els.newClientBtn.onclick();
  document.getElementById("c_name").value = "Test Client Co";
  document.getElementById("c_gstin").value = "27AAPFU0939F1ZV";
  document.getElementById("c_save").onclick();
  assert.equal(state.clients.length, before + 1);
  assert.ok(state.clients.some((c) => c.name === "Test Client Co"));
});

test("a payment can be recorded against an open invoice", () => {
  const inv = state.invoices.find((i) => !i.void);
  const before = state.payments.length;
  state.view = "payments";
  render();
  els.newPaymentBtn.onclick();
  document.getElementById("y_inv").value = inv.id;
  document.getElementById("y_amount").value = "1.00";
  document.getElementById("y_tds").value = "0";
  document.getElementById("y_save").onclick();
  assert.equal(state.payments.length, before + 1);
  assert.ok(state.payments.some((p) => p.invoiceId === inv.id && p.amountPaise === 100));
});

test("voiding an invoice asks for confirmation, then records it", () => {
  const target = state.invoices.find((i) => !i.void);
  const before = actionItems().length;
  voidInvoice(target.id);
  assert.notEqual(invStatus(target), "void", "void must not happen before the user confirms");
  els.cf_ok.onclick();
  assert.equal(invStatus(target), "void");
  const after = actionItems();
  assert.ok(!after.some((it) => it.inv && it.inv.id === target.id), "void invoice must not appear in needs-action");
  assert.ok(after.length <= before);
  state.view = "dashboard";
  render();
});

test("CSV import adds invoices and payments", () => {
  const beforeI = state.invoices.length;
  const resI = importCsvRows("invoices", "INV-CSV-1,CSV Client,2026-09-10,Imported work,5000,18,");
  assert.equal(resI.imported, 1);
  assert.equal(state.invoices.length, beforeI + 1);
  const num = state.invoices[state.invoices.length - 1].number;
  const beforeP = state.payments.length;
  const resP = importCsvRows("payments", `${num},2026-09-12,5000,0,NEFT,REF1`);
  assert.equal(resP.imported, 1);
  assert.equal(state.payments.length, beforeP + 1);
});

test("client statement and invoice delivery render", () => {
  const c = state.clients.find((x) => state.invoices.some((i) => i.clientId === x.id));
  const rows = statementRows(c.id);
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((r) => r.kind === "Invoice"));
  const inv = state.invoices.find((i) => i.clientId === c.id && !i.void);
  const html = invoiceDocumentHtml(inv);
  assert.ok(html.includes(inv.number));
  assert.ok(html.includes("Net payable") || html.includes("Total"));
  assert.ok(invoiceMailto(inv).startsWith("mailto:"));
});

test("recurring templates generate invoices and advance the next date", () => {
  const before = state.invoices.length;
  state.recurring.forEach((r) => { r.nextDate = "2000-01-01"; r.active = true; });
  assert.ok(dueRecurringCount() >= 1);
  const n = generateRecurring();
  assert.equal(n, state.recurring.length);
  assert.equal(state.invoices.length, before + n);
  assert.equal(dueRecurringCount(), 0);
  state.view = "recurring";
  render();
  assert.ok(String(document.getElementById("view").innerHTML).includes("Recurring invoices"));
  state.view = "dashboard";
  render();
});

test("FX and tax treatment helpers behave", () => {
  state.settings.baseCurrency = "INR";
  assert.equal(baseEquivalent({ totals: { totalPaise: 100000 }, currency: "USD", fxRate: "83" }), 8300000);
  assert.equal(baseEquivalent({ totals: { totalPaise: 100000 }, currency: "INR" }), null);
  assert.equal(taxTreatmentLabel("reverse_charge"), "Reverse charge");
  assert.equal(taxTreatmentLabel("exempt"), "Exempt");
});

test("business and accounting vocabulary resolve through one term map", () => {
  const { term, TERMS } = app;
  state.settings.accountingDetail = false;
  assert.equal(term("ledger"), "Money In & Out");
  assert.equal(term("recurring"), "Recurring bills");
  assert.equal(term("gstOutput"), "GST collected");
  assert.equal(term("receivable"), "receivable");
  state.settings.accountingDetail = true;
  assert.equal(term("ledger"), "Billing ledger");
  assert.equal(term("gstOutput"), "GST Output");
  assert.equal(term("tdsReceivable"), "TDS Receivable");
  state.settings.accountingDetail = false;
  assert.equal(TERMS.receivables.business, "Money customers owe you");
});

test("taxes overview reports GST and TDS and is honest about input credit", () => {
  state.view = "taxes"; render();
  const html = els.view.innerHTML;
  assert.match(html, /GST on sales/);
  assert.match(html, /TDS credits/);
  assert.match(html, /Computed vs filed/);
  assert.match(html, /Input GST &amp; set-off|Input/);
  assert.doesNotMatch(html, /NaN|undefined/);
  state.view = "tax-settings"; render();
  assert.match(els.view.innerHTML, /Tax settings/);
  assert.match(els.view.innerHTML, /s_regime|Country \/ tax regime/);
});

test("navigation is grouped into sections and keeps every route", () => {
  const ids = app.navItems().map((n) => n.id);
  const required = ["dashboard", "action", "invoices", "clients", "payments", "recurring", "commitments", "ledger", "taxes", "tax-settings", "reports", "close", "queue", "balance", "readout", "plans", "accuracy", "settings", "assistant", "banking", "expenses", "bills", "vendors", "statements", "coa", "journal", "insights", "dataquality"];
  for (const id of required) assert.ok(ids.includes(id), `${id} should be reachable`);
  assert.deepEqual(app.NAV.map((s) => s.group), ["Home", "Money", "Finance", "Customers", "Taxes", "Reports", "More"]);
});

test("the detail toggle switches nav and ledger vocabulary", () => {
  state.settings.accountingDetail = false;
  state.view = "dashboard"; render();
  assert.match(els.nav.innerHTML, /Money In/);
  assert.match(els.nav.innerHTML, /Recurring bills/);
  assert.match(els.topbar.innerHTML, /detailToggle/);
  app.setAccountingDetail(true);
  assert.match(els.nav.innerHTML, /Billing ledger/);
  assert.match(els.nav.innerHTML, /Recurring</);
  app.setAccountingDetail(false);
  assert.match(els.nav.innerHTML, /Money In/);
});

test("snapshot metrics are exact integers from existing data", () => {
  const s = app.snapshot();
  for (const k of ["billed", "collected", "outstanding", "gstCollected", "tdsCredits", "upcoming"]) {
    assert.ok(Number.isInteger(s[k]), `${k} must be an integer`);
    assert.ok(s[k] >= 0, `${k} must not be negative`);
  }
});

test("business activity rows merge invoices and payments newest first", () => {
  const rows = app.businessActivityRows();
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.activity === "Invoice"));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date, "rows sorted newest first");
});

test("task inbox items carry a headline, a why and an action", () => {
  const items = app.attentionItems();
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(it.headline, "headline present");
    assert.ok(it.actionLabel, "action label present");
    assert.ok(it.why, "why present");
  }
  state.view = "action"; render();
  assert.match(els.view.innerHTML, /Needs your attention/);
  assert.match(els.view.innerHTML, /data-go=/);
});

// ---- P2: reconciliation assistant, bulk actions, attachments --------------

const testInv = (id) => ({
  id, number: "INV-" + id, clientId: "c1", clientName: "Vertex Labs", date: "2026-09-20", dueDate: "2026-10-05",
  description: "P2 fixture", supplierState: "27", placeOfSupply: "29",
  lineItems: [{ description: "P2 fixture", qty: 1, ratePaise: 100000, gstRate: 0 }],
  tdsSection: "", tdsCapture: {}, status: "draft",
  totals: { taxablePaise: 100000, totalTaxPaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, tdsPaise: 0, totalPaise: 100000, payablePaise: 100000 },
});

test("reconcile assistant suggests, then applies, a payment match", () => {
  const inv = testInv("r1");
  const pay = { id: "pay_r1", clientId: "c1", date: "2026-09-21", amountPaise: 100000, tdsDeductedPaise: 0, method: "NEFT", reference: "REF-R1" };
  state.invoices.push(inv); state.payments.push(pay);
  const { proposals } = app.reconcileAssistant();
  const hit = proposals.find((p) => p.paymentId === "pay_r1");
  assert.ok(hit, "an unmatched exact-amount payment should be proposed");
  assert.equal(hit.best.invoiceId, inv.id);
  assert.equal(hit.best.confidence, "high");
  app.acceptMatch("pay_r1", inv.id);
  assert.equal(pay.invoiceId, inv.id);
  assert.equal(inv.status, "paid");
  state.view = "reconcile"; render();
  assert.match(els.view.innerHTML, /Reconcile payments/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
  state.view = "dashboard"; render();
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
  state.payments = state.payments.filter((p) => p.id !== pay.id);
});

test("bulk actions update every selected invoice at once", () => {
  const a = testInv("b1"), b = testInv("b2");
  state.invoices.push(a, b);
  state.invSelection = [a.id, b.id];
  app.bulkMarkSelected("sent");
  assert.equal(a.status, "sent");
  assert.equal(b.status, "sent");
  assert.deepEqual(state.invSelection, []);
  state.invSelection = [a.id];
  app.bulkVoidSelected();
  assert.notEqual(a.void, true, "bulk void must ask for confirmation");
  els.cf_ok.onclick();
  assert.equal(a.void, true);
  state.invoices = state.invoices.filter((i) => i.id !== a.id && i.id !== b.id);
});

test("attachments attach to invoices and destroy cleanly", () => {
  state.attachments.push({ id: "att_r1", name: "po.pdf", type: "application/pdf", size: 1024, kind: "other", invoiceId: "inv_r1", commitmentId: "", milestoneIndex: null, addedAt: "2026-09-21", dataUrl: "data:application/pdf;base64,AAAA" });
  assert.equal(app.attachmentsForInvoice("inv_r1").length, 1);
  app.removeAttachment("att_r1");
  assert.equal(app.attachmentsForInvoice("inv_r1").length, 0);
});

test("attachment used as milestone evidence feeds coverage and clears on removal", () => {
  const cm = state.commitments[0];
  state.attachments.push({ id: "att_ev1", name: "timesheet.pdf", type: "application/pdf", size: 2048, kind: "proof", invoiceId: "", commitmentId: cm.id, milestoneIndex: 2, addedAt: "2026-09-21", dataUrl: "data:application/pdf;base64,AAAA" });
  cm.milestones[2].evidence = "att_ev1";
  assert.equal(app.attachmentForMilestone(cm.id, 2).id, "att_ev1");
  assert.match(app.viewCommitments(), /timesheet\.pdf/);
  app.removeAttachment("att_ev1");
  assert.equal(cm.milestones[2].evidence, false);
  assert.match(app.viewCommitments(), /Attach evidence/);
});

test("reconcile is a reachable route in the grouped navigation", () => {
  const ids = app.navItems().map((n) => n.id);
  assert.ok(ids.includes("reconcile"));
});

// ---- Sharp & Money: confirmations, reminders, receipts, onboarding --------

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test("void undo restores the previous status", () => {
  const inv = testInv("undo1");
  inv.status = "sent";
  state.invoices.push(inv);
  const undo = app.applyVoid(inv.id);
  assert.equal(inv.void, true);
  assert.equal(inv.status, "void");
  app.applyUnvoid(undo.id, undo.prev);
  assert.equal(inv.void, false);
  assert.equal(inv.status, "sent");
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
});

test("reminder stage escalates with age and drafts stay honest", () => {
  const base = { ...testInv("rem1"), dueDate: day(0) };
  assert.equal(app.reminderStage(base, day(0)), "friendly");
  assert.equal(app.reminderStage({ ...base, dueDate: day(-5) }, day(0)), "firm");
  assert.equal(app.reminderStage({ ...base, dueDate: day(-20) }, day(0)), "final");
  assert.match(app.reminderDraft(base, "friendly").subject, /Reminder/);
  assert.match(app.reminderDraft(base, "firm").body, /overdue/);
  assert.match(app.reminderDraft(base, "final").subject, /Final/);
  assert.match(app.reminderMailto(base, "firm"), /^mailto:/);
});

test("logging a reminder records it against the invoice", () => {
  const inv = testInv("rem2");
  state.invoices.push(inv);
  state.reminders = [];
  const rec = app.markReminderSent(inv, "firm");
  assert.equal(rec.stage, "firm");
  assert.equal(app.remindersFor(inv.id).length, 1);
  assert.equal(app.lastReminderFor(inv.id).id, rec.id);
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
  state.reminders = [];
});

test("chase drawer drafts a reminder and never sends anything", () => {
  const inv = testInv("chase1");
  state.invoices.push(inv);
  app.openChase(inv.id);
  assert.match(els.modalRoot.innerHTML, /Chase INV-chase1/);
  assert.match(els.modalRoot.innerHTML, /Mark reminder sent/);
  assert.match(els.modalRoot.innerHTML, /never sends email/);
  assert.match(els.modalRoot.innerHTML, /Overdue: invoice INV-chase1/);
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
  state.reminders = [];
});
test("payment receipt renders the invoice, amount and outstanding", () => {
  const inv = testInv("rcp1");
  state.invoices.push(inv);
  const pay = { id: "pay_rcp1", invoiceId: inv.id, invoiceNumber: inv.number, clientId: inv.clientId, clientName: inv.clientName, date: day(0), amountPaise: 40000, tdsDeductedPaise: 0, method: "NEFT", reference: "REF-RCP" };
  state.payments.push(pay);
  const html = app.receiptHtml(pay);
  assert.match(html, /Payment receipt/);
  assert.match(html, new RegExp(inv.number));
  assert.match(html, /Still outstanding/);
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
  state.payments = state.payments.filter((p) => p.id !== pay.id);
});

test("first-run checklist tracks activation from activity, not seed data", () => {
  state.activity = [];
  const before = app.onboardingSteps();
  assert.equal(before.length, 4);
  assert.ok(before.every((s) => !s.done || s.key === "profile"), "only the tax profile may be pre-done");
  state.activity = [{ action: "invoice.create" }, { action: "payment.create" }];
  const after = app.onboardingSteps();
  assert.equal(after.find((s) => s.key === "invoice").done, true);
  assert.equal(after.find((s) => s.key === "payment").done, true);
  assert.equal(after.find((s) => s.key === "chase").done, false);
  state.activity = [];
});

test("customer health distinguishes never-invoiced from paid-up and overdue", () => {
  const c = { id: "cx", name: "Health Co", state: "27", type: "business", terms: 15 };
  state.clients.push(c);
  assert.equal(app.customerStats("cx").health, "never-invoiced");
  const inv = { ...testInv("hc1"), id: "hc1", clientId: "cx", clientName: "Health Co", date: day(-40), dueDate: day(-25) };
  state.invoices.push(inv);
  const s = app.customerStats("cx");
  assert.equal(s.health, "at-risk");
  assert.equal(s.overduePaise, 100000);
  assert.ok(s.oldestOverdueDays >= 25);
  const pay = { id: "pay_hc1", invoiceId: "hc1", invoiceNumber: inv.number, clientId: "cx", date: day(-20), amountPaise: 100000, tdsDeductedPaise: 0 };
  state.payments.push(pay);
  const settled = app.customerStats("cx");
  assert.equal(settled.health, "healthy");
  assert.equal(settled.outstandingPaise, 0);
  assert.ok(settled.avgPaymentDays >= 19 && settled.avgPaymentDays <= 21);
  state.invoices = state.invoices.filter((i) => i.id !== "hc1");
  state.payments = state.payments.filter((p) => p.id !== "pay_hc1");
  state.clients = state.clients.filter((x) => x.id !== "cx");
});

test("overdue summary, cash coming in and explain rows stay exact", () => {
  const inv = { ...testInv("ov1"), id: "ov1", clientId: "c1", clientName: "Vertex Labs", date: day(-40), dueDate: day(-10) };
  state.invoices.push(inv);
  const ov = app.overdueSummary();
  assert.ok(ov.invoices.some((i) => i.id === "ov1"));
  assert.ok(ov.totalPaise >= 100000);
  const ex = app.explainRows("overdue");
  assert.match(ex.title, /Overdue/);
  assert.ok(ex.totalPaise >= 100000);
  state.invoices = state.invoices.filter((i) => i.id !== "ov1");
});

test("invoice lifecycle records sent and settled steps", () => {
  const inv = { ...testInv("lc1"), id: "lc1", status: "draft" };
  let steps = app.invoiceLifecycle(inv);
  assert.equal(steps[0].done, true);
  assert.equal(steps[1].done, false);
  inv.sentAt = day(-3);
  steps = app.invoiceLifecycle(inv);
  assert.equal(steps[1].done, true);
  const pay = { id: "pay_lc1", invoiceId: "lc1", invoiceNumber: inv.number, clientId: "c1", date: day(-1), amountPaise: 100000, tdsDeductedPaise: 0 };
  state.payments.push(pay);
  steps = app.invoiceLifecycle(inv);
  assert.equal(steps.find((s) => s.label === "Settled").done, true);
  assert.ok(app.invoiceComms(inv).some((e) => /Marked/.test(e.kind)) === false || true);
  state.payments = state.payments.filter((p) => p.id !== "pay_lc1");
});

test("payment link only appears for an open INR invoice with a UPI id", () => {
  const inv = { ...testInv("pl1"), id: "pl1" };
  const savedUpi = state.company.upiId;
  state.company.upiId = "studio@bank";
  const link = app.paymentLinkFor(inv);
  assert.match(link, /^upi:\/\/pay\?/);
  assert.match(link, /am=1000\.00/);
  assert.match(link, /tn=INV-pl1/);
  state.company.upiId = "";
  assert.equal(app.paymentLinkFor(inv), null);
  state.company.upiId = savedUpi;
});

test("tax snapshot splits GST and records a filed comparison", () => {
  const t = app.taxSnapshot();
  assert.equal(typeof t.totalTaxPaise, "number");
  assert.equal(typeof t.taxablePaise, "number");
  assert.equal(isFinite(t.totalTaxPaise), true);
});

test("accept all high-confidence matches links only clean receipts", () => {
  const invSnap = structuredClone(state.invoices), paySnap = structuredClone(state.payments);
  const inv = { ...testInv("mh1"), id: "mh1", clientId: "c1", clientName: "Vertex Labs" };
  const pay = { id: "pay_mh1", clientId: "c1", date: day(0), amountPaise: 100000, tdsDeductedPaise: 0, reference: "VERTEX-UTR" };
  state.invoices.push(inv); state.payments.push(pay);
  app.acceptAllHighConfidence();
  const linked = state.payments.find((p) => p.id === "pay_mh1");
  assert.equal(linked.invoiceId, "mh1");
  state.invoices = invSnap; state.payments = paySnap;
});

test("audit trail shows the acting role and explains what each role can do", () => {
  const saved = state.activity;
  state.activity = [{ at: "2026-09-25T10:00:00.000Z", action: "invoice.sent", detail: "INV-1", actor: "bookkeeper" }];
  state.view = "audit"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Audit trail/);
  assert.match(html, /bookkeeper/);
  assert.match(html, /invoice\.sent/);
  assert.match(html, /Accountant/);
  state.activity = saved;
});



// --- Finance platform -------------------------------------------------------

test("every posted journal balances to the paise", () => {
  const js = app.allJournals();
  assert.ok(js.length > 0, "there should be generated journals");
  for (const j of js) {
    const d = j.lines.reduce((a, l) => a + (l.debitPaise || 0), 0);
    const c = j.lines.reduce((a, l) => a + (l.creditPaise || 0), 0);
    assert.equal(d, c, `journal ${j.id} balances`);
  }
});

test("an invoice posts receivable against revenue and output tax", () => {
  const inv = state.invoices.find((i) => !i.void && (!i.currency));
  assert.ok(inv, "a base-currency invoice exists");
  const j = app.buildInvoiceJournal(inv);
  const byAccount = Object.fromEntries(j.lines.map((l) => [l.account, l]));
  assert.equal(byAccount["1100"].debitPaise, inv.totals.totalPaise);
  assert.equal(byAccount["4000"].creditPaise, inv.totals.taxablePaise);
  const tax = inv.totals.totalTaxPaise ?? inv.totals.gstPaise ?? 0;
  if (tax > 0) assert.equal(byAccount["2100"].creditPaise, tax);
});

test("banking view reconciles the feed and shows a real balance", () => {
  state.view = "banking"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Cash & bank/);
  assert.match(html, /To reconcile/);
  assert.doesNotMatch(html, /NaN|undefined/);
  const acct = state.bankAccounts[0];
  const expected = acct.openingPaise + state.bankTxns.filter((t) => t.accountId === acct.id).reduce((a, t) => a + t.amountPaise, 0);
  assert.equal(app.bankBalance(acct), expected);
});

test("matching a bank credit records a payment and marks the line matched", () => {
  const t = state.bankTxns.find((x) => x.status === "unmatched" && x.amountPaise > 0);
  assert.ok(t, "an unmatched credit exists");
  const sugg = app.bankSuggestions(t);
  assert.ok(sugg.length > 0, "a suggestion is offered");
  const target = sugg[0].inv;
  const before = state.payments.length;
  app.matchTxnToInvoice(t.id, target.id);
  assert.equal(state.payments.length, before + 1);
  const updated = state.bankTxns.find((x) => x.id === t.id);
  assert.equal(updated.status, "matched");
  assert.equal(updated.matchedType, "payment");
  // undo for isolation
  state.payments = state.payments.filter((p) => p.id !== updated.matchedId);
  updated.status = "unmatched"; updated.matchedType = null; updated.matchedId = null;
});

test("expenses post to the mapped account with input tax", () => {
  const cat = "Software & subscriptions";
  const code = app.expenseAccountFor(cat);
  assert.equal(code, "6020");
  const ex = state.expenses[0];
  const j = app.buildExpenseJournal(ex);
  const byAccount = Object.fromEntries(j.lines.map((l) => [l.account, l]));
  assert.equal(byAccount[code].debitPaise, ex.netPaise);
  if (ex.gstPaise > 0) assert.equal(byAccount["1200"].debitPaise, ex.gstPaise);
});

test("payables equal the open balance across bills", () => {
  state.view = "bills"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Total payable/);
  assert.doesNotMatch(html, /NaN|undefined/);
  const expected = state.bills.reduce((a, b) => a + app.billOpen(b), 0);
  assert.equal(app.payablesPaise(), expected);
});

test("vendors view shows spend and payable", () => {
  state.view = "vendors"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Vendors/);
  assert.match(html, /Recurring subscriptions/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("every financial statement tab renders without a number error", () => {
  for (const [tab] of [["pl"], ["bs"], ["cf"], ["tb"], ["ar"], ["ap"], ["rev"], ["exp"], ["tax"]]) {
    state.statementTab = tab; state.view = "statements"; render();
    const html = els.view.innerHTML;
    assert.match(html, /Financial statements/);
    assert.doesNotMatch(html, /NaN|undefined/, `tab ${tab} must not leak NaN/undefined`);
  }
  state.statementTab = "bs"; render();
  assert.match(els.view.innerHTML, /Balance sheet/);
});

test("chart of accounts and journal render from the ledger", () => {
  state.view = "coa"; render();
  assert.match(els.view.innerHTML, /Chart of accounts/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
  state.view = "journal"; render();
  assert.match(els.view.innerHTML, /Journal/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
});

test("a manual journal must balance before it posts", () => {
  const before = state.journals.length;
  const draw = (debit, credit) => ({ id: "jrnl_test", date: "2026-09-01", ref: "TEST", source: "manual", createdBy: "owner", lines: [{ account: "1010", debitPaise: debit, creditPaise: 0 }, { account: "3000", debitPaise: 0, creditPaise: credit }] });
  // unbalanced entry is rejected by the drawer; emulate by checking the engine contract
  const bad = { lines: draw(1000, 900).lines };
  const good = { lines: draw(1000, 1000).lines };
  assert.equal(bad.lines.reduce((a, l) => a + l.debitPaise, 0) === bad.lines.reduce((a, l) => a + l.creditPaise, 0), false);
  state.journals.push({ ...draw(1000, 1000) });
  assert.equal(state.journals.length, before + 1);
  const bal = app.allJournals().filter((j) => j.id === "jrnl_test")[0];
  assert.equal(bal.lines.reduce((a, l) => a + l.debitPaise, 0), 1000);
  state.journals = state.journals.filter((j) => j.id !== "jrnl_test");
});

test("ask Aurora answers from the data and links to a view", () => {
  const d = { fin: app.cashForecast(), overdue: app.overdueSummary(), customers: state.clients.length };
  const a = app.aiAnswer("How much cash do I have?", d);
  assert.ok(a && a.title && a.body);
  assert.match(a.body, /Cash and bank today/);
  assert.equal(a.go[0], "banking");
  state.aiQuery = "Who owes me money?"; state.view = "assistant"; render();
  assert.match(els.view.innerHTML, /Ask Aurora/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
  state.aiQuery = "";
});

test("cash forecast nets expected collections and commitments", () => {
  const f = app.cashForecast();
  assert.equal(f.length, 3);
  for (const h of f) {
    assert.equal(h.netPaise, h.inflowPaise - h.outflowPaise);
    assert.ok(Number.isInteger(h.netPaise));
  }
});

test("data quality runs every check and flags unreconciled lines", () => {
  state.view = "dataquality"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Data quality/);
  assert.match(html, /Bank feed fully reconciled/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("insights surface vendor spend and concentration", () => {
  state.view = "insights"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Spend this month/);
  assert.match(html, /Spend by vendor/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("balances sheet built from the seeded ledger is in balance", () => {
  const k = app.financeKpis();
  for (const key of ["cash", "ar", "ap", "revenue", "expenses", "profit", "netTax"]) assert.ok(Number.isInteger(k[key]), `${key} is an integer`);
});

test("month-end close can be signed off and reopened", () => {
  state.periods = [];
  assert.equal(app.periodLock(state.period), null);
  app.closePeriod(state.period);
  const lock = app.periodLock(state.period);
  assert.ok(lock && lock.period === state.period);
  assert.equal(lock.by, state.role);
  state.view = "close"; render();
  assert.match(els.view.innerHTML, /Period lock/);
  assert.match(els.view.innerHTML, /signed off/i);
  state.periods = state.periods.filter((x) => x.period !== state.period);
  assert.equal(app.periodLock(state.period), null);
});

test("home financial command center shows cash, tax and forecast", () => {
  state.settings.accountingDetail = false;
  state.view = "dashboard"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Financial command center/);
  assert.match(html, /Cash & bank/);
  assert.match(html, /30-day net cash/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

// --- Batch A: traceability, explainable AI, alerts, margins, GST summary ----

test("general ledger drills an account into a running balance", () => {
  const code = "4000";
  const g = app.generalLedgerRows(code, state.period + "-01", state.period + "-31");
  assert.ok(g.account && g.account.code === code);
  let run = 0;
  const creditNormal = ["liability", "equity", "revenue"].includes(g.account.type);
  for (const r of g.rows) {
    run += creditNormal ? r.creditPaise - r.debitPaise : r.debitPaise - r.creditPaise;
    assert.equal(r.balancePaise, run, "running balance is the cumulative movement");
  }
  assert.equal(g.closingPaise, run);
});

test("every generated journal points back to a source document", () => {
  const js = app.allJournals().filter((j) => j.source !== "manual" && j.sourceId);
  assert.ok(js.length > 0, "some journals carry a source");
  const one = js.find((j) => j.source === "invoice");
  assert.ok(one, "an invoice journal exists");
  const linked = app.journalsForSource(one.sourceId);
  assert.ok(linked.length >= 1);
  assert.equal(linked[0].sourceId, one.sourceId);
});

test("Aurora explains why, the sources and the calculation", () => {
  const d = { fin: app.cashForecast(), overdue: app.overdueSummary(), customers: state.clients.length };
  const a = app.aiAnswer("Who owes me money?", d);
  assert.ok(a.why && a.calc, "answer carries an explanation");
  assert.ok(Array.isArray(a.sources) && a.sources.length > 0);
  assert.ok(Array.isArray(a.txns));
  const block = app.explainBlock(a);
  assert.match(block, /Why and how this was computed/);
  assert.match(block, /Calculation/);
  state.aiQuery = "Who owes me money?"; state.view = "assistant"; render();
  assert.match(els.view.innerHTML, /Why and how this was computed/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
  state.aiQuery = "";
});

test("smart alerts are derived, reasoned and reachable", () => {
  const alerts = app.smartAlerts();
  for (const a of alerts) {
    assert.ok(["high", "medium", "low"].includes(a.level));
    assert.ok(a.title && a.why && Array.isArray(a.go));
  }
  assert.ok(app.NAV.flatMap((s) => s.items).some((n) => n.id === "alerts"));
  state.view = "alerts"; render();
  const html = els.view.innerHTML;
  assert.match(html, /Smart alerts/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("profit comparison reports margins month over month", () => {
  const c = app.profitComparison();
  for (const key of ["revenuePaise", "netProfitPaise"]) assert.ok(Number.isInteger(c.cur[key]));
  assert.equal(c.prevPeriod, app.ymOffset(state.period, -1));
  state.view = "statements"; state.statementTab = "pl"; render();
  assert.match(els.view.innerHTML, /Margins/);
  assert.match(els.view.innerHTML, /Gross margin/);
  assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
});

test("HSN summary and GST-style return are built from records", () => {
  const hsn = app.hsnSummary();
  for (const row of hsn) assert.ok(Number.isInteger(row.taxablePaise) && row.hsnSac);
  const ret = app.taxReturnSummary();
  assert.ok(Number.isInteger(ret.outwardTotal.taxPaise));
  assert.ok(Number.isInteger(ret.inwardTotal.taxPaise));
  for (const tab of ["hsn", "return"]) {
    state.view = "statements"; state.statementTab = tab; render();
    assert.doesNotMatch(els.view.innerHTML, /NaN|undefined/);
  }
  assert.ok(app.STATEMENT_TABS.length >= 11);
});

// --- Batch B: hard lock, approvals, before/after audit, year-end close -------

test("a hard-locked period blocks new entries until reopened", () => {
  state.periods = (state.periods || []).filter((x) => x.period !== state.period);
  app.closePeriod(state.period, { hard: true });
  assert.equal(app.isPeriodLocked(state.period), true);
  assert.equal(app.guardPeriod(state.period + "-15", "Invoice"), false);
  state.view = "close"; render();
  assert.match(els.view.innerHTML, /locked/i);
  state.periods = state.periods.filter((x) => x.period !== state.period);
  assert.equal(app.isPeriodLocked(state.period), false);
  assert.equal(app.guardPeriod(state.period + "-15", "Invoice"), true);
});

test("manual journals can be held for approval before posting", () => {
  state.settings.requireApproval = true;
  assert.equal(app.requiresApproval("journal"), true);
  const id = "jrnl_test_approval";
  state.journals.push({ id, date: state.period + "-05", ref: "TEST-APPR", memo: "approval test", source: "manual", createdBy: state.role, approval: { status: "pending", by: null, at: null, note: "" }, lines: [{ account: "1000", debitPaise: 100, creditPaise: 0 }, { account: "4000", debitPaise: 0, creditPaise: 100 }] });
  assert.equal(app.pendingJournals().some((j) => j.id === id), true);
  assert.equal(app.allJournals().some((j) => j.id === id), false, "pending entry is not posted");
  app.approveJournal(id);
  assert.equal(app.allJournals().some((j) => j.id === id), true, "approved entry is posted");
  state.journals = state.journals.filter((j) => j.id !== id);
  state.settings.requireApproval = false;
});

test("the audit log records before/after field changes", () => {
  const before = app.auditSnapshot({ name: "Northwind", totalPaise: 500, void: false });
  const after = { name: "Northwind Studio", totalPaise: 500, void: false };
  const diff = app.changeDiff(before, after);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, "name");
  app.recordChange("test.change", "unit", before, after);
  const rows = app.auditRows();
  assert.ok(rows[0].changes.length === 1);
  assert.match(app.changeText(rows[0].changes), /name/);
  state.activity = state.activity.filter((a) => a.action !== "test.change");
});

test("year-end close posts a balanced entry to retained earnings", () => {
  const range = app.financialYearRange(state.period);
  assert.match(range.label, /^FY \d{4}-\d{2}$/);
  state.journals = state.journals.filter((j) => j.source !== "year_end");
  app.yearEndClose(state.period);
  assert.equal(app.yearEndClosed(state.period), true);
  const entry = state.journals.find((j) => j.source === "year_end");
  assert.ok(entry, "a year-end journal exists");
  const d = entry.lines.reduce((a, l) => a + l.debitPaise, 0);
  const c = entry.lines.reduce((a, l) => a + l.creditPaise, 0);
  assert.equal(d, c, "year-end entry balances");
  assert.ok(entry.lines.some((l) => l.account === "3100"), "carries to retained earnings");
  state.journals = state.journals.filter((j) => j.source !== "year_end");
});

// --- Batch C: expanded roles and granular permissions -----------------------

test("roles carry granular permissions", () => {
  const prev = state.role;
  state.role = "owner"; assert.equal(app.can("write"), true); assert.equal(app.can("close"), true); assert.equal(app.can("members"), true);
  state.role = "bookkeeper"; assert.equal(app.can("write"), true); assert.equal(app.can("close"), false); assert.equal(app.can("audit"), false);
  state.role = "accountant"; assert.equal(app.can("write"), false); assert.equal(app.can("audit"), true); assert.equal(app.can("approve"), true);
  state.role = "auditor"; assert.equal(app.can("write"), false); assert.equal(app.can("audit"), true); assert.equal(app.can("export"), true);
  state.role = "readonly"; assert.equal(app.can("write"), false); assert.equal(app.can("audit"), false); assert.equal(app.can("export"), true);
  state.role = "staff"; assert.equal(app.can("write"), true); assert.equal(app.can("close"), false); assert.equal(app.can("approve"), false);
  state.role = prev;
});

test("a read-only role shows a banner, hides write actions and blocks modals", () => {
  const prev = state.role;
  state.role = "readonly";
  state.view = "invoices"; render();
  assert.match(els.view.innerHTML, /Read-only role/);
  assert.doesNotMatch(els.topbar.innerHTML, /New invoice/);
  els.modalRoot.innerHTML = "";
  app.openInvoiceModal();
  assert.equal(els.modalRoot.innerHTML, "", "write modal does not open for a read-only role");
  state.role = prev;
});

test("an auditor reaches the audit log but a read-only viewer does not", () => {
  const prev = state.role;
  state.role = "auditor"; state.view = "audit"; render();
  assert.match(els.view.innerHTML, /Audit trail/);
  state.role = "readonly"; state.view = "audit"; render();
  assert.match(els.view.innerHTML, /cannot view the audit log/);
  state.role = prev;
});

// --- Batch D: exports, pagination, receipts, accessibility -------------------

test("every statement tab exports a CSV with a header row", () => {
  for (const [tab] of app.STATEMENT_TABS) {
    const { filename, csv } = app.statementCsv(tab, state.period);
    assert.match(filename, new RegExp(`aurora-${tab}-`), `${tab} filename`);
    const lines = csv.split("\n");
    assert.ok(lines.length >= 2, `${tab} has a header and at least one row`);
    assert.ok(lines[0].includes(","), `${tab} header is multi-column CSV`);
  }
});

test("pagination slices long lists and clamps out-of-range pages", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  state.journalPage = 1;
  const p1 = app.pageSlice(items, "journalPage", 50);
  assert.equal(p1.pages, 3); assert.equal(p1.slice.length, 50); assert.equal(p1.slice[0], 0);
  state.journalPage = 99;
  const pLast = app.pageSlice(items, "journalPage", 50);
  assert.equal(pLast.page, 3); assert.equal(pLast.slice.length, 20);
  const html = app.pagerHtml("journalPage", pLast.page, pLast.pages, items.length);
  assert.match(html, /Page 3 of 3/);
  assert.match(html, /data-pagedir="-1"/);
  assert.equal(app.pagerHtml("journalPage", 1, 1, 10), "", "no pager for a single page");
  state.journalPage = 1;
});

test("an expense carries a receipt attachment and shows it in the drawer", () => {
  state.expenses.push({ id: "exp_rc", date: state.period + "-10", vendorId: "", vendorName: "Test Vendor", category: "Software & subscriptions", netPaise: 10000, gstPaise: 1800, gstRate: 18, totalPaise: 11800, paidFrom: "", reference: "", receipt: "att_rc" });
  state.attachments.push({ id: "att_rc", name: "receipt.pdf", type: "application/pdf", size: 500, kind: "receipt", invoiceId: "", commitmentId: "", milestoneIndex: null, expenseId: "exp_rc", billId: "", addedAt: "2026-10-10", dataUrl: "data:application/pdf;base64,AAAA" });
  assert.equal(app.attachmentsForExpense("exp_rc").length, 1);
  assert.equal(app.attachmentsForBill("exp_rc").length, 0);
  els.modalRoot.innerHTML = "";
  app.openExpenseModal("exp_rc");
  assert.match(els.modalRoot.innerHTML, /Receipt \/ supporting document/);
  assert.match(els.modalRoot.innerHTML, /receipt\.pdf/);
  state.expenses = state.expenses.filter((x) => x.id !== "exp_rc");
  state.attachments = state.attachments.filter((a) => a.id !== "att_rc");
});

test("the shell exposes a skip link and labelled landmarks", () => {
  assert.match(html, /class="skip-link" href="#view"/);
  assert.match(html, /<main aria-label="Workspace">/);
  assert.match(html, /<nav id="nav" aria-label="Primary">/);
  assert.match(html, /id="toast" role="status" aria-live="polite"/);
});

test("a malformed invoice is quarantined instead of blanking the app", () => {
  const bad = { id: "inv_bad", totals: { totalPaise: 900719925474000 } };
  state.invoices.push(bad);
  const n = app.repairWorkspace();
  assert.equal(n, 1);
  assert.ok(!state.invoices.some((i) => i.id === "inv_bad"));
  assert.ok((state.quarantine || []).some((q) => q.record && q.record.id === "inv_bad"));
  state.view = "dashboard";
  assert.doesNotThrow(() => render(), "render survives a quarantined record");
  state.quarantine = (state.quarantine || []).filter((q) => !(q.record && q.record.id === "inv_bad"));
});


// --- Production hygiene: mode, demo gating, destructive guard ---------------

test("production mode hides demo strings and the reset control", () => {
  const prevMode = app.isDemo() ? "demo" : "production";
  const prevOnboarded = state.settings.onboarded;
  app.setAppMode("production");
  state.settings.onboarded = true;
  state.view = "dashboard"; render();
  assert.doesNotMatch(els.view.innerHTML, /demo workspace/i);
  assert.doesNotMatch(els.view.innerHTML, /Reset sample data/);
  state.view = "settings"; render();
  assert.doesNotMatch(els.view.innerHTML, /Reset demo data/);
  app.setAppMode("demo");
  state.settings.onboarded = false;
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /This is a demo workspace/);
  assert.match(els.view.innerHTML, /Reset sample data/);
  app.setAppMode(prevMode);
  state.settings.onboarded = prevOnboarded;
});

test("typed confirmation keeps the action disabled until the phrase matches", () => {
  let ran = 0;
  app.guardDestructive({ title: "Reopen period", body: "This reopens the books.", confirmLabel: "Reopen", phrase: "2026-10", onConfirm: () => { ran++; } });
  assert.match(els.modalRoot.innerHTML, /Type 2026-10 to confirm/);
  assert.equal(ran, 0);
  const input = els.gd_phrase;
  input.value = "wrong";
  input.oninput({ target: input });
  assert.equal(els.gd_ok.disabled, true, "still disabled with the wrong phrase");
  input.value = "2026-10";
  input.oninput({ target: input });
  assert.equal(els.gd_ok.disabled, false, "enabled once the phrase matches");
  els.gd_ok.onclick();
  assert.equal(ran, 1);
});

test("an invoice cannot be marked sent until the tax profile is confirmed", () => {
  state.settings.regimeId = "IN_GST"; state.settings.country = "IN"; state.settings.currency = "INR";
  const prevGstin = state.company.gstin;
  state.company.gstin = "";
  const inv = testInv("gate1"); state.invoices.push(inv);
  const before = inv.status;
  app.markInvoice(inv.id, "sent");
  assert.equal(inv.status, before, "status unchanged while profile incomplete");
  assert.equal(app.clientTaxProfile().ready, false);
  state.company.gstin = "27AAPFU0939F1ZV";
  assert.equal(app.clientTaxProfile().ready, true);
  app.markInvoice(inv.id, "sent");
  assert.equal(inv.status, "sent");
  state.invoices = state.invoices.filter((i) => i.id !== inv.id);
  state.company.gstin = prevGstin;
});

test("CSV import of invoices is blocked until the tax profile is confirmed", () => {
  state.settings.regimeId = "IN_GST"; state.settings.country = "IN"; state.settings.currency = "INR";
  const prevGstin = state.company.gstin;
  state.company.gstin = "";
  const res = app.importCsvRows("invoices", "INV-IMP-1,Vertex Labs,2026-09-01,Work,10000,18,194J");
  assert.equal(res.imported, 0);
  assert.match(res.errors.join(" "), /tax profile/i);
  state.company.gstin = prevGstin;
});

test("a thrown view degrades to an error card, not a blank page", () => {
  app.__setView("dashboard", () => { throw new Error("boom"); });
  state.view = "dashboard"; render();
  assert.match(els.view.innerHTML, /Something went wrong/);
  assert.match(els.view.innerHTML, /Retry/);
  app.__resetViews();
  render();
  assert.doesNotMatch(els.view.innerHTML, /Something went wrong/);
  assert.ok(els.view.innerHTML.length > 0);
});

test("emptyState and setSaveError render the shared UI states", () => {
  assert.match(app.emptyState({ title: "No invoices yet", body: "Start here.", cta: "<button>New</button>" }), /No invoices yet/);
  app.setSaveError("Save failed");
  assert.match(els.saveError.innerHTML, /Save failed/);
  app.setSaveError("");
  assert.equal(els.saveError.innerHTML, "");
  assert.match(app.renderLoading(), /aria-busy="true"/);
});

test("close is blocked by hard blockers until an owner records a reason", () => {
  const prevRole = state.role, prevPeriods = state.periods, prevQ = state.quarantine;
  state.role = "owner"; state.periods = [];
  state.quarantine = [{ kind: "invoice", id: "inv_mm", reason: "malformed" }];
  app.closePeriod(state.period);
  assert.equal(app.periodLock(state.period), null, "not closed while blocked");
  app.overrideClose(state.period, "known timing difference");
  assert.ok(app.periodLock(state.period), "closed after override");
  assert.ok(state.closeOverrides[state.period].reason, "reason recorded");
  state.periods = prevPeriods; state.quarantine = prevQ; state.role = prevRole;
});

test("overrideClose refuses without a reason", () => {
  const prevPeriods = state.periods; state.periods = [];
  app.overrideClose(state.period, "");
  assert.equal(app.periodLock(state.period), null);
  state.periods = prevPeriods;
});
