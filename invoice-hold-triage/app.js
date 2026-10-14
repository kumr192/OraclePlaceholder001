(function () {
  var triage = window.InvoiceTriage;
  var invoices = window.SAMPLE_INVOICES.slice().sort(function (a, b) {
    if (a.holdDate === b.holdDate) {
      return a.invoiceNumber < b.invoiceNumber ? -1 : 1;
    }
    return a.holdDate < b.holdDate ? -1 : 1;
  });

  var holdSelect = document.getElementById("filter-hold");
  var buSelect = document.getElementById("filter-bu");
  var searchInput = document.getElementById("filter-search");
  var clearButton = document.getElementById("clear-filters");
  var countEl = document.getElementById("stat-count");
  var amountEl = document.getElementById("stat-amount");
  var oldestEl = document.getElementById("stat-oldest");
  var oldestDetailEl = document.getElementById("stat-oldest-detail");
  var metaEl = document.getElementById("result-meta");
  var bodyEl = document.getElementById("invoice-body");
  var emptyEl = document.getElementById("empty-state");
  var asOfEl = document.getElementById("as-of");

  var asOf = new Date();
  asOfEl.textContent = formatLongDate(asOf);

  fillSelect(holdSelect, triage.uniqueSorted(invoices.map(function (invoice) {
    return invoice.holdName;
  })));
  fillSelect(buSelect, triage.uniqueSorted(invoices.map(function (invoice) {
    return invoice.businessUnit;
  })));

  holdSelect.addEventListener("change", render);
  buSelect.addEventListener("change", render);
  searchInput.addEventListener("input", render);
  clearButton.addEventListener("click", function () {
    holdSelect.value = "all";
    buSelect.value = "all";
    searchInput.value = "";
    render();
    searchInput.focus();
  });

  render();

  function render() {
    var filtered = triage.filterInvoices(invoices, {
      holdType: holdSelect.value,
      businessUnit: buSelect.value,
      query: searchInput.value,
    });
    var summary = triage.summarize(filtered, asOf);

    countEl.textContent = String(summary.invoiceCount);
    renderAmounts(summary.totalsByCurrency);
    if (summary.oldestAgeDays === null) {
      oldestEl.textContent = "—";
      oldestDetailEl.textContent = "No holds in this view";
    } else {
      oldestEl.textContent = summary.oldestAgeDays + (summary.oldestAgeDays === 1 ? " day" : " days");
      oldestDetailEl.textContent =
        summary.oldestInvoiceNumber + " · held since " + formatShortDate(summary.oldestHoldDate);
    }

    var noun = summary.invoiceCount === 1 ? "invoice" : "invoices";
    metaEl.textContent =
      "Showing " + summary.invoiceCount + " of " + invoices.length + " example " + noun;

    bodyEl.replaceChildren();
    filtered.forEach(function (invoice) {
      bodyEl.appendChild(renderRow(invoice));
    });
    emptyEl.hidden = filtered.length !== 0;
  }

  function renderAmounts(totals) {
    amountEl.replaceChildren();
    var currencies = Object.keys(totals);
    if (currencies.length === 0) {
      amountEl.textContent = "—";
      return;
    }
    currencies.forEach(function (currency) {
      var line = document.createElement("div");
      line.className = "amount-line";
      var code = document.createElement("span");
      code.className = "amount-code";
      code.textContent = currency;
      var value = document.createElement("span");
      value.className = "amount-value";
      value.textContent = formatMoney(totals[currency], currency);
      line.append(code, value);
      amountEl.appendChild(line);
    });
  }

  function renderRow(invoice) {
    var row = document.createElement("tr");
    row.append(
      cell(invoice.supplier, "supplier"),
      cell(invoice.invoiceNumber, "mono"),
      cell(formatMoney(invoice.amount, invoice.currency), "num"),
      cell(invoice.currency, "mono"),
      holdCell(invoice.holdName),
      cell(formatShortDate(invoice.holdDate)),
      cell(String(triage.ageInDays(invoice.holdDate, asOf)), "num"),
      cell(invoice.businessUnit),
      actionCell(invoice.holdName)
    );
    return row;
  }

  function cell(text, className) {
    var td = document.createElement("td");
    if (className) {
      td.className = className;
    }
    td.textContent = text;
    return td;
  }

  function holdCell(holdName) {
    var td = document.createElement("td");
    var pill = document.createElement("span");
    pill.className = "hold-pill hold-" + holdSlug(holdName);
    pill.textContent = holdName;
    td.appendChild(pill);
    return td;
  }

  function actionCell(holdName) {
    var td = document.createElement("td");
    td.className = "action";
    var advice = triage.suggestedAction(holdName);
    td.textContent = advice;
    td.title = advice;
    return td;
  }

  function fillSelect(select, values) {
    values.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function holdSlug(holdName) {
    return String(holdName).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function formatMoney(amount, currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function formatShortDate(iso) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(triageDate(iso));
  }

  function formatLongDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function triageDate(iso) {
    var parts = String(iso).split("-");
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }
})();
