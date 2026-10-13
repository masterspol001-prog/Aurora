import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultChartOfAccounts, validateJournal, trialBalance, profitAndLoss,
  balanceSheet, cashFlow, agingBuckets, accountBalances,
} from "../engine.js";

const coa = defaultChartOfAccounts();
const j = (date, lines) => ({ id: "j", date, ref: "r", source: "test", createdBy: "owner", lines });
const line = (account, debitPaise = 0, creditPaise = 0) => ({ account, debitPaise, creditPaise });

test("chart of accounts is complete and unique", () => {
  const codes = coa.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const a of coa) assert.ok(["asset", "liability", "equity", "revenue", "cogs", "expense"].includes(a.type));
});

test("journals must balance to the paise", () => {
  assert.equal(validateJournal(j("2026-09-01", [line("1010", 1000), line("4000", 0, 1000)])).balanced, true);
  const bad = validateJournal(j("2026-09-01", [line("1010", 1000), line("4000", 0, 999)]));
  assert.equal(bad.balanced, false);
  assert.ok(bad.errors.some((e) => /do not equal/.test(e)));
  assert.equal(validateJournal(j("2026-09-01", [line("1010", 1000)])).balanced, false);
});

test("trial balance always balances when journals do", () => {
  const journals = [
    j("2026-09-01", [line("1100", 118000), line("4000", 0, 100000), line("2100", 0, 18000)]),
    j("2026-09-05", [line("1010", 118000), line("1100", 0, 118000)]),
    j("2026-09-06", [line("5000", 20000), line("2000", 0, 20000)]),
  ];
  const tb = trialBalance(journals, coa);
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebitPaise, tb.totalCreditPaise);
});

test("profit and loss nets revenue, cost of sales and expenses", () => {
  const journals = [
    j("2026-09-01", [line("1100", 118000), line("4000", 0, 100000), line("2100", 0, 18000)]),
    j("2026-09-02", [line("5000", 20000), line("2000", 0, 20000)]),
    j("2026-09-03", [line("6020", 5000), line("1010", 0, 5000)]),
  ];
  const pl = profitAndLoss(journals, coa, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(pl.revenuePaise, 100000);
  assert.equal(pl.cogsPaise, 20000);
  assert.equal(pl.grossProfitPaise, 80000);
  assert.equal(pl.expensePaise, 5000);
  assert.equal(pl.netProfitPaise, 75000);
});

test("balance sheet stays in balance via retained earnings", () => {
  const journals = [
    j("2026-09-01", [line("1010", 500000), line("3000", 0, 500000)]),
    j("2026-09-02", [line("1100", 118000), line("4000", 0, 100000), line("2100", 0, 18000)]),
    j("2026-09-03", [line("6020", 5000), line("1010", 0, 5000)]),
  ];
  const bs = balanceSheet(journals, coa);
  assert.equal(bs.balanced, true);
  assert.equal(bs.differencePaise, 0);
  assert.equal(bs.netProfitPaise, 95000);
});

test("cash flow classifies operating, investing and financing", () => {
  const journals = [
    j("2026-09-01", [line("1010", 500000), line("2500", 0, 500000)]),
    j("2026-09-02", [line("1010", 100000), line("4000", 0, 100000)]),
    j("2026-09-03", [line("1500", 80000), line("1010", 0, 80000)]),
  ];
  const cf = cashFlow(journals, coa, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(cf.financingPaise, 500000);
  assert.equal(cf.operatingPaise, 100000);
  assert.equal(cf.investingPaise, -80000);
  assert.equal(cf.netChangePaise, 520000);
});

test("aging buckets split receivables into standard bands", () => {
  const today = "2026-09-30";
  const items = [
    { amountPaise: 1000, dueDate: "2026-10-15" },
    { amountPaise: 2000, dueDate: "2026-09-15" },
    { amountPaise: 3000, dueDate: "2026-08-15" },
    { amountPaise: 4000, dueDate: "2026-07-15" },
    { amountPaise: 5000, dueDate: "2026-05-15" },
  ];
  const b = agingBuckets(items, { today });
  assert.equal(b.current, 1000);
  assert.equal(b.d1_30, 2000);
  assert.equal(b.d31_60, 3000);
  assert.equal(b.d61_90, 4000);
  assert.equal(b.d90plus, 5000);
  assert.equal(b.total, 15000);
});

test("account balances respect normal balance direction", () => {
  const journals = [j("2026-09-01", [line("1010", 500000), line("3000", 0, 500000)])];
  const b = accountBalances(journals, coa);
  assert.equal(b["1010"].signedPaise, 500000);
  assert.equal(b["3000"].signedPaise, 500000);
});
