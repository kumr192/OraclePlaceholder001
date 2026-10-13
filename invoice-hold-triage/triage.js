/**
 * Pure helpers for the invoice-hold triage demo.
 * Works in the browser (global InvoiceTriage) and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.InvoiceTriage = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  var HOLD_ACTIONS = {
    "Qty Ord":
      "Compare the ordered quantity on the purchase order with the invoiced quantity, then correct the PO, receipt, or invoice line.",
    Price:
      "Check the purchase order price against the invoice price and update the PO, request a credit memo, or accept an approved price change.",
    Amount:
      "Compare the invoice amount with the purchase order and receipt, including tax and freight, and clear the difference before release.",
    Funds:
      "Confirm budget or funds are available for the charge account and business unit, then rerun the funds check.",
    "Dist Variance":
      "Review invoice distributions against the purchase order distributions and correct the account or amount split.",
  };

  var FALLBACK_ACTION =
    "Review the hold in Payables, correct the underlying exception, and release the hold only after the invoice passes validation.";

  function suggestedAction(holdName) {
    return HOLD_ACTIONS[holdName] || FALLBACK_ACTION;
  }

  function parseDateOnly(value) {
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
    }
    var parts = String(value).slice(0, 10).split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!year || !month || !day) {
      throw new Error("Invalid date: " + value);
    }
    return new Date(Date.UTC(year, month - 1, day));
  }

  function ageInDays(holdDate, asOf) {
    var start = parseDateOnly(holdDate);
    var end = parseDateOnly(asOf || new Date());
    var ms = end.getTime() - start.getTime();
    return Math.round(ms / 86400000);
  }

  function roundMoney(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  }

  function summarize(invoices, asOf) {
    var totalsByCurrency = {};
    var oldestAgeDays = null;
    var oldest = null;
    var reference = asOf || new Date();

    (invoices || []).forEach(function (invoice) {
      var currency = invoice.currency;
      totalsByCurrency[currency] = roundMoney(
        (totalsByCurrency[currency] || 0) + Number(invoice.amount)
      );
      var age = ageInDays(invoice.holdDate, reference);
      if (oldestAgeDays === null || age > oldestAgeDays) {
        oldestAgeDays = age;
        oldest = invoice;
      }
    });

    var currencies = Object.keys(totalsByCurrency).sort();
    var orderedTotals = {};
    currencies.forEach(function (currency) {
      orderedTotals[currency] = totalsByCurrency[currency];
    });

    return {
      invoiceCount: (invoices || []).length,
      totalsByCurrency: orderedTotals,
      oldestAgeDays: oldestAgeDays,
      oldestInvoiceNumber: oldest ? oldest.invoiceNumber : null,
      oldestHoldDate: oldest ? oldest.holdDate : null,
    };
  }

  function filterInvoices(invoices, criteria) {
    var options = criteria || {};
    var holdType = options.holdType || "all";
    var businessUnit = options.businessUnit || "all";
    var query = String(options.query || "").trim().toLowerCase();

    return (invoices || []).filter(function (invoice) {
      if (holdType !== "all" && invoice.holdName !== holdType) {
        return false;
      }
      if (businessUnit !== "all" && invoice.businessUnit !== businessUnit) {
        return false;
      }
      if (!query) {
        return true;
      }
      var haystack = [
        invoice.supplier,
        invoice.invoiceNumber,
        invoice.holdName,
        invoice.businessUnit,
        invoice.currency,
        String(invoice.amount),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  function uniqueSorted(values) {
    var seen = {};
    values.forEach(function (value) {
      seen[value] = true;
    });
    return Object.keys(seen).sort();
  }

  return {
    HOLD_ACTIONS: HOLD_ACTIONS,
    FALLBACK_ACTION: FALLBACK_ACTION,
    suggestedAction: suggestedAction,
    ageInDays: ageInDays,
    roundMoney: roundMoney,
    summarize: summarize,
    filterInvoices: filterInvoices,
    uniqueSorted: uniqueSorted,
  };
});
