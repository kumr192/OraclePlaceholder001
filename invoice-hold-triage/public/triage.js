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
    "Qty Rec":
      "Compare the received quantity with the invoiced quantity, then correct the receipt, purchase order, or invoice line.",
    Price:
      "Check the purchase order price against the invoice price and update the PO, request a credit memo, or accept an approved price change.",
    Amount:
      "Compare the invoice amount with the purchase order and receipt, including tax and freight, and clear the difference before release.",
    "Max Amount":
      "The invoice is over the maximum amount tolerance. Confirm the purchase order amount, the tolerance, or the invoice total before release.",
    "Line Variance":
      "Review the line amount against the purchase order line and correct the price, quantity, or line amount.",
    "Dist Variance":
      "Review invoice distributions against the purchase order distributions and correct the account or amount split.",
    Funds:
      "Confirm budget or funds are available for the charge account and business unit, then rerun the funds check.",
    Tax:
      "Review the tax codes, rates, and tax amounts on the invoice against the purchase order and tax setup.",
    "Tax Amount Range":
      "The tax amount is outside the allowed range. Correct the tax rate, tax amount, or tolerance, then validate again.",
    "Tax Difference":
      "Compare the invoice tax with the calculated tax and correct the rate, code, or amount.",
    "Conversion Rate":
      "Enter or correct the currency conversion rate for the invoice currency and date.",
    Currency:
      "Confirm the invoice currency matches the purchase order or the supplier site currency.",
    Quality:
      "Check quality inspection or acceptance for the receipt before releasing this hold.",
    "Natural Account":
      "Correct the natural account on the invoice distribution so it is valid for the chart of accounts.",
    "Withholding Tax":
      "Review withholding tax on the invoice and supplier, then validate the invoice again.",
    Supplier:
      "Check whether the supplier or supplier site is on hold, and clear that with supplier maintenance before payment.",
    "Invalid PO":
      "Confirm the purchase order number, line, and schedule exist and are open for matching.",
  };

  var FALLBACK_ACTION =
    "Review the hold in Payables, correct the underlying exception, and release the hold only after the invoice passes validation.";

  function suggestedAction(holdName, holdReason) {
    var raw = String(holdName || "").trim();
    if (HOLD_ACTIONS[raw]) {
      return HOLD_ACTIONS[raw];
    }
    var lower = raw.toLowerCase();
    var names = Object.keys(HOLD_ACTIONS);
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === lower) {
        return HOLD_ACTIONS[names[i]];
      }
    }
    var reason = String(holdReason || "").trim();
    if (reason) {
      return "Oracle says: " + reason + " Correct that exception, then release the hold after the invoice validates.";
    }
    return FALLBACK_ACTION;
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

  function hasMoney(invoice) {
    if (!invoice || invoice.amount === null || invoice.amount === undefined || invoice.amount === "") {
      return false;
    }
    if (!invoice.currency) {
      return false;
    }
    return !Number.isNaN(Number(invoice.amount));
  }

  function invoiceIdentity(invoice) {
    return [
      String(invoice.invoiceNumber || "").trim().toLowerCase(),
      String(invoice.businessUnit || "").trim().toLowerCase(),
      String(invoice.supplier || "").trim().toLowerCase(),
    ].join("\u0001");
  }

  function tryAge(holdDate, asOf) {
    if (!holdDate) {
      return null;
    }
    try {
      return ageInDays(holdDate, asOf);
    } catch (err) {
      return null;
    }
  }

  function summarize(invoices, asOf) {
    var totalsByCurrency = {};
    var oldestAgeDays = null;
    var oldest = null;
    var seenInvoices = {};
    var invoiceCount = 0;
    var missingAmountCount = 0;
    var reference = asOf || new Date();

    (invoices || []).forEach(function (invoice) {
      var age = tryAge(invoice.holdDate, reference);
      if (age !== null && (oldestAgeDays === null || age > oldestAgeDays)) {
        oldestAgeDays = age;
        oldest = invoice;
      }
      var identity = invoiceIdentity(invoice);
      if (seenInvoices[identity]) {
        return;
      }
      seenInvoices[identity] = true;
      invoiceCount += 1;
      if (!hasMoney(invoice)) {
        missingAmountCount += 1;
        return;
      }
      var currency = invoice.currency;
      totalsByCurrency[currency] = roundMoney((totalsByCurrency[currency] || 0) + Number(invoice.amount));
    });

    var currencies = Object.keys(totalsByCurrency).sort();
    var orderedTotals = {};
    currencies.forEach(function (currency) {
      orderedTotals[currency] = totalsByCurrency[currency];
    });

    return {
      invoiceCount: invoiceCount,
      holdCount: (invoices || []).length,
      missingAmountCount: missingAmountCount,
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
        invoice.amount == null ? "" : String(invoice.amount),
        invoice.holdReason,
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
    hasMoney: hasMoney,
    ageInDays: ageInDays,
    roundMoney: roundMoney,
    summarize: summarize,
    filterInvoices: filterInvoices,
    uniqueSorted: uniqueSorted,
  };
});
