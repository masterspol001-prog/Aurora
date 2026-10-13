// Fragmentation-Aware Billing Ledger - pure billing/accounting engine.
// All money is handled as integer paise. No floating point money.
// This module is DOM-free so it can be unit-tested in Node and imported by the UI.

// ---------------------------------------------------------------------------
// Fixed-point money
// ---------------------------------------------------------------------------

// Round num/den half-up. num may be negative; den must be positive integers.
export function roundHalfUp(num, den) {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new TypeError("roundHalfUp expects integers");
  }
  if (den <= 0) throw new RangeError("denominator must be positive");
  const sign = num < 0 ? -1 : 1;
  const n = Math.abs(num);
  return sign * Math.floor((2 * n + den) / (2 * den));
}

// Coerce a value that is ALREADY in paise (e.g. a `*Paise` field). Non-integers
// are rounded; no x100 conversion is applied.
export function asPaise(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError("invalid paise: " + value);
  return Math.round(n);
}

export function toRupees(paise) {
  return paise / 100;
}

// Percentage of a paise amount, half-up. pct may be fractional (e.g. 12.5).
export function pctOf(paise, pct) {
  const bps = Math.round(Number(pct) * 100); // basis points
  return roundHalfUp(paise * bps, 10000);
}

// Currency registry. Amounts are integer MINOR units (paise, cents, fils,
// pence). `minor` is the number of decimal digits (JPY = 0).
export const CURRENCIES = {
  INR: { code: "INR", symbol: "₹", locale: "en-IN", minor: 2, name: "Indian Rupee" },
  USD: { code: "USD", symbol: "$", locale: "en-US", minor: 2, name: "US Dollar" },
  EUR: { code: "EUR", symbol: "€", locale: "de-DE", minor: 2, name: "Euro" },
  GBP: { code: "GBP", symbol: "£", locale: "en-GB", minor: 2, name: "Pound Sterling" },
  AED: { code: "AED", symbol: "AED ", locale: "en-AE", minor: 2, name: "UAE Dirham" },
  AUD: { code: "AUD", symbol: "A$", locale: "en-AU", minor: 2, name: "Australian Dollar" },
  NZD: { code: "NZD", symbol: "NZ$", locale: "en-NZ", minor: 2, name: "New Zealand Dollar" },
  SGD: { code: "SGD", symbol: "S$", locale: "en-SG", minor: 2, name: "Singapore Dollar" },
  CAD: { code: "CAD", symbol: "C$", locale: "en-CA", minor: 2, name: "Canadian Dollar" },
  JPY: { code: "JPY", symbol: "¥", locale: "ja-JP", minor: 0, name: "Japanese Yen" },
};
export const currencyInfo = (code) => CURRENCIES[code] || CURRENCIES.INR;

// Format integer minor units in a given currency (locale-aware grouping).
export function formatMoney(minor, currency = "INR", { symbol = true } = {}) {
  const cfg = currencyInfo(currency);
  const value = minor / 10 ** cfg.minor;
  const sign = value < 0 ? "-" : "";
  const body = new Intl.NumberFormat(cfg.locale, {
    minimumFractionDigits: cfg.minor,
    maximumFractionDigits: cfg.minor,
  }).format(Math.abs(value));
  return sign + (symbol ? cfg.symbol : "") + body;
}

// Backwards-compatible INR formatter (Indian digit grouping via en-IN).
export function formatINR(paise, opts = {}) {
  return formatMoney(paise, "INR", opts);
}

// Parse an amount in a currency's major unit into integer minor units.
export function toMinor(value, currency = "INR") {
  const digits = currencyInfo(currency).minor;
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite money");
    return roundHalfUp(Math.round(value * 10 ** digits), 1);
  }
  const cleaned = String(value).replace(/[\s,₹$€£¥]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) throw new TypeError("invalid money: " + value);
  const sign = m[1] === "-" ? -1 : 1;
  const int = Number(m[2] === "" ? "0" : m[2]);
  const fracStr = m[3] || "";
  if (digits === 0) {
    const frac = fracStr ? roundHalfUp(Number(fracStr.slice(0, 1)), 10) : 0;
    return sign * (int + frac);
  }
  let frac;
  if (fracStr.length < digits) frac = Number(fracStr.padEnd(digits, "0"));
  else if (fracStr.length === digits) frac = Number(fracStr);
  else frac = roundHalfUp(Number(fracStr.slice(0, digits + 1)), 10);
  return sign * (int * 10 ** digits + frac);
}

// Parse a rupee amount (number or string, optional commas) into integer paise.
export function toPaise(value) {
  return toMinor(value, "INR");
}

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

const STATE_CODES = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const GST_STATES = Object.entries(STATE_CODES).map(([code, name]) => ({ code, name }));
export const stateName = (code) => STATE_CODES[code] || "Unknown";

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Validate an Indian GSTIN: format + official mod-36 checksum.
export function validateGSTIN(gstin) {
  if (typeof gstin !== "string") return { valid: false, reason: "Not a string" };
  const value = gstin.trim().toUpperCase();
  if (value.length !== 15) return { valid: false, reason: "Must be exactly 15 characters" };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)) {
    return { valid: false, reason: "Does not match the GSTIN pattern" };
  }
  const stateCode = value.slice(0, 2);
  if (!STATE_CODES[stateCode]) return { valid: false, reason: "Unknown state code " + stateCode };
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(value[i]);
    if (code < 0) return { valid: false, reason: "Invalid character" };
    const factor = i % 2 === 0 ? 1 : 2;
    const product = code * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  if (check !== value[14]) return { valid: false, reason: "Checksum mismatch" };
  return { valid: true, reason: "", state: stateCode, stateName: stateName(stateCode) };
}

// Split GST into IGST (inter-state) or CGST+SGST (intra-state).
// CGST is half rounded half-up; SGST takes the remainder so they always re-add.
export function gstSplit(taxablePaise, gstRatePercent, { interState = false } = {}) {
  const gst = pctOf(taxablePaise, gstRatePercent);
  if (interState) return { igst: gst, cgst: 0, sgst: 0, gst };
  const cgst = roundHalfUp(gst, 2);
  const sgst = gst - cgst;
  return { igst: 0, cgst, sgst, gst };
}

// --- Global tax-regime profiles -------------------------------------------
// Only the India profile performs a split (CGST/SGST/IGST). The others are a
// single tax line. ID validators are format/checksum checks, not registry
// lookups - they cannot prove a number is active or belongs to the party.

// Australian Business Number: 11 digits, official weighted checksum.
export function validateAbn(abn) {
  const v = String(abn || "").replace(/\s/g, "");
  if (!/^\d{11}$/.test(v)) return { valid: false, reason: "ABN must be 11 digits" };
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(v[i]);
    if (i === 0) d -= 1;
    sum += d * w[i];
  }
  return sum % 89 === 0 ? { valid: true, reason: "" } : { valid: false, reason: "ABN checksum failed" };
}
export function validateTrn(v) {
  const s = String(v || "").replace(/\s/g, "");
  return /^\d{15}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "UAE TRN must be 15 digits" };
}
export function validateUkVat(v) {
  const s = String(v || "").replace(/\s/g, "").toUpperCase().replace(/^GB/, "");
  return /^\d{9}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "UK VAT number must be 9 digits (GB prefix optional)" };
}
export function validateEuVat(v) {
  const s = String(v || "").replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{8,12}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "EU VAT ID must be a 2-letter country code + 8-12 characters" };
}
export function validateNzGst(v) {
  const s = String(v || "").replace(/\s/g, "");
  return /^\d{8,9}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "NZ GST number must be 8-9 digits" };
}
export function validateSgGst(v) {
  const s = String(v || "").replace(/\s/g, "").toUpperCase();
  return /^[0-9A-Z]{9}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "Singapore GST reg. no. must be 9 characters" };
}
export function validateCaGst(v) {
  const s = String(v || "").replace(/\s/g, "").toUpperCase();
  return /^\d{9}(RT\d{4})?$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "Canadian GST/HST number must be 9 digits (+ optional RT0001)" };
}
export function validateUsId(v) {
  const s = String(v || "").replace(/[\s-]/g, "");
  return /^\d{9}$/.test(s) ? { valid: true, reason: "" } : { valid: false, reason: "US EIN must be 9 digits" };
}

export const TAX_REGIMES = {
  IN_GST: { id: "IN_GST", label: "India - GST", currency: "INR", split: "gst", rates: [0, 5, 12, 18, 28], idLabel: "GSTIN", placeOfSupply: true, validateId: validateGSTIN },
  AE_VAT: { id: "AE_VAT", label: "United Arab Emirates - VAT", currency: "AED", split: "single", taxName: "VAT", rates: [0, 5], idLabel: "TRN", placeOfSupply: false, validateId: validateTrn },
  GB_VAT: { id: "GB_VAT", label: "United Kingdom - VAT", currency: "GBP", split: "single", taxName: "VAT", rates: [0, 5, 20], idLabel: "VAT number", placeOfSupply: false, validateId: validateUkVat },
  EU_VAT: { id: "EU_VAT", label: "European Union - VAT", currency: "EUR", split: "single", taxName: "VAT", rates: [0, 7, 19, 21], idLabel: "VAT ID", placeOfSupply: false, validateId: validateEuVat },
  AU_GST: { id: "AU_GST", label: "Australia - GST", currency: "AUD", split: "single", taxName: "GST", rates: [0, 10], idLabel: "ABN", placeOfSupply: false, validateId: validateAbn },
  NZ_GST: { id: "NZ_GST", label: "New Zealand - GST", currency: "NZD", split: "single", taxName: "GST", rates: [0, 15], idLabel: "GST number", placeOfSupply: false, validateId: validateNzGst },
  SG_GST: { id: "SG_GST", label: "Singapore - GST", currency: "SGD", split: "single", taxName: "GST", rates: [0, 9], idLabel: "GST reg. no.", placeOfSupply: false, validateId: validateSgGst },
  CA_GST: { id: "CA_GST", label: "Canada - GST/HST", currency: "CAD", split: "single", taxName: "GST/HST", rates: [0, 5, 13, 15], idLabel: "GST/HST number", placeOfSupply: false, validateId: validateCaGst },
  US_SALES: { id: "US_SALES", label: "United States - sales tax", currency: "USD", split: "single", taxName: "Sales tax", rates: [0, 6, 7, 8.25], idLabel: "EIN / state ID", placeOfSupply: false, validateId: validateUsId },
  NONE: { id: "NONE", label: "No indirect tax", currency: "USD", split: "single", taxName: "Tax", rates: [0], idLabel: "Tax ID", placeOfSupply: false, validateId: () => ({ valid: true, reason: "" }) },
};
export const taxRegime = (id) => TAX_REGIMES[id] || TAX_REGIMES.IN_GST;
export function validateTaxId(id, regimeId = "IN_GST") {
  const r = taxRegime(regimeId);
  return (r.validateId || (() => ({ valid: true, reason: "" })))(id);
}

// Compute tax for one line under a regime. India splits; others are single.
export function taxSplit(taxableMinor, ratePercent, regimeId = "IN_GST", { interState = false } = {}) {
  const r = taxRegime(regimeId);
  if (r.split === "gst") {
    const s = gstSplit(taxableMinor, ratePercent, { interState });
    const lines = [];
    if (ratePercent) {
      if (interState) lines.push({ label: "IGST", rate: ratePercent, amountPaise: s.igst });
      else {
        lines.push({ label: "CGST", rate: ratePercent / 2, amountPaise: s.cgst });
        lines.push({ label: "SGST", rate: ratePercent / 2, amountPaise: s.sgst });
      }
    }
    return { igst: s.igst, cgst: s.cgst, sgst: s.sgst, tax: s.gst, gst: s.gst, lines };
  }
  const tax = pctOf(taxableMinor, ratePercent);
  const lines = ratePercent ? [{ label: r.taxName, rate: ratePercent, amountPaise: tax }] : [];
  return { igst: 0, cgst: 0, sgst: 0, tax, gst: tax, lines };
}

// The taxable base of a line (explicit taxablePaise wins, else qty x rate).
export function lineBasePaise(li) {
  if (li.taxablePaise !== undefined) return asPaise(li.taxablePaise);
  const qtyMilli = Math.round(Number(li.qty || 0) * 1000);
  return roundHalfUp(qtyMilli * asPaise(li.ratePaise || 0), 1000);
}

// Split an integer total across weights using largest-remainder, so the shares
// always sum exactly to the total.
export function allocateProportional(totalMinor, weights) {
  const n = weights.length;
  const out = new Array(n).fill(0);
  const total = asPaise(totalMinor);
  if (!n || total === 0) return out;
  const sumW = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sumW <= 0) return out;
  const raw = weights.map((w) => (total * Math.max(0, w)) / sumW);
  let allocated = 0;
  const fracs = [];
  for (let i = 0; i < n; i++) {
    const f = Math.floor(raw[i]);
    out[i] = f;
    allocated += f;
    fracs.push([raw[i] - f, i]);
  }
  fracs.sort((a, b) => b[0] - a[0]);
  let remainder = total - allocated;
  for (let k = 0; k < n && remainder > 0; k++) { out[fracs[k][1]] += 1; remainder--; }
  for (let i = 0; i < n; i++) {
    const cap = Math.max(0, weights[i]);
    if (out[i] > cap) out[i] = cap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Invoice totals
// ---------------------------------------------------------------------------

// lineItem: { description, hsnSac, qty, ratePaise, taxablePaise?, gstRate }
// Discounts are applied to the taxable value BEFORE tax, allocated across lines
// proportionally, so tax is charged on the net amount.
export function computeInvoiceTotals(invoice, options = {}) {
  const regime = taxRegime(options.regimeId || invoice.regimeId || "IN_GST");
  const currency = options.currency || invoice.currency || regime.currency;
  const supplierState = invoice.supplierState || "";
  const placeOfSupply = invoice.placeOfSupply || supplierState;
  const interState = regime.split === "gst"
    && (!!invoice.interState || (!!placeOfSupply && !!supplierState && placeOfSupply !== supplierState));

  const rawLines = (invoice.lineItems || []).map((li) => ({ ...li, basePaise: lineBasePaise(li) }));
  const grossTaxable = rawLines.reduce((a, l) => a + l.basePaise, 0);
  const discount = Math.min(asPaise(invoice.discountPaise || 0), Math.max(0, grossTaxable));
  const shares = allocateProportional(discount, rawLines.map((l) => l.basePaise));

  const taxLines = [];
  let taxable = 0, gst = 0, cgst = 0, sgst = 0, igst = 0;
  const lines = rawLines.map((l, i) => {
    const netBase = l.basePaise - shares[i];
    const split = taxSplit(netBase, l.gstRate || 0, regime.id, { interState });
    taxable += netBase; gst += split.tax; cgst += split.cgst; sgst += split.sgst; igst += split.igst;
    for (const tl of split.lines) {
      const found = taxLines.find((x) => x.label === tl.label && x.rate === tl.rate);
      if (found) found.amountPaise += tl.amountPaise;
      else taxLines.push({ ...tl });
    }
    return { ...l, taxablePaise: netBase, discountPaise: shares[i], gstPaise: split.tax, ...split };
  });

  const total = taxable + gst;
  const tds = invoice.tdsSection
    ? computeTds({
        taxablePaise: taxable,
        section: invoice.tdsSection,
        hasPan: invoice.hasPan !== false,
        yearToDatePaise: invoice.yearToDatePaise || 0,
        applyThresholds: !!invoice.applyTdsThresholds,
      })
    : { tdsPaise: 0, rate: 0 };
  const payable = total - tds.tdsPaise;

  return {
    regimeId: regime.id,
    currency,
    lines,
    taxLines,
    taxablePaise: taxable,
    grossTaxablePaise: grossTaxable,
    discountPaise: discount,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    gstPaise: gst,
    totalTaxPaise: gst,
    totalPaise: total,
    tdsPaise: tds.tdsPaise,
    tdsRate: tds.rate,
    tdsReason: tds.reason,
    payablePaise: payable,
    interState,
  };
}

export const fmt = (p) => formatINR(p);

// ---------------------------------------------------------------------------
// TDS (India) - progressive capture
// ---------------------------------------------------------------------------

// Thresholds are in minor units (paise). They are only applied when
// `applyThresholds` is true and a year-to-date figure is supplied - otherwise
// the raw section rate is used, which keeps per-invoice maths predictable.
export const TDS_SECTIONS = [
  { code: "194J", label: "194J - Professional / technical services", rate: 10, base: "taxable", thresholdAnnual: 3000000, thresholdNote: "₹30,000 annual aggregate" },
  { code: "194C-ind", label: "194C - Contractor (individual / HUF)", rate: 1, base: "taxable", thresholdSingle: 3000000, thresholdAnnual: 10000000, thresholdNote: "₹30,000 single / ₹1,00,000 annual" },
  { code: "194C-co", label: "194C - Contractor (company / firm)", rate: 2, base: "taxable", thresholdSingle: 3000000, thresholdAnnual: 10000000, thresholdNote: "₹30,000 single / ₹1,00,000 annual" },
  { code: "194H", label: "194H - Commission / brokerage", rate: 5, base: "taxable", thresholdAnnual: 1500000, thresholdNote: "₹15,000 annual aggregate" },
  { code: "194I", label: "194I - Rent of property", rate: 10, base: "taxable", thresholdAnnual: 24000000, thresholdNote: "₹2,40,000 annual aggregate" },
  { code: "194Q", label: "194Q - Purchase of goods", rate: 0.1, base: "taxable", thresholdAnnual: 50000000, thresholdNote: "₹50,00,000 annual aggregate" },
];

export const tdsInfo = (code) => TDS_SECTIONS.find((s) => s.code === code) || null;

// Progressive disclosure: which extra fields a section forces the user to capture.
export function tdsRequirements(section) {
  switch (section) {
    case "194J":
      return [
        { key: "nature", label: "Nature of professional / technical service", type: "text" },
        { key: "hours", label: "Billable hours in this period", type: "number" },
        { key: "periodFrom", label: "Service period from", type: "date" },
        { key: "periodTo", label: "Service period to", type: "date" },
      ];
    case "194C-ind":
    case "194C-co":
      return [
        { key: "contractRef", label: "Contract / PO reference", type: "text" },
        { key: "workDate", label: "Work completion date", type: "date" },
      ];
    case "194H":
      return [
        { key: "commissionBase", label: "Commission base description", type: "text" },
        { key: "agreementRef", label: "Agreement reference", type: "text" },
      ];
    case "194I":
      return [
        { key: "property", label: "Property address", type: "text" },
        { key: "periodFrom", label: "Rent period from", type: "date" },
        { key: "periodTo", label: "Rent period to", type: "date" },
      ];
    default:
      return [];
  }
}

// Validate that all progressive-disclosure fields were captured.
export function validateTdsCapture(invoice) {
  if (!invoice.tdsSection) return { complete: true, missing: [] };
  const reqs = tdsRequirements(invoice.tdsSection);
  const capture = invoice.tdsCapture || {};
  const missing = reqs.filter((r) => capture[r.key] === undefined || capture[r.key] === "").map((r) => r.key);
  return { complete: missing.length === 0, missing, required: reqs };
}

// TDS is computed on taxable value (excluding GST), per spec.
// Optional `hasPan:false` applies the higher rate u/s 206AA; optional
// `applyThresholds` + `yearToDatePaise` applies the section's annual/single
// threshold. Once the threshold is crossed, TDS applies to the whole amount.
export function computeTds({ taxablePaise, section, rate, hasPan = true, yearToDatePaise = 0, applyThresholds = false }) {
  const info = tdsInfo(section);
  if (!info && rate === undefined) return { tdsPaise: 0, rate: 0, section, reason: "no section" };
  const amount = asPaise(taxablePaise);
  let r = rate !== undefined ? rate : info.rate;
  let reason = "computed on taxable value (excluding GST)";
  let thresholdApplied = false;

  if (applyThresholds && info) {
    const ytd = asPaise(yearToDatePaise);
    const annualExceeded = info.thresholdAnnual != null && ytd + amount > info.thresholdAnnual;
    const singleExceeded = info.thresholdSingle != null && amount > info.thresholdSingle;
    if (!annualExceeded && !singleExceeded) {
      const why = info.thresholdAnnual != null && info.thresholdSingle != null
        ? `below single (${info.thresholdNote}) and annual thresholds`
        : `below annual threshold (${info.thresholdNote})`;
      return { tdsPaise: 0, rate: r, section, reason: why, thresholdApplied: true, panApplied: false };
    }
    thresholdApplied = true;
  }

  let panApplied = false;
  if (!hasPan) { r = Math.max(r, 20); panApplied = true; reason = "no PAN - higher rate u/s 206AA"; }

  return { tdsPaise: pctOf(amount, r), rate: r, section, reason, thresholdApplied, panApplied };
}

// ---------------------------------------------------------------------------
// Fragmentation recommendation engine
// ---------------------------------------------------------------------------

// Classify a count of invoices raised in the current billing period.
export function fragmentationState(invoiceCount) {
  if (invoiceCount <= 1) return "single_invoice_optimized";
  if (invoiceCount <= 2) return "consolidated_clean";
  if (invoiceCount <= 4) return "proactive_consolidation";
  return "urgent_consolidation";
}

// Deterministic 0-100 score: more fragments + smaller average = worse.
export function fragmentationScore({ invoiceCount = 0, avgInvoicePaise = 0 }) {
  const countScore = Math.min(60, invoiceCount * 12);
  // Small invoices hurt more; >= ₹50,000 each is treated as material.
  const sizeFactor = avgInvoicePaise >= 5_000_000 ? 0 : avgInvoicePaise <= 0 ? 1 : 1 - avgInvoicePaise / 5_000_000;
  const sizeScore = Math.round(Math.max(0, Math.min(1, sizeFactor)) * 40);
  return Math.min(100, countScore + sizeScore);
}

const RECOMMENDATION_BY_STATE = {
  single_invoice_optimized: { level: "info", action: "keep" },
  consolidated_clean: { level: "good", action: "keep" },
  proactive_consolidation: { level: "warn", action: "consolidate" },
  urgent_consolidation: { level: "urgent", action: "consolidate" },
};

// Role changes the wording/framing of the same underlying recommendation.
// owner -> business consequence; bookkeeper -> workflow consequence.
export function recommendFragmentation({ invoiceCount, avgInvoicePaise = 0, role = "owner", clientName = "this client" }) {
  const state = fragmentationState(invoiceCount);
  const base = RECOMMENDATION_BY_STATE[state];
  const score = fragmentationScore({ invoiceCount, avgInvoicePaise });

  const explanations = {
    single_invoice_optimized: `${clientName} has a single invoice this period. Nothing to consolidate and revenue recognition is clean.`,
    consolidated_clean: `${clientName} has ${invoiceCount} invoices this period. This is still a normal pattern, but keep an eye on it.`,
    proactive_consolidation: `${clientName} has ${invoiceCount} invoices this period. Consolidating now keeps the billing relationship simple and avoids a reconciliation backlog.`,
    urgent_consolidation: `${clientName} has ${invoiceCount} invoices this period. This is high fragmentation; consolidate before the next cycle or the ledger becomes hard to audit.`,
  };

  const byRole = {
    owner: {
      urgent_consolidation: `Recommend immediate consolidation with ${clientName}: ${invoiceCount} invoices this period creates an audit and collections problem.`,
      proactive_consolidation: `Recommend proactive consolidation with ${clientName}: ${invoiceCount} invoices this period. Do it now, before month-end.`,
      consolidated_clean: `Defer consolidation with ${clientName}. ${invoiceCount} invoices is acceptable at this volume.`,
      single_invoice_optimized: `No consolidation needed with ${clientName}.`,
      keep: `No consolidation needed with ${clientName}.`,
    },
    bookkeeper: {
      urgent_consolidation: `Flag to owner and consolidate ${invoiceCount} invoices for ${clientName} now; reconciliation is already at risk.`,
      proactive_consolidation: `Add ${clientName} to the consolidation queue this week (${invoiceCount} invoices pending).`,
      consolidated_clean: `No action required for ${clientName}; monitor next cycle.`,
      single_invoice_optimized: `Nothing queued for ${clientName}.`,
    },
    accountant: {
      urgent_consolidation: `Escalate to the assigned partner: ${clientName} has ${invoiceCount} invoices and needs a consolidation decision before filing.`,
      proactive_consolidation: `Raise a consolidation task for ${clientName} (${invoiceCount} invoices) and confirm treatment with the client.`,
      consolidated_clean: `Log and move on for ${clientName}.`,
      single_invoice_optimized: `No exception for ${clientName}.`,
    },
  };

  const roleMap = byRole[role] || byRole.owner;
  return {
    state,
    level: base.level,
    action: base.action,
    score,
    invoiceCount,
    role,
    title:
      state === "urgent_consolidation" ? "Urgent: consolidate now"
      : state === "proactive_consolidation" ? "Proactive consolidation recommended"
      : state === "consolidated_clean" ? "Billing pattern acceptable"
      : "Single invoice: optimized",
    reason: explanations[state],
    roleAdvice: roleMap[state] || roleMap.keep,
  };
}

// ---------------------------------------------------------------------------
// Invoice -> payment asymmetry detection
// ---------------------------------------------------------------------------

// invoice: { number, client, totalPaise, tdsPaise }
// payment: { amountPaise, tdsDeductedPaise, method, date, reference }
export function detectPaymentAsymmetry({ invoice, payment, currency = "INR" }) {
  const money = (v) => formatMoney(v, currency);
  const total = asPaise(invoice.totalPaise || 0);
  const expectedTds = asPaise(invoice.tdsPaise || 0);
  const expectedBank = total - expectedTds;
  const receivedBank = asPaise(payment.amountPaise || 0);
  const deductedTds = asPaise(payment.tdsDeductedPaise || 0);
  const diff = expectedBank - receivedBank;

  const flags = [];
  if (diff > 0) flags.push({ code: "short_payment", amountPaise: diff, message: `Bank credit is ${money(diff)} short of the expected ${money(expectedBank)}.` });
  if (diff < 0) flags.push({ code: "over_payment", amountPaise: -diff, message: `Bank credit exceeds the expected ${money(expectedBank)} by ${money(-diff)}.` });
  if (expectedTds !== deductedTds) {
    flags.push({
      code: "tds_mismatch",
      amountPaise: deductedTds - expectedTds,
      message: `TDS deducted (${money(deductedTds)}) does not match the invoice TDS (${money(expectedTds)}).`,
    });
  }
  // Bank + TDS credit should reconstruct the invoice total.
  const reconstructed = receivedBank + deductedTds;
  const reconstructionGap = total - reconstructed;
  if (!flags.length && reconstructionGap !== 0) {
    flags.push({ code: "reconstruction_gap", amountPaise: reconstructionGap, message: `Payment + TDS credit (${money(reconstructed)}) does not reconstruct the invoice total (${money(total)}).` });
  }

  return {
    clean: flags.length === 0,
    expectedBankPaise: expectedBank,
    receivedBankPaise: receivedBank,
    expectedTdsPaise: expectedTds,
    deductedTdsPaise: deductedTds,
    differencePaise: diff,
    flags,
  };
}

// Aggregate reconciliation across ALL payments for an invoice. This is the
// correct check when a client pays in instalments.
export function reconcileInvoice({ invoice, payments = [], currency = "INR" }) {
  const money = (v) => formatMoney(v, currency);
  const total = asPaise(invoice.totalPaise || 0);
  const expectedTds = asPaise(invoice.tdsPaise || 0);
  const expectedBank = total - expectedTds;
  const receivedBank = payments.reduce((a, p) => a + asPaise(p.amountPaise || 0), 0);
  const deductedTds = payments.reduce((a, p) => a + asPaise(p.tdsDeductedPaise || 0), 0);
  const outstanding = total - receivedBank - deductedTds;

  const flags = [];
  if (receivedBank > expectedBank) flags.push({ code: "over_payment", amountPaise: receivedBank - expectedBank, message: `Bank credits (${money(receivedBank)}) exceed the expected ${money(expectedBank)}.` });
  if (deductedTds !== expectedTds) flags.push({ code: "tds_mismatch", amountPaise: deductedTds - expectedTds, message: `TDS deducted (${money(deductedTds)}) does not match the invoice TDS (${money(expectedTds)}).` });
  if (outstanding > 0) flags.push({ code: "outstanding", amountPaise: outstanding, message: `${money(outstanding)} is still outstanding.` });
  if (outstanding < 0) flags.push({ code: "over_settled", amountPaise: -outstanding, message: `Invoice is over-settled by ${money(-outstanding)}.` });

  return {
    clean: flags.length === 0,
    settled: outstanding === 0,
    totalPaise: total,
    expectedBankPaise: expectedBank,
    receivedBankPaise: receivedBank,
    expectedTdsPaise: expectedTds,
    deductedTdsPaise: deductedTds,
    outstandingPaise: outstanding,
    paymentCount: payments.length,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation assistant
// ---------------------------------------------------------------------------

// Propose matches between recorded payments and open invoices, with a plain
// language reason for each. Invoices must carry `openPaise` (the caller computes
// it) and client identity; payments carry `amountPaise` + optional
// `tdsDeductedPaise`. Pure: nothing is mutated.
export function proposeMatches({ payments = [], invoices = [], currency = "INR" } = {}) {
  const money = (v) => formatMoney(v, currency);
  const open = invoices.filter((i) => !i.void && asPaise(i.openPaise || 0) > 0);
  const proposals = [];
  let unmatched = 0;

  for (const pay of payments) {
    const bank = asPaise(pay.amountPaise || 0);
    const tds = asPaise(pay.tdsDeductedPaise || 0);
    const credit = bank + tds;
    const scored = [];
    for (const inv of open) {
      const invOpen = asPaise(inv.openPaise || 0);
      const sameClient = !!(pay.clientId && inv.clientId && pay.clientId === inv.clientId);
      const gap = invOpen - credit;
      const exact = gap === 0 && credit > 0;
      let score = 0;
      if (sameClient && exact) score = 100;
      else if (sameClient) score = 60 - Math.min(50, Math.round((Math.abs(gap) / Math.max(invOpen, 1)) * 50));
      else if (exact) score = 55;
      if (score <= 0) continue;
      const confidence = score >= 90 ? "high" : score >= 30 ? "medium" : "low";
      let reason;
      if (sameClient && exact) reason = `${inv.clientName} paid ${money(credit)}; invoice ${inv.number} has exactly ${money(invOpen)} open. Exact match.`;
      else if (sameClient) reason = `${inv.clientName} payment of ${money(credit)} against ${money(invOpen)} open on ${inv.number} (difference ${money(Math.abs(gap))}; ${gap > 0 ? "partial payment" : "overpayment"}).`;
      else reason = `Amount matches ${inv.clientName}'s invoice ${inv.number} (${money(invOpen)} open), but the payment is recorded for a different customer. Confirm before applying.`;
      scored.push({ invoiceId: inv.id, invoiceNumber: inv.number, clientId: inv.clientId, clientName: inv.clientName, openPaise: invOpen, gapPaise: gap, sameClient, score, confidence, reason });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) { unmatched += 1; continue; }
    proposals.push({
      paymentId: pay.id, date: pay.date, clientId: pay.clientId || "", clientName: pay.clientName || "",
      reference: pay.reference || "", bankPaise: bank, tdsPaise: tds, creditPaise: credit,
      best: scored[0], alternates: scored.slice(1, 3),
    });
  }
  proposals.sort((a, b) => b.best.score - a.best.score);
  return { proposals, unmatched, openCount: open.length };
}

// Structural validation for an invoice before it is issued.
export function validateInvoice(invoice, options = {}) {
  const regime = taxRegime(options.regimeId || invoice.regimeId || "IN_GST");
  const errors = [];
  const push = (field, message) => errors.push({ field, message });
  const lines = invoice.lineItems || [];

  if (!lines.length) push("lineItems", "Add at least one line item.");
  lines.forEach((li, i) => {
    const base = lineBasePaise(li);
    if (!Number.isFinite(base)) push(`lineItems[${i}].amount`, "Line amount is not a valid number.");
    else if (base < 0 && li.allowNegative !== true) push(`lineItems[${i}].amount`, "Line amount is negative; mark it as an adjustment line.");
    const rate = Number(li.gstRate ?? 0);
    if (regime.rates && !regime.rates.includes(rate)) push(`lineItems[${i}].taxRate`, `Tax rate ${rate}% is not a standard ${regime.label} rate.`);
  });

  const gross = lines.reduce((a, li) => a + Math.max(0, lineBasePaise(li)), 0);
  const discount = asPaise(invoice.discountPaise || 0);
  if (lines.length && gross - discount <= 0) push("lineItems", "Invoice total is zero or negative.");

  if (!invoice.date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.date)) push("date", "Invoice date is missing or malformed.");
  if (invoice.dueDate && invoice.date && invoice.dueDate < invoice.date) push("dueDate", "Due date is before the invoice date.");
  if (regime.placeOfSupply && invoice.placeOfSupply && invoice.supplierState && invoice.placeOfSupply === invoice.supplierState && invoice.interState) {
    push("interState", "Marked inter-state, but place of supply equals the supplier state.");
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Coverage-aware accrual (research / fixed-fee commitments)
// ---------------------------------------------------------------------------

// A fixed-fee commitment is recognized only up to the percentage of milestones
// that have documentary evidence (timesheets, milestone acceptance, expenses).
// commit: { name, fixedFeePaise, coverageThreshold = 0.8,
//           milestones: [{ label, pct, evidence }] }
export function coverageAwareAccrual(commitment) {
  const fee = asPaise(commitment.fixedFeePaise || 0);
  const threshold = commitment.coverageThreshold ?? 0.8;
  const milestones = commitment.milestones || [];
  const evidencedPct = milestones.filter((m) => m.evidence).reduce((a, m) => a + (Number(m.pct) || 0), 0);
  const pct = Math.max(0, Math.min(1, evidencedPct));
  const recognizablePaise = pctOf(fee, pct * 100);
  const deferredPaise = fee - recognizablePaise;
  const covered = pct >= threshold;

  let note;
  if (!milestones.length) note = "No milestones defined; revenue is fully deferred until evidence is supplied.";
  else if (covered) note = `${Math.round(pct * 100)}% of milestones are evidenced (threshold ${Math.round(threshold * 100)}%). Recognize ${formatINR(recognizablePaise)}; defer ${formatINR(deferredPaise)}.`;
  else note = `Only ${Math.round(pct * 100)}% of milestones are evidenced, below the ${Math.round(threshold * 100)}% threshold. Defer ${formatINR(deferredPaise)} until evidence arrives.`;

  return {
    fixedFeePaise: fee,
    evidencedPct: pct,
    recognizablePaise,
    deferredPaise,
    covered,
    note,
    unevidenced: milestones.filter((m) => !m.evidence).map((m) => m.label),
  };
}

// ---------------------------------------------------------------------------
// Running balance history
// ---------------------------------------------------------------------------

// entries: [{ type: "invoice"|"payment"|"tds_credit"|"adjustment", date, amountPaise, label }]
// Invoices increase the outstanding balance; everything else reduces it.
export function runningBalance(entries) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = 0;
  const rows = sorted.map((e) => {
    const signed = e.type === "invoice" ? Math.abs(e.amountPaise) : -Math.abs(e.amountPaise);
    balance += signed;
    return { ...e, signedPaise: signed, balancePaise: balance };
  });
  return { rows, closingPaise: balance };
}

// ---------------------------------------------------------------------------
// Billing ledger (append-only journal derived from events)
// ---------------------------------------------------------------------------

// Build a double-entry-ish ledger from invoices, payments and credit notes.
export function buildBillingLedger({ invoices = [], payments = [], creditNotes = [], clientId, taxAccount = "GST Output" } = {}) {
  const rows = [];
  for (const inv of invoices) {
    if (clientId && inv.clientId !== clientId) continue;
    rows.push({
      date: inv.date,
      ref: inv.number,
      type: "invoice",
      account: "Accounts Receivable",
      debitPaise: inv.totalPaise,
      creditPaise: 0,
      note: inv.clientName || inv.client || "",
    });
    rows.push({
      date: inv.date,
      ref: inv.number,
      type: "revenue",
      account: "Service Revenue",
      debitPaise: 0,
      creditPaise: inv.taxablePaise ?? inv.totalPaise,
      note: inv.description || "",
    });
    const gst = inv.gstPaise ?? (inv.totalPaise - (inv.taxablePaise ?? inv.totalPaise));
    if (gst) {
      rows.push({
        date: inv.date, ref: inv.number, type: "tax", account: taxAccount, debitPaise: 0, creditPaise: gst, note: "Indirect tax",
      });
    }
  }
  for (const p of payments) {
    if (clientId && p.clientId !== clientId) continue;
    rows.push({
      date: p.date, ref: p.reference || p.invoiceNumber || "", type: "payment",
      account: "Bank", debitPaise: p.amountPaise, creditPaise: 0, note: p.method || "",
    });
    rows.push({
      date: p.date, ref: p.reference || p.invoiceNumber || "", type: "receivable",
      account: "Accounts Receivable", debitPaise: 0, creditPaise: p.amountPaise, note: "Settlement",
    });
    if (p.tdsDeductedPaise) {
      rows.push({
        date: p.date, ref: p.reference || p.invoiceNumber || "", type: "tds",
        account: "TDS Receivable", debitPaise: p.tdsDeductedPaise, creditPaise: 0, note: "TDS credit",
      });
      rows.push({
        date: p.date, ref: p.reference || p.invoiceNumber || "", type: "receivable",
        account: "Accounts Receivable", debitPaise: 0, creditPaise: p.tdsDeductedPaise, note: "TDS settled",
      });
    }
  }
  for (const cn of creditNotes) {
    if (clientId && cn.clientId !== clientId) continue;
    rows.push({
      date: cn.date, ref: cn.number, type: "credit_note", account: "Service Revenue",
      debitPaise: cn.taxablePaise ?? cn.totalPaise, creditPaise: 0, note: cn.clientName || "Credit note",
    });
    const gst = cn.gstPaise ?? 0;
    if (gst) {
      rows.push({ date: cn.date, ref: cn.number, type: "credit_note", account: taxAccount, debitPaise: gst, creditPaise: 0, note: "Tax reversal" });
    }
    rows.push({
      date: cn.date, ref: cn.number, type: "credit_note", account: "Accounts Receivable",
      debitPaise: 0, creditPaise: cn.totalPaise, note: "Credit note",
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Preview queue priority / aging / next action
// ---------------------------------------------------------------------------

export function queueItemStatus({ dueDate, today = new Date().toISOString().slice(0, 10), totalPaise = 0, openFlags = 0 }) {
  const days = Math.round((new Date(today) - new Date(dueDate)) / 86400000);
  let priority;
  if (days > 30) priority = "critical";
  else if (days > 7) priority = "high";
  else if (days >= 0) priority = "medium";
  else priority = "low";

  let nextAction;
  if (openFlags > 0) nextAction = "Resolve flagged exception before sending";
  else if (days > 30) nextAction = "Chase payment: overdue by " + days + " days";
  else if (days >= 0) nextAction = "Send reminder (due today)";
  else nextAction = "Scheduled: due in " + Math.abs(days) + " days";

  return { agingDays: days, priority, nextAction, materialPaise: totalPaise };
}

// ---------------------------------------------------------------------------
// Month-end close
// ---------------------------------------------------------------------------

export function monthEndClose({ invoices = [], payments = [], period, role = "owner", currency = "INR" }) {
  const money = (v) => formatMoney(v, currency);
  const inPeriod = (d) => !period || (d && d.slice(0, 7) === period);
  const pInvoices = invoices.filter((i) => inPeriod(i.date));
  const pPayments = payments.filter((p) => inPeriod(p.date));
  const billed = pInvoices.reduce((a, i) => a + (i.totalPaise || 0), 0);
  const collected = pPayments.reduce((a, p) => a + (p.amountPaise || 0), 0);
  const tdsCredit = pPayments.reduce((a, p) => a + (p.tdsDeductedPaise || 0), 0);
  const open = billed - collected - tdsCredit;
  const steps = [
    { key: "billed", label: "Invoices raised", done: pInvoices.length > 0, detail: `${pInvoices.length} invoices, ${money(billed)}` },
    { key: "collected", label: "Payments reconciled", done: pPayments.length > 0, detail: `${pPayments.length} receipts, ${money(collected)} + ${money(tdsCredit)} withheld` },
    { key: "open", label: "Open receivable", done: open <= 0, detail: money(Math.max(0, open)) },
    { key: "export", label: "Ledger exported", done: false, detail: role === "accountant" ? "Filing package" : "CSV / accounting-ready" },
  ];
  return { period, currency, billedPaise: billed, collectedPaise: collected, tdsCreditPaise: tdsCredit, openPaise: open, steps };
}

// ---------------------------------------------------------------------------
// Regulatory caveats - always shown, never hidden
// ---------------------------------------------------------------------------

export const REGULATORY_CAVEATS = [
  "Tax treatment depends on facts this tool does not fully capture: place of supply, reverse charge, exemptions, zero-rating, cross-border rules and local registration thresholds.",
  "India TDS is computed on the taxable value excluding GST. Some sections can require TDS on the gross amount including GST, and thresholds are annual aggregates - confirm with your CA.",
  "Tax-ID validation checks format and, where available, a checksum. It cannot prove a number is active, belongs to the party, or is accepted by a tax authority.",
  "Rates and rules change. Review the tax profile and rates in Settings against current law before issuing documents.",
  "This tool computes and organises figures. It does not file returns and is not a substitute for professional advice.",
];

// ---------------------------------------------------------------------------
// Double-entry accounting core (chart of accounts, journals, reports)
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = {
  asset: { normal: "debit", label: "Asset" },
  liability: { normal: "credit", label: "Liability" },
  equity: { normal: "credit", label: "Equity" },
  revenue: { normal: "credit", label: "Revenue" },
  cogs: { normal: "debit", label: "Cost of goods sold" },
  expense: { normal: "debit", label: "Expense" },
};

export function defaultChartOfAccounts() {
  return [
    { code: "1000", name: "Cash", type: "asset", cashFlow: "cash" },
    { code: "1010", name: "Bank", type: "asset", cashFlow: "cash" },
    { code: "1100", name: "Accounts Receivable", type: "asset", cashFlow: "operating" },
    { code: "1200", name: "Input GST / Tax Credit", type: "asset", cashFlow: "operating" },
    { code: "1500", name: "Fixed Assets", type: "asset", cashFlow: "investing" },
    { code: "2000", name: "Accounts Payable", type: "liability", cashFlow: "operating" },
    { code: "2100", name: "Output GST Payable", type: "liability", cashFlow: "operating" },
    { code: "2200", name: "TDS / Withholding Payable", type: "liability", cashFlow: "operating" },
    { code: "2500", name: "Loans", type: "liability", cashFlow: "financing" },
    { code: "3000", name: "Owner's Equity", type: "equity", cashFlow: "financing" },
    { code: "3100", name: "Retained Earnings", type: "equity", cashFlow: "financing" },
    { code: "4000", name: "Sales Revenue", type: "revenue", cashFlow: "operating" },
    { code: "4100", name: "Other Income", type: "revenue", cashFlow: "operating" },
    { code: "5000", name: "Cost of Services", type: "cogs", cashFlow: "operating" },
    { code: "6000", name: "Salaries & Wages", type: "expense", cashFlow: "operating" },
    { code: "6010", name: "Rent", type: "expense", cashFlow: "operating" },
    { code: "6020", name: "Software & Subscriptions", type: "expense", cashFlow: "operating" },
    { code: "6030", name: "Marketing", type: "expense", cashFlow: "operating" },
    { code: "6040", name: "Professional Fees", type: "expense", cashFlow: "operating" },
    { code: "6050", name: "Travel", type: "expense", cashFlow: "operating" },
    { code: "6060", name: "Utilities", type: "expense", cashFlow: "operating" },
    { code: "6070", name: "Office Expenses", type: "expense", cashFlow: "operating" },
    { code: "6090", name: "Other Expenses", type: "expense", cashFlow: "operating" },
  ];
}

export const accountByCode = (coa, code) => (coa || []).find((a) => a.code === code) || null;

export function validateJournal(entry) {
  const lines = (entry && entry.lines) || [];
  const debitPaise = lines.reduce((a, l) => a + (l.debitPaise || 0), 0);
  const creditPaise = lines.reduce((a, l) => a + (l.creditPaise || 0), 0);
  const errors = [];
  if (!lines.length) errors.push("A journal entry needs at least two lines.");
  if (lines.length === 1) errors.push("A journal entry needs at least two lines.");
  for (const l of lines) {
    if (!l.account) errors.push("Every line needs an account code.");
    if ((l.debitPaise || 0) > 0 && (l.creditPaise || 0) > 0) errors.push(`Line ${l.account} cannot be both debit and credit.`);
  }
  if (debitPaise !== creditPaise) errors.push(`Debits ${debitPaise} do not equal credits ${creditPaise}.`);
  return { balanced: debitPaise === creditPaise && !errors.length, debitPaise, creditPaise, errors };
}

export function accountMovement(journals, code) {
  let debitPaise = 0, creditPaise = 0;
  for (const j of journals || []) for (const l of j.lines || []) if (l.account === code) { debitPaise += l.debitPaise || 0; creditPaise += l.creditPaise || 0; }
  return { debitPaise, creditPaise };
}

export function accountBalances(journals, coa) {
  const map = {};
  for (const a of coa || []) {
    const { debitPaise, creditPaise } = accountMovement(journals, a.code);
    const normal = (ACCOUNT_TYPES[a.type] || {}).normal || "debit";
    const signedPaise = normal === "debit" ? debitPaise - creditPaise : creditPaise - debitPaise;
    map[a.code] = { ...a, debitPaise, creditPaise, signedPaise };
  }
  return map;
}

export function trialBalance(journals, coa) {
  const balances = accountBalances(journals, coa);
  const rows = Object.values(balances).map((b) => ({ code: b.code, name: b.name, type: b.type, debitPaise: b.debitPaise, creditPaise: b.creditPaise }));
  const totalDebit = rows.reduce((a, r) => a + r.debitPaise, 0);
  const totalCredit = rows.reduce((a, r) => a + r.creditPaise, 0);
  return { rows, totalDebitPaise: totalDebit, totalCreditPaise: totalCredit, balanced: totalDebit === totalCredit, balances };
}

const groupTotal = (balances, type) => Object.values(balances).filter((b) => b.type === type).reduce((a, b) => a + b.signedPaise, 0);

export function profitAndLoss(journals, coa, { from, to } = {}) {
  const filtered = (journals || []).filter((j) => (!from || j.date >= from) && (!to || j.date <= to));
  const b = accountBalances(filtered, coa);
  const revenue = groupTotal(b, "revenue");
  const cogs = groupTotal(b, "cogs");
  const expenses = groupTotal(b, "expense");
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;
  const lines = (type) => Object.values(b).filter((x) => x.type === type && x.signedPaise !== 0).map((x) => ({ code: x.code, name: x.name, amountPaise: x.signedPaise }));
  return { revenuePaise: revenue, cogsPaise: cogs, grossProfitPaise: grossProfit, expensePaise: expenses, netProfitPaise: netProfit, revenueLines: lines("revenue"), cogsLines: lines("cogs"), expenseLines: lines("expense") };
}

export function balanceSheet(journals, coa) {
  const b = accountBalances(journals, coa);
  const assets = groupTotal(b, "asset");
  const liabilities = groupTotal(b, "liability");
  const equity = groupTotal(b, "equity");
  const pl = profitAndLoss(journals, coa);
  const retained = equity + pl.netProfitPaise;
  const diff = assets - (liabilities + retained);
  return {
    assetLines: Object.values(b).filter((x) => x.type === "asset" && x.signedPaise !== 0).map((x) => ({ code: x.code, name: x.name, amountPaise: x.signedPaise })),
    liabilityLines: Object.values(b).filter((x) => x.type === "liability" && x.signedPaise !== 0).map((x) => ({ code: x.code, name: x.name, amountPaise: x.signedPaise })),
    equityLines: Object.values(b).filter((x) => x.type === "equity" && x.signedPaise !== 0).map((x) => ({ code: x.code, name: x.name, amountPaise: x.signedPaise })),
    assetsPaise: assets, liabilitiesPaise: liabilities, equityPaise: equity, retainedPaise: retained,
    netProfitPaise: pl.netProfitPaise, differencePaise: diff, balanced: diff === 0,
  };
}

export function cashFlow(journals, coa, { from, to } = {}) {
  const filtered = (journals || []).filter((j) => (!from || j.date >= from) && (!to || j.date <= to));
  const byCode = {};
  for (const j of filtered) for (const l of j.lines || []) byCode[l.account] = (byCode[l.account] || 0) + (l.debitPaise || 0) - (l.creditPaise || 0);
  const cashChange = (coa || []).filter((a) => a.cashFlow === "cash").reduce((a, x) => a + (byCode[x.code] || 0), 0);
  const inflows = filtered.map((j) => j).filter(Boolean);
  const buckets = { operating: 0, investing: 0, financing: 0 };
  for (const a of coa || []) {
    if (a.cashFlow === "cash") continue;
    const v = byCode[a.code] || 0;
    if (a.type === "revenue" || a.type === "expense" || a.type === "cogs") buckets.operating += v;
    else if (a.cashFlow === "investing") buckets.investing += v;
    else if (a.cashFlow === "financing") buckets.financing += v;
    else buckets.operating += v;
  }
  const operating = -buckets.operating;
  const investing = -buckets.investing;
  const financing = -buckets.financing;
  return { operatingPaise: operating, investingPaise: investing, financingPaise: financing, netChangePaise: operating + investing + financing, cashChangePaise: cashChange, inflows };
}

export function agingBuckets(items, { today, amountOf = (x) => x.amountPaise || 0, dateOf = (x) => x.dueDate } = {}) {
  const t = today || new Date().toISOString().slice(0, 10);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  for (const it of items || []) {
    const amt = amountOf(it);
    if (amt <= 0) continue;
    const due = dateOf(it);
    const age = due ? Math.floor((new Date(t + "T00:00:00Z") - new Date(due + "T00:00:00Z")) / 86400000) : 0;
    buckets.total += amt;
    if (age <= 0) buckets.current += amt;
    else if (age <= 30) buckets.d1_30 += amt;
    else if (age <= 60) buckets.d31_60 += amt;
    else if (age <= 90) buckets.d61_90 += amt;
    else buckets.d90plus += amt;
  }
  return buckets;
}

// ---- Production guards (sub-project 1) ------------------------------------

export function taxProfileReady({ country = "", regimeId = "IN_GST", currency = "", taxId = "" } = {}) {
  const missing = [];
  if (!country) missing.push("country");
  if (!regimeId) missing.push("regimeId");
  if (!currency) missing.push("currency");
  if (regimeId && regimeId !== "NONE") {
    const check = taxId ? validateTaxId(taxId, regimeId) : { valid: false, reason: "missing" };
    if (!check.valid) missing.push("taxId");
  }
  return { ready: missing.length === 0, missing };
}

export function closeBlockers({ invoices = [], payments = [], journals = [], quarantine = [] } = {}) {
  const out = [];
  const unbalanced = journals.filter((j) => !validateJournal(j).balanced);
  if (unbalanced.length) out.push({ key: "journal_unbalanced", label: "Unbalanced journals", detail: `${unbalanced.length} journal(s) do not balance` });
  const pending = journals.filter((j) => j.approval && j.approval.status === "pending");
  if (pending.length) out.push({ key: "journal_pending", label: "Journals awaiting approval", detail: `${pending.length} journal(s) held for approval` });
  const hardCodes = ["over_payment", "tds_mismatch", "over_settled"];
  const mismatches = [];
  for (const inv of invoices) {
    if (!inv || inv.void || inv.status === "void" || inv.status === "draft") continue;
    const ps = payments.filter((p) => p.invoiceId === inv.id);
    if (!ps.length) continue;
    const r = reconcileInvoice({
      invoice: { totalPaise: inv.totals && inv.totals.totalPaise, tdsPaise: inv.tdsPaise || 0 },
      payments: ps,
    });
    const hard = r.flags.filter((f) => hardCodes.includes(f.code));
    if (hard.length) mismatches.push({ number: inv.number || inv.id, detail: hard.map((f) => f.message).join("; ") });
  }
  if (mismatches.length) out.push({ key: "payment_mismatch", label: "Payment mismatches", detail: `${mismatches.length} invoice(s): ${mismatches.map((m) => m.number).join(", ")}` });
  if (quarantine.length) out.push({ key: "quarantined_records", label: "Damaged records quarantined", detail: `${quarantine.length} record(s) need review` });
  return out;
}

export function closeWarnings({ invoices = [], bankTxns = [] } = {}) {
  const out = [];
  const open = invoices.filter((i) => i && !i.void && ["issued", "sent", "part-paid", "overdue"].includes(i.status));
  if (open.length) out.push({ key: "open_receivable", label: "Open receivables", detail: `${open.length} invoice(s) still unpaid` });
  const unmatched = bankTxns.filter((t) => t.status === "unmatched");
  if (unmatched.length) out.push({ key: "unmatched_bank", label: "Unmatched bank lines", detail: `${unmatched.length} line(s) not reconciled` });
  return out;
}

const FIGURE_SOURCES = {
  outstanding: { label: "Outstanding", formula: "sum(totalPaise - paid - tds) over non-void invoices", inputs: ["invoices", "payments"] },
  overdue: { label: "Overdue", formula: "outstanding where dueDate < today", inputs: ["invoices", "payments"] },
  collected: { label: "Collected this period", formula: "sum(amountPaise) of payments in the period", inputs: ["payments"] },
  cash: { label: "Cash & bank", formula: "sum of cash/bank account balances from journals", inputs: ["journals", "coa"] },
  netTax: { label: "Net tax", formula: "output tax minus input tax", inputs: ["journals", "coa"] },
  revenue: { label: "Revenue", formula: "sum of revenue account postings in the period", inputs: ["journals", "coa"] },
  profit: { label: "Estimated profit", formula: "revenue minus cost of services and expenses", inputs: ["journals", "coa"] },
};
export function figureSource(key) { return FIGURE_SOURCES[key] || null; }
