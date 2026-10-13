import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roundHalfUp, toPaise, toRupees, pctOf, formatINR,
  validateGSTIN, gstSplit, computeInvoiceTotals,
  computeTds, tdsRequirements, validateTdsCapture,
  fragmentationState, fragmentationScore, recommendFragmentation,
  detectPaymentAsymmetry, coverageAwareAccrual, runningBalance,
  buildBillingLedger, queueItemStatus, monthEndClose,
  toMinor, formatMoney, CURRENCIES, taxSplit, TAX_REGIMES, taxRegime, validateTaxId,
  validateAbn, validateUkVat, validateEuVat, validateTrn,
  allocateProportional, lineBasePaise, reconcileInvoice, validateInvoice,
  proposeMatches,
  taxProfileReady, closeBlockers, closeWarnings, figureSource,
} from "../engine.js";

// ---------------------------------------------------------------------------
// Fixed-point money
// ---------------------------------------------------------------------------

test("money: parses Indian formatted strings without float drift", () => {
  assert.equal(toPaise("1,25,000.50"), 12500050);
  assert.equal(toPaise("0.1"), 10);
  assert.equal(toPaise("0.05"), 5);
  assert.equal(toPaise("0.005"), 1); // half-up
  assert.equal(toPaise("-0.005"), -1);
  assert.equal(toPaise(1250.5), 125050);
  assert.equal(toPaise(""), 0);
});

test("money: pctOf is exact on awkward amounts", () => {
  assert.equal(pctOf(10001, 18), 1800); // 1800.18 -> 1800
  assert.equal(pctOf(10005, 18), 1801); // 1800.9 -> 1801
  assert.equal(pctOf(0, 18), 0);
  assert.equal(pctOf(500, 10), 50);
});

test("money: 100 x 0.1 + 0.2 style drift never happens (integer paise)", () => {
  let total = 0;
  for (let i = 0; i < 100; i++) total += toPaise("0.01");
  assert.equal(total, 100);
  assert.equal(toRupees(total), 1);
});

test("money: roundHalfUp handles negatives symmetrically", () => {
  assert.equal(roundHalfUp(5, 2), 3);
  assert.equal(roundHalfUp(-5, 2), -3);
  assert.equal(roundHalfUp(1, 2), 1);
  assert.equal(roundHalfUp(-1, 2), -1);
});

test("money: Indian digit grouping", () => {
  assert.equal(formatINR(12500050), "₹1,25,000.50");
  assert.equal(formatINR(100), "₹1.00");
  assert.equal(formatINR(1000000000), "₹1,00,00,000.00");
  assert.equal(formatINR(-12500050), "-₹1,25,000.50");
});

// ---------------------------------------------------------------------------
// GSTIN + GST
// ---------------------------------------------------------------------------

test("gstin: accepts valid and rejects bad checksum / format", () => {
  assert.equal(validateGSTIN("27AAPFU0939F1ZV").valid, true);
  assert.equal(validateGSTIN("29AABCU9603R1ZJ").valid, true);
  assert.equal(validateGSTIN("27AAPFU0939F1ZX").valid, false); // checksum
  assert.equal(validateGSTIN("27AAPFU0939F1Z").valid, false); // length
  assert.equal(validateGSTIN("99AAPFU0939F1ZV").valid, false); // state
});

test("gst: intra-state split re-adds exactly with odd paise", () => {
  const s = gstSplit(10001, 18, { interState: false });
  assert.equal(s.gst, 1800);
  assert.equal(s.cgst, 900);
  assert.equal(s.sgst, 900);
  assert.equal(s.cgst + s.sgst, s.gst);
});

test("gst: inter-state is IGST only", () => {
  const s = gstSplit(100000, 18, { interState: true });
  assert.equal(s.igst, 18000);
  assert.equal(s.cgst, 0);
  assert.equal(s.sgst, 0);
});

test("invoice totals: fractional qty + intra-state GST + TDS", () => {
  const t = computeInvoiceTotals({
    supplierState: "27",
    placeOfSupply: "27",
    tdsSection: "194J",
    lineItems: [{ description: "Design", qty: 2.5, ratePaise: 100000, gstRate: 18 }],
  });
  assert.equal(t.taxablePaise, 250000);
  assert.equal(t.gstPaise, 45000);
  assert.equal(t.totalPaise, 295000);
  assert.equal(t.tdsPaise, 25000); // 10% of taxable, excluding GST
  assert.equal(t.payablePaise, 270000);
});

test("invoice totals: inter-state when place of supply differs", () => {
  const t = computeInvoiceTotals({
    supplierState: "27",
    placeOfSupply: "29",
    lineItems: [{ taxablePaise: 100000, gstRate: 18 }],
  });
  assert.equal(t.interState, true);
  assert.equal(t.igstPaise, 18000);
  assert.equal(t.cgstPaise, 0);
});

// ---------------------------------------------------------------------------
// TDS
// ---------------------------------------------------------------------------

test("tds: rates by section, on taxable value", () => {
  assert.equal(computeTds({ taxablePaise: 100000, section: "194J" }).tdsPaise, 10000);
  assert.equal(computeTds({ taxablePaise: 100000, section: "194C-co" }).tdsPaise, 2000);
  assert.equal(computeTds({ taxablePaise: 100000, section: "194C-ind" }).tdsPaise, 1000);
  assert.equal(computeTds({ taxablePaise: 100000, section: "194H" }).tdsPaise, 5000);
});

test("tds: progressive disclosure requirements per section", () => {
  assert.deepEqual(tdsRequirements("194J").map((r) => r.key), ["nature", "hours", "periodFrom", "periodTo"]);
  assert.deepEqual(tdsRequirements("194C-co").map((r) => r.key), ["contractRef", "workDate"]);
  assert.deepEqual(tdsRequirements("").map((r) => r.key), []);
  assert.equal(validateTdsCapture({ tdsSection: "194J", tdsCapture: {} }).complete, false);
  assert.equal(validateTdsCapture({ tdsSection: "194J", tdsCapture: { nature: "Dev", hours: 10, periodFrom: "2026-01-01", periodTo: "2026-01-31" } }).complete, true);
});

// ---------------------------------------------------------------------------
// Fragmentation recommendation
// ---------------------------------------------------------------------------

test("recommendation: fifth invoice upgrades to urgent", () => {
  const base = { avgInvoicePaise: 500000, role: "owner", clientName: "Acme" };
  assert.equal(fragmentationState(1), "single_invoice_optimized");
  assert.equal(fragmentationState(4), "proactive_consolidation");
  assert.equal(fragmentationState(5), "urgent_consolidation");
  assert.equal(recommendFragmentation({ ...base, invoiceCount: 4 }).level, "warn");
  assert.equal(recommendFragmentation({ ...base, invoiceCount: 5 }).level, "urgent");
});

test("recommendation: role changes the framing, not the state", () => {
  const a = recommendFragmentation({ invoiceCount: 5, avgInvoicePaise: 100000, role: "owner", clientName: "Acme" });
  const b = recommendFragmentation({ invoiceCount: 5, avgInvoicePaise: 100000, role: "bookkeeper", clientName: "Acme" });
  assert.equal(a.state, b.state);
  assert.notEqual(a.roleAdvice, b.roleAdvice);
});

test("recommendation: score is bounded 0-100 and rises with fragmentation", () => {
  assert.ok(fragmentationScore({ invoiceCount: 1, avgInvoicePaise: 1000000 }) < fragmentationScore({ invoiceCount: 8, avgInvoicePaise: 100000 }));
  assert.ok(fragmentationScore({ invoiceCount: 100, avgInvoicePaise: 0 }) <= 100);
});

// ---------------------------------------------------------------------------
// Asymmetry
// ---------------------------------------------------------------------------

test("asymmetry: clean payment reconstructs invoice total", () => {
  const r = detectPaymentAsymmetry({
    invoice: { number: "INV-1", totalPaise: 295000, tdsPaise: 25000 },
    payment: { amountPaise: 270000, tdsDeductedPaise: 25000 },
  });
  assert.equal(r.clean, true);
  assert.equal(r.expectedBankPaise, 270000);
});

test("asymmetry: flags short payment and TDS mismatch separately", () => {
  const r = detectPaymentAsymmetry({
    invoice: { number: "INV-1", totalPaise: 295000, tdsPaise: 25000 },
    payment: { amountPaise: 260000, tdsDeductedPaise: 25000 },
  });
  assert.equal(r.clean, false);
  assert.ok(r.flags.find((f) => f.code === "short_payment"));

  const t = detectPaymentAsymmetry({
    invoice: { number: "INV-2", totalPaise: 295000, tdsPaise: 25000 },
    payment: { amountPaise: 270000, tdsDeductedPaise: 20000 },
  });
  assert.ok(t.flags.find((f) => f.code === "tds_mismatch"));
});

// ---------------------------------------------------------------------------
// Coverage-aware accrual
// ---------------------------------------------------------------------------

test("accrual: below threshold defers the uncovered portion", () => {
  const a = coverageAwareAccrual({
    fixedFeePaise: 1000000,
    milestones: [
      { label: "M1", pct: 0.5, evidence: true },
      { label: "M2", pct: 0.5, evidence: false },
    ],
  });
  assert.equal(a.evidencedPct, 0.5);
  assert.equal(a.recognizablePaise, 500000);
  assert.equal(a.deferredPaise, 500000);
  assert.equal(a.covered, false);
  assert.deepEqual(a.unevidenced, ["M2"]);
});

test("accrual: at/above threshold recognizes", () => {
  const a = coverageAwareAccrual({
    fixedFeePaise: 1000000,
    coverageThreshold: 1,
    milestones: [{ label: "M1", pct: 1, evidence: true }],
  });
  assert.equal(a.covered, true);
  assert.equal(a.deferredPaise, 0);
});

// ---------------------------------------------------------------------------
// Balance history + ledger
// ---------------------------------------------------------------------------

test("balance: running balance tracks invoices minus payments and TDS", () => {
  const { rows, closingPaise } = runningBalance([
    { type: "invoice", date: "2026-01-01", amountPaise: 295000, label: "INV-1" },
    { type: "payment", date: "2026-01-10", amountPaise: 270000, label: "RTGS" },
    { type: "tds_credit", date: "2026-01-10", amountPaise: 25000, label: "194J" },
  ]);
  assert.equal(rows[0].balancePaise, 295000);
  assert.equal(rows[2].balancePaise, 0);
  assert.equal(closingPaise, 0);
});

test("ledger: balanced debits equal credits for invoices", () => {
  const rows = buildBillingLedger({
    invoices: [{ date: "2026-01-01", number: "INV-1", totalPaise: 295000, taxablePaise: 250000, gstPaise: 45000, clientId: "c1", clientName: "Acme" }],
    payments: [],
  });
  const debit = rows.reduce((a, r) => a + r.debitPaise, 0);
  const credit = rows.reduce((a, r) => a + r.creditPaise, 0);
  assert.equal(debit, 295000);
  assert.equal(credit, 250000 + 45000);
});

// ---------------------------------------------------------------------------
// Queue + close
// ---------------------------------------------------------------------------

test("queue: aging drives priority and next action", () => {
  const q = queueItemStatus({ dueDate: "2026-01-01", today: "2026-02-15", totalPaise: 100000, openFlags: 0 });
  assert.equal(q.priority, "critical");
  assert.match(q.nextAction, /overdue/);
  const r = queueItemStatus({ dueDate: "2026-01-05", today: "2026-01-05", totalPaise: 100000, openFlags: 1 });
  assert.match(r.nextAction, /flagged/);
});

test("close: reconciles billed, collected, TDS and open", () => {
  const c = monthEndClose({
    period: "2026-01",
    invoices: [{ date: "2026-01-05", totalPaise: 295000 }],
    payments: [{ date: "2026-01-20", amountPaise: 270000, tdsDeductedPaise: 25000 }],
  });
  assert.equal(c.billedPaise, 295000);
  assert.equal(c.collectedPaise, 270000);
  assert.equal(c.tdsCreditPaise, 25000);
  assert.equal(c.openPaise, 0);
});

// ---------------------------------------------------------------------------
// v0.2 - discounts, global currencies/regimes, TDS rules, reconciliation
// ---------------------------------------------------------------------------

test("discount: tax is charged on the net (post-discount) taxable value", () => {
  const t = computeInvoiceTotals({
    supplierState: "27", placeOfSupply: "27", discountPaise: 100000,
    lineItems: [{ taxablePaise: 1000000, gstRate: 18 }],
  });
  assert.equal(t.grossTaxablePaise, 1000000);
  assert.equal(t.discountPaise, 100000);
  assert.equal(t.taxablePaise, 900000);
  assert.equal(t.gstPaise, 162000); // 18% of 900000, not of 1000000
  assert.equal(t.totalPaise, 1062000);
});

test("discount: allocated across lines with no rounding loss", () => {
  const shares = allocateProportional(100, [333, 333, 334]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  const t = computeInvoiceTotals({
    supplierState: "27", placeOfSupply: "27", discountPaise: 100,
    lineItems: [{ taxablePaise: 333, gstRate: 0 }, { taxablePaise: 333, gstRate: 0 }, { taxablePaise: 334, gstRate: 0 }],
  });
  assert.equal(t.taxablePaise, 900);
});

test("lineBasePaise: explicit value wins, else qty x rate", () => {
  assert.equal(lineBasePaise({ taxablePaise: 5000 }), 5000);
  assert.equal(lineBasePaise({ qty: 2.5, ratePaise: 100000 }), 250000);
});

test("currency: formats INR, USD, AED and zero-decimal JPY", () => {
  assert.equal(formatINR(12500050), "₹1,25,000.50");
  assert.equal(formatMoney(123456, "USD"), "$1,234.56");
  assert.equal(formatMoney(-123456, "USD"), "-$1,234.56");
  assert.equal(formatMoney(123456, "AED"), "AED 1,234.56");
  assert.equal(formatMoney(1234, "JPY"), "¥1,234");
  assert.equal(CURRENCIES.JPY.minor, 0);
});

test("currency: parses major units into minor units per currency", () => {
  assert.equal(toMinor("1,25,000.50", "INR"), 12500050);
  assert.equal(toMinor("1234.56", "USD"), 123456);
  assert.equal(toMinor("1000.5", "JPY"), 1001);
  assert.equal(toMinor("1000.4", "JPY"), 1000);
});

test("regimes: single-tax regimes produce one tax line", () => {
  const s = taxSplit(100000, 5, "AE_VAT");
  assert.equal(s.tax, 5000);
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].label, "VAT");
  const t = computeInvoiceTotals({ regimeId: "AE_VAT", lineItems: [{ taxablePaise: 100000, gstRate: 5 }] });
  assert.equal(t.currency, "AED");
  assert.equal(t.totalTaxPaise, 5000);
  assert.equal(t.totalPaise, 105000);
  assert.equal(t.cgstPaise, 0);
});

test("regimes: India still splits and only India has place of supply", () => {
  assert.equal(taxRegime("IN_GST").placeOfSupply, true);
  assert.equal(taxRegime("GB_VAT").placeOfSupply, false);
  const t = computeInvoiceTotals({ supplierState: "27", placeOfSupply: "29", lineItems: [{ taxablePaise: 100000, gstRate: 18 }] });
  assert.equal(t.igstPaise, 18000);
  assert.equal(t.taxLines.find((l) => l.label === "IGST").amountPaise, 18000);
});

test("tax ids: ABN checksum, UK, EU, UAE, GSTIN dispatch", () => {
  assert.equal(validateAbn("51824753556").valid, true); // known-valid ABN
  assert.equal(validateAbn("51824753557").valid, false); // bad checksum
  assert.equal(validateUkVat("GB123456789").valid, true);
  assert.equal(validateEuVat("DE123456789").valid, true);
  assert.equal(validateEuVat("12").valid, false);
  assert.equal(validateTrn("100123456700003").valid, true);
  assert.equal(validateTaxId("27AAPFU0939F1ZV", "IN_GST").valid, true);
  assert.equal(validateTaxId("bad", "AU_GST").valid, false);
});

test("tds: thresholds only apply when asked, and then correctly", () => {
  // Raw by default (backward compatible).
  assert.equal(computeTds({ taxablePaise: 1000000, section: "194J" }).tdsPaise, 100000);
  // 194C single payment below 30000 -> no TDS when thresholds on.
  assert.equal(computeTds({ taxablePaise: 2000000, section: "194C-co", applyThresholds: true }).tdsPaise, 0);
  // Above the single threshold -> deduct at 2%.
  assert.equal(computeTds({ taxablePaise: 5000000, section: "194C-co", applyThresholds: true }).tdsPaise, 100000);
  // 194J annual aggregate: 20000 paid already, this 15000 crosses 30000 -> whole amount taxed.
  const t = computeTds({ taxablePaise: 1500000, section: "194J", applyThresholds: true, yearToDatePaise: 2000000 });
  assert.equal(t.tdsPaise, 150000);
  // Still below the annual threshold -> zero.
  assert.equal(computeTds({ taxablePaise: 1500000, section: "194J", applyThresholds: true, yearToDatePaise: 0 }).tdsPaise, 0);
});

test("tds: no PAN applies the higher rate u/s 206AA", () => {
  const t = computeTds({ taxablePaise: 1000000, section: "194J", hasPan: false });
  assert.equal(t.tdsPaise, 200000);
  assert.equal(t.panApplied, true);
});

test("reconcile: aggregates instalments instead of looking at the last one", () => {
  const r = reconcileInvoice({
    invoice: { totalPaise: 100000, tdsPaise: 10000 },
    payments: [
      { amountPaise: 40000, tdsDeductedPaise: 10000 },
      { amountPaise: 50000, tdsDeductedPaise: 0 },
    ],
  });
  assert.equal(r.clean, true);
  assert.equal(r.settled, true);
  assert.equal(r.outstandingPaise, 0);
  assert.equal(r.paymentCount, 2);

  const short = reconcileInvoice({
    invoice: { totalPaise: 100000, tdsPaise: 10000 },
    payments: [{ amountPaise: 89999, tdsDeductedPaise: 10000 }],
  });
  assert.equal(short.clean, false);
  assert.equal(short.outstandingPaise, 1);
  assert.ok(short.flags.find((f) => f.code === "outstanding"));
});

test("credit notes: ledger still balances", () => {
  const rows = buildBillingLedger({
    invoices: [],
    payments: [],
    creditNotes: [{ date: "2026-09-02", number: "CN-1", totalPaise: 5000, taxablePaise: 4000, gstPaise: 1000, clientId: "c" }],
  });
  const debit = rows.reduce((a, r) => a + r.debitPaise, 0);
  const credit = rows.reduce((a, r) => a + r.creditPaise, 0);
  assert.equal(debit, 5000);
  assert.equal(credit, 5000);
});

test("validate: rejects empty, zero, bad rate and bad dates", () => {
  assert.equal(validateInvoice({ date: "2026-09-01", lineItems: [] }).valid, false);
  const zero = validateInvoice({ date: "2026-09-01", lineItems: [{ taxablePaise: 0, gstRate: 18 }] });
  assert.equal(zero.valid, false);
  const badRate = validateInvoice({ date: "2026-09-01", lineItems: [{ taxablePaise: 1000, gstRate: 17 }] });
  assert.ok(badRate.errors.find((e) => /not a standard/.test(e.message)));
  const badDate = validateInvoice({ date: "01-09-2026", lineItems: [{ taxablePaise: 1000, gstRate: 18 }] });
  assert.ok(badDate.errors.find((e) => e.field === "date"));
  const ok = validateInvoice({ date: "2026-09-01", dueDate: "2026-09-15", supplierState: "27", placeOfSupply: "29", lineItems: [{ taxablePaise: 1000, gstRate: 18 }] });
  assert.equal(ok.valid, true);
});

// ---------------------------------------------------------------------------
// Reconciliation assistant
// ---------------------------------------------------------------------------

const openInv = (over = {}) => ({ id: "i1", number: "INV-1", clientId: "c1", clientName: "Vertex", openPaise: 100000, ...over });

test("reconcile assistant: exact same-client match is high confidence", () => {
  const r = proposeMatches({ payments: [{ id: "p1", clientId: "c1", amountPaise: 90000, tdsDeductedPaise: 10000 }], invoices: [openInv()] });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].best.confidence, "high");
  assert.equal(r.proposals[0].creditPaise, 100000);
  assert.equal(r.proposals[0].best.gapPaise, 0);
  assert.match(r.proposals[0].best.reason, /Exact match/);
});

test("reconcile assistant: partial payment is matched but flagged as partial", () => {
  const r = proposeMatches({ payments: [{ id: "p1", clientId: "c1", amountPaise: 40000 }], invoices: [openInv()] });
  assert.equal(r.proposals[0].best.confidence, "medium");
  assert.match(r.proposals[0].best.reason, /partial payment/i);
  assert.equal(r.proposals[0].best.gapPaise, 60000);
});

test("reconcile assistant: cross-customer exact amount warns before applying", () => {
  const r = proposeMatches({ payments: [{ id: "p1", clientId: "cX", amountPaise: 100000 }], invoices: [openInv()] });
  assert.equal(r.proposals[0].best.confidence, "medium");
  assert.equal(r.proposals[0].best.sameClient, false);
  assert.match(r.proposals[0].best.reason, /different customer/);
});

test("reconcile assistant: no plausible candidate counts as unmatched", () => {
  const r = proposeMatches({ payments: [{ id: "p1", clientId: "cZ", amountPaise: 12345 }], invoices: [openInv()] });
  assert.equal(r.proposals.length, 0);
  assert.equal(r.unmatched, 1);
});

test("reconcile assistant: void or settled invoices are not candidates", () => {
  const r = proposeMatches({
    payments: [{ id: "p1", clientId: "c1", amountPaise: 100000 }],
    invoices: [openInv({ void: true }), openInv({ id: "i2", number: "INV-2", openPaise: 0 })],
  });
  assert.equal(r.openCount, 0);
  assert.equal(r.unmatched, 1);
});

// ---------------------------------------------------------------------------
// Production guards
// ---------------------------------------------------------------------------

test("taxProfileReady requires country, regime, currency and a valid id", () => {
  assert.equal(taxProfileReady({ country: "IN", regimeId: "IN_GST", currency: "INR", taxId: "27AAPFU0939F1ZV" }).ready, true);
  const bad = taxProfileReady({ country: "IN", regimeId: "IN_GST", currency: "INR", taxId: "nope" });
  assert.equal(bad.ready, false);
  assert.ok(bad.missing.includes("taxId"));
  assert.equal(taxProfileReady({ country: "IN", regimeId: "IN_GST", currency: "INR", taxId: "" }).ready, false);
  assert.equal(taxProfileReady({ country: "US", regimeId: "NONE", currency: "USD", taxId: "" }).ready, true);
});

test("closeBlockers flags unbalanced and pending journals plus mismatches", () => {
  const unbalanced = { id: "j1", source: "manual", approval: { status: "approved" }, lines: [{ account: "1000", debitPaise: 100, creditPaise: 0 }, { account: "4000", debitPaise: 0, creditPaise: 90 }] };
  const pending = { id: "j2", source: "manual", approval: { status: "pending" }, lines: [{ account: "1000", debitPaise: 100, creditPaise: 0 }, { account: "4000", debitPaise: 0, creditPaise: 100 }] };
  const inv = { id: "inv_m", number: "INV-M", status: "issued", totals: { totalPaise: 100000 } };
  const payment = { id: "p1", invoiceId: "inv_m", amountPaise: 120000, tdsDeductedPaise: 0 };
  const b = closeBlockers({ invoices: [inv], payments: [payment], journals: [unbalanced, pending], quarantine: [] });
  const keys = b.map((x) => x.key);
  assert.ok(keys.includes("journal_unbalanced"));
  assert.ok(keys.includes("journal_pending"));
  assert.ok(keys.includes("payment_mismatch"));
  assert.equal(closeBlockers({ invoices: [], payments: [], journals: [], quarantine: [] }).length, 0);
});

test("closeBlockers ignores normal outstanding invoices", () => {
  const inv = { id: "inv_o", number: "INV-O", status: "issued", totals: { totalPaise: 100000 } };
  const payment = { id: "p1", invoiceId: "inv_o", amountPaise: 40000, tdsDeductedPaise: 0 };
  assert.equal(closeBlockers({ invoices: [inv], payments: [payment], journals: [], quarantine: [] }).length, 0);
});

test("closeWarnings reports open receivables and unmatched bank lines", () => {
  const w = closeWarnings({ invoices: [{ id: "i", status: "overdue", totals: { totalPaise: 1 } }], bankTxns: [{ id: "t", status: "unmatched" }] });
  const keys = w.map((x) => x.key);
  assert.ok(keys.includes("open_receivable"));
  assert.ok(keys.includes("unmatched_bank"));
});

test("figureSource names the derivation for known figures", () => {
  const f = figureSource("outstanding");
  assert.ok(f && f.formula && Array.isArray(f.inputs));
  assert.equal(figureSource("does_not_exist"), null);
});
