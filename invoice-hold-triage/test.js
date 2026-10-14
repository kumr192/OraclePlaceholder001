/**
 * Node checks for summary totals, hold age, filters, and suggested actions.
 * Run from this folder: node test.js
 */
var assert = require("assert");
var triage = require("./triage.js");
var invoices = require("./data.js");

var AS_OF = "2026-10-13";
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (err) {
    failed += 1;
    console.error("FAIL  " + name);
    console.error(err && err.stack ? err.stack : err);
  }
}

test("sample file contains 15 example invoices", function () {
  assert.strictEqual(invoices.length, 15);
});

test("full summary counts invoices and totals each currency", function () {
  var summary = triage.summarize(invoices, AS_OF);
  assert.strictEqual(summary.invoiceCount, 15);
  assert.deepStrictEqual(summary.totalsByCurrency, {
    CAD: 4555.75,
    EUR: 23385.25,
    GBP: 2750,
    USD: 78143.08,
  });
  assert.strictEqual(summary.oldestAgeDays, 120);
  assert.strictEqual(summary.oldestInvoiceNumber, "EX-INV-10048");
  assert.strictEqual(summary.oldestHoldDate, "2026-06-15");
});

test("currency totals are rounded to cents", function () {
  var summary = triage.summarize(
    [
      { invoiceNumber: "A", amount: 0.1, currency: "USD", holdDate: "2026-10-13" },
      { invoiceNumber: "B", amount: 0.2, currency: "USD", holdDate: "2026-10-13" },
    ],
    AS_OF
  );
  assert.strictEqual(summary.totalsByCurrency.USD, 0.3);
});

test("oldest age uses the latest hold date in the set", function () {
  assert.strictEqual(triage.ageInDays("2026-10-13", AS_OF), 0);
  assert.strictEqual(triage.ageInDays("2026-10-12", AS_OF), 1);
  assert.strictEqual(triage.ageInDays("2026-06-15", "2026-10-13"), 120);
  assert.strictEqual(triage.ageInDays("2026-07-12", "2026-10-13"), 93);
});

test("empty view has a zero count and no oldest hold", function () {
  var summary = triage.summarize([], AS_OF);
  assert.strictEqual(summary.invoiceCount, 0);
  assert.deepStrictEqual(summary.totalsByCurrency, {});
  assert.strictEqual(summary.oldestAgeDays, null);
  assert.strictEqual(summary.oldestInvoiceNumber, null);
});

test("Price hold filter keeps three invoices and the oldest is Helix", function () {
  var filtered = triage.filterInvoices(invoices, { holdType: "Price" });
  var summary = triage.summarize(filtered, AS_OF);
  assert.strictEqual(summary.invoiceCount, 3);
  assert.deepStrictEqual(summary.totalsByCurrency, {
    EUR: 7605,
    USD: 18850,
  });
  assert.strictEqual(summary.oldestAgeDays, 93);
  assert.strictEqual(summary.oldestInvoiceNumber, "EX-INV-10052");
});

test("business unit filter and search narrow the same summary", function () {
  var canada = triage.filterInvoices(invoices, { businessUnit: "Canada Business Unit" });
  assert.strictEqual(triage.summarize(canada, AS_OF).invoiceCount, 3);

  var lumen = triage.filterInvoices(invoices, { query: "  lUmEn  " });
  var lumenSummary = triage.summarize(lumen, AS_OF);
  assert.strictEqual(lumenSummary.invoiceCount, 1);
  assert.strictEqual(lumenSummary.totalsByCurrency.USD, 9800);
  assert.strictEqual(lumenSummary.oldestAgeDays, 120);

  var combined = triage.filterInvoices(invoices, {
    holdType: "Funds",
    businessUnit: "UK Business Unit",
    query: "eur",
  });
  assert.deepStrictEqual(
    combined.map(function (invoice) {
      return invoice.invoiceNumber;
    }),
    ["EX-INV-10044"]
  );
});

test("a search with no match produces an empty summary", function () {
  var none = triage.filterInvoices(invoices, { query: "not-a-supplier" });
  var summary = triage.summarize(none, AS_OF);
  assert.strictEqual(summary.invoiceCount, 0);
  assert.strictEqual(summary.oldestAgeDays, null);
});

test("each sample hold type has rule-based advice", function () {
  var holdNames = triage.uniqueSorted(
    invoices.map(function (invoice) {
      return invoice.holdName;
    })
  );
  assert.deepStrictEqual(holdNames, ["Amount", "Dist Variance", "Funds", "Price", "Qty Ord"]);
  holdNames.forEach(function (holdName) {
    var advice = triage.suggestedAction(holdName);
    assert.strictEqual(advice, triage.HOLD_ACTIONS[holdName]);
    assert.ok(advice.length > 40);
  });
  assert.ok(triage.suggestedAction("Price").toLowerCase().indexOf("price") !== -1);
  assert.strictEqual(triage.suggestedAction("Not A Hold"), triage.FALLBACK_ACTION);
});

if (failed > 0) {
  console.error("\n" + failed + " check(s) failed.");
  process.exit(1);
}

console.log("\nAll checks passed.");
