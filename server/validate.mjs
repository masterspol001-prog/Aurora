import { validateInvoice, validateJournal, computeInvoiceTotals, taxProfileReady, closeBlockers } from "../engine.js";

const isInt = (v) => Number.isSafeInteger(v);
const isPeriod = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// Validate a workspace snapshot before it is persisted. Uses the same DOM-free
// engine the client uses, so a malformed record can never be written to a
// workspace and blank the app on the next load.
export function validateSnapshot(state) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    push("state", "must be an object");
    return { valid: false, errors };
  }
  if (!isPeriod(state.period)) push("period", "must be formatted YYYY-MM");
  if (!state.settings || typeof state.settings !== "object") push("settings", "must be an object");
  if (!state.company || typeof state.company !== "object") push("company", "must be an object");
  const regimeId = (state.settings && state.settings.regimeId) || "IN_GST";
  for (const key of ["clients", "invoices", "payments", "journals", "expenses", "bills", "bankAccounts", "bankTxns", "quarantine"]) {
    if (state[key] !== undefined && !Array.isArray(state[key])) push(key, "must be an array");
  }

  const seen = new Set();
  (state.invoices || []).forEach((inv, i) => {
    const p = `invoices[${i}]`;
    if (!inv || typeof inv !== "object") { push(p, "must be an object"); return; }
    if (inv.id && seen.has(inv.id)) push(`${p}.id`, "duplicate id");
    if (inv.id) seen.add(inv.id);
    if (!Array.isArray(inv.lineItems) || !inv.lineItems.length) { push(`${p}.lineItems`, "must be a non-empty array"); return; }
    if (!inv.totals || !isInt(inv.totals.totalPaise)) push(`${p}.totals.totalPaise`, "must be a safe integer");
    inv.lineItems.forEach((li, k) => {
      if (li && !isInt(li.ratePaise)) push(`${p}.lineItems[${k}].ratePaise`, "must be a safe integer");
    });
    const check = validateInvoice(inv, { regimeId });
    if (!check.valid) for (const e of check.errors || []) push(`${p}.${e.field || "invalid"}`, e.message || "invalid invoice");
    if (inv.totals && isInt(inv.totals.totalPaise)) {
      const recomputed = computeInvoiceTotals({
        supplierState: inv.supplierState, placeOfSupply: inv.placeOfSupply, interState: inv.interState,
        regimeId, discountPaise: inv.discountPaise, tdsSection: inv.tdsSection || undefined,
        lineItems: inv.lineItems,
      });
      if (recomputed.totalPaise !== inv.totals.totalPaise) {
        push(`${p}.totals.totalPaise`, `does not match line items (expected ${recomputed.totalPaise})`);
      }
    }
  });

  (state.journals || []).forEach((j, i) => {
    const check = validateJournal(j);
    if (!check.balanced) push(`journals[${i}]`, (check.errors || ["unbalanced journal"]).join("; "));
  });

  return { valid: errors.length === 0, errors };
}

const ISSUED = new Set(["issued", "sent", "part-paid", "paid", "overdue"]);

// Policy guards that cannot be expressed as record shape. Enforced server-side
// so they cannot be bypassed by a modified client.
export function validatePolicy(state) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  const settings = state.settings || {};
  const company = state.company || {};
  const profile = taxProfileReady({ country: settings.country, regimeId: settings.regimeId, currency: settings.currency, taxId: company.gstin });
  (state.invoices || []).forEach((inv, i) => {
    if (inv && ISSUED.has(inv.status) && !profile.ready) {
      push(`invoices[${i}].status`, `issued without a confirmed tax profile (${profile.missing.join(", ")})`);
    }
  });
  const periods = Array.isArray(state.periods) ? state.periods : [];
  const overrides = state.closeOverrides || {};
  for (const rec of periods) {
    if (!rec || !rec.period) continue;
    const blockers = closeBlockers({ invoices: state.invoices || [], payments: state.payments || [], journals: state.journals || [], quarantine: state.quarantine || [] });
    if (blockers.length && !overrides[rec.period]) {
      push("periods", `${rec.period} is signed off with unresolved blockers (${blockers.map((b) => b.label).join(", ")})`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateWorkspace(state) {
  const shape = validateSnapshot(state);
  if (!shape.valid) return shape;
  return validatePolicy(state);
}
