(function () {
  var triage = window.InvoiceTriage;
  var holds = [];
  var requestId = 0;

  var holdSelect = document.getElementById("filter-hold");
  var buSelect = document.getElementById("filter-bu");
  var searchInput = document.getElementById("filter-search");
  var clearButton = document.getElementById("clear-filters");
  var includeReleasedInput = document.getElementById("include-released");
  var refreshButton = document.getElementById("refresh");
  var countEl = document.getElementById("stat-count");
  var countNoteEl = document.getElementById("stat-count-note");
  var amountEl = document.getElementById("stat-amount");
  var amountNoteEl = document.getElementById("stat-amount-note");
  var oldestEl = document.getElementById("stat-oldest");
  var oldestDetailEl = document.getElementById("stat-oldest-detail");
  var metaEl = document.getElementById("result-meta");
  var bodyEl = document.getElementById("invoice-body");
  var emptyEl = document.getElementById("empty-state");
  var asOfEl = document.getElementById("as-of");
  var badgeEl = document.getElementById("source-badge");
  var refreshedEl = document.getElementById("refreshed-line");
  var noticeEl = document.getElementById("notice");
  var errorEl = document.getElementById("error");

  var asOf = new Date();
  asOfEl.textContent = formatLongDate(asOf);

  holdSelect.addEventListener("change", render);
  buSelect.addEventListener("change", render);
  searchInput.addEventListener("input", render);
  includeReleasedInput.addEventListener("change", load);
  refreshButton.addEventListener("click", load);
  clearButton.addEventListener("click", function () {
    holdSelect.value = "all";
    buSelect.value = "all";
    searchInput.value = "";
    render();
    searchInput.focus();
  });

  load();

  function load() {
    var id = ++requestId;
    var includeReleased = includeReleasedInput.checked;
    setBusy(true);
    errorEl.hidden = true;
    metaEl.textContent = "Loading holds…";

    fetch("/api/holds?includeReleased=" + (includeReleased ? "true" : "false"))
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (id !== requestId) {
          return;
        }
        var body = result.body || {};
        if (!result.ok || body.ok === false) {
          showError(body.message || "Could not load holds from Oracle Fusion.");
          return;
        }
        holds = (body.holds || []).slice().sort(compareHolds);
        showSource(body);
        rebuildFilters();
        render();
      })
      .catch(function () {
        if (id !== requestId) {
          return;
        }
        showError("Could not reach the triage server. From the invoice-hold-triage folder, run node server.js and open the address it prints.");
      })
      .finally(function () {
        if (id === requestId) {
          setBusy(false);
        }
      });
  }

  function showError(message) {
    holds = [];
    errorEl.hidden = false;
    errorEl.textContent = message;
    noticeEl.hidden = true;
    badgeEl.textContent = "Not loaded";
    badgeEl.className = "example-badge badge-error";
    refreshedEl.textContent = "";
    rebuildFilters();
    render();
    emptyEl.hidden = true;
    metaEl.textContent = "Holds could not be loaded.";
  }

  function showSource(body) {
    var live = body.mode === "live";
    badgeEl.textContent = live ? "Live from Oracle" : "Sample data";
    badgeEl.className = live ? "example-badge badge-live" : "example-badge badge-sample";
    noticeEl.hidden = false;
    noticeEl.className = live ? "notice notice-live" : "notice";
    if (live) {
      noticeEl.textContent = body.includeReleased
        ? "Live from Oracle Fusion. All open holds are included, plus released holds."
        : "Live from Oracle Fusion. Only open holds are shown. Released holds stay hidden until you include them.";
    } else {
      noticeEl.textContent =
        "Sample data. Oracle sign-in is not set, so these invoices are examples, not live Fusion holds.";
      if (body.includeReleased) {
        noticeEl.textContent += " These examples are all open holds.";
      }
    }
    if (body.warning) {
      noticeEl.textContent += " Warning: " + body.warning;
    }
    refreshedEl.textContent = body.refreshedAt ? "Last refreshed " + formatTimestamp(body.refreshedAt) : "";
  }

  function render() {
    var filtered = triage.filterInvoices(holds, {
      holdType: holdSelect.value,
      businessUnit: buSelect.value,
      query: searchInput.value,
    });
    var summary = triage.summarize(filtered, asOf);

    countEl.textContent = String(summary.invoiceCount);
    if (summary.holdCount === summary.invoiceCount) {
      countNoteEl.textContent = "In the current filter";
    } else {
      countNoteEl.textContent = summary.holdCount + " holds on these invoices";
    }
    renderAmounts(summary.totalsByCurrency);
    if (summary.missingAmountCount > 0) {
      var noun = summary.missingAmountCount === 1 ? "invoice has" : "invoices have";
      amountNoteEl.textContent =
        "By currency, not converted. " + summary.missingAmountCount + " " + noun + " no amount.";
    } else {
      amountNoteEl.textContent = "By currency, not converted";
    }
    if (summary.oldestAgeDays === null) {
      oldestEl.textContent = "—";
      oldestDetailEl.textContent = "No holds in this view";
    } else {
      oldestEl.textContent = summary.oldestAgeDays + (summary.oldestAgeDays === 1 ? " day" : " days");
      oldestDetailEl.textContent =
        summary.oldestInvoiceNumber + " · held since " + formatShortDate(summary.oldestHoldDate);
    }

    var holdNoun = filtered.length === 1 ? "hold" : "holds";
    metaEl.textContent = "Showing " + filtered.length + " " + holdNoun + " (" + holds.length + " loaded)";

    bodyEl.replaceChildren();
    filtered.forEach(function (invoice) {
      bodyEl.appendChild(renderRow(invoice));
    });
    emptyEl.hidden = filtered.length !== 0;
    emptyEl.textContent =
      holds.length === 0
        ? "No holds were returned."
        : "No holds match these filters. Clear the search or choose another hold type or business unit.";
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
      cell(invoice.amount == null ? "—" : formatMoney(invoice.amount, invoice.currency), "num"),
      cell(invoice.currency || "—", "mono"),
      holdCell(invoice.holdName),
      statusCell(invoice),
      cell(invoice.holdDate ? formatShortDate(invoice.holdDate) : "—"),
      cell(invoice.holdDate ? String(triage.ageInDays(invoice.holdDate, asOf)) : "—", "num"),
      cell(invoice.businessUnit),
      actionCell(invoice)
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
    pill.textContent = holdName || "Hold";
    td.appendChild(pill);
    return td;
  }

  function statusCell(invoice) {
    var td = document.createElement("td");
    var pill = document.createElement("span");
    pill.className = invoice.released ? "status status-released" : "status status-open";
    pill.textContent = invoice.released ? "Released" : "Open";
    td.appendChild(pill);
    return td;
  }

  function actionCell(invoice) {
    var td = document.createElement("td");
    td.className = "action";
    var advice = triage.suggestedAction(invoice.holdName, invoice.holdReason);
    td.textContent = advice;
    td.title = invoice.holdDetails ? advice + " " + invoice.holdDetails : advice;
    return td;
  }

  function rebuildFilters() {
    refill(holdSelect, "All hold types", holds.map(function (invoice) {
      return invoice.holdName;
    }));
    refill(buSelect, "All business units", holds.map(function (invoice) {
      return invoice.businessUnit;
    }));
  }

  function refill(select, allLabel, values) {
    var current = select.value || "all";
    var options = triage.uniqueSorted(values.filter(Boolean));
    select.replaceChildren();
    var all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    select.appendChild(all);
    options.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = options.indexOf(current) === -1 ? "all" : current;
  }

  function compareHolds(a, b) {
    if (a.holdDate && b.holdDate && a.holdDate !== b.holdDate) {
      return a.holdDate < b.holdDate ? -1 : 1;
    }
    if (!a.holdDate && b.holdDate) {
      return 1;
    }
    if (a.holdDate && !b.holdDate) {
      return -1;
    }
    return String(a.invoiceNumber).localeCompare(String(b.invoiceNumber));
  }

  function setBusy(busy) {
    refreshButton.disabled = busy;
    includeReleasedInput.disabled = busy;
    refreshButton.textContent = busy ? "Refreshing…" : "Refresh";
  }

  function holdSlug(holdName) {
    return String(holdName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function formatMoney(amount, currency) {
    if (amount == null || !currency) {
      return "—";
    }
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (err) {
      return Number(amount).toFixed(2) + " " + currency;
    }
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

  function formatTimestamp(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function triageDate(iso) {
    var parts = String(iso).split("-");
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }
})();
