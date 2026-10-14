/**
 * Read Payables invoice holds from Oracle Fusion REST.
 * Docs:
 * https://docs.oracle.com/en/cloud/saas/financials/26b/farfa/op-invoiceholds-get.html
 * https://docs.oracle.com/en/cloud/saas/financials/25d/farfa/op-invoices-get.html
 */
var HOLD_COLLECTION = "/fscmRestApi/resources/11.13.18.05/invoiceHolds";
var INVOICE_COLLECTION = "/fscmRestApi/resources/11.13.18.05/invoices";
var PAGE_LIMIT = 500;
var MAX_PAGES = 40;
var INVOICE_BATCH = 10;
var OPEN_HOLD_QUERIES = ["ReleaseDate IS NULL", "ReleaseDate=null"];

function OracleRequestError(kind, status, message) {
  this.name = "OracleRequestError";
  this.kind = kind;
  this.status = status || null;
  this.message = message;
}
OracleRequestError.prototype = Object.create(Error.prototype);

function publicError(err) {
  if (err && (err.kind === "login" || err.kind === "network" || err.kind === "oracle") && err.message) {
    return { kind: err.kind, message: err.message };
  }
  return { kind: "oracle", message: "Could not load holds from Oracle Fusion." };
}

function siteRoot(value) {
  var url;
  try {
    url = new URL(value);
  } catch (err) {
    throw new OracleRequestError("network", null, "ORACLE_FUSION_URL is not a valid address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OracleRequestError("network", null, "ORACLE_FUSION_URL must start with https://.");
  }
  return url.origin;
}

function isReleased(raw) {
  return raw != null && raw.ReleaseDate != null && String(raw.ReleaseDate).trim() !== "";
}

function dateOnly(value) {
  if (value == null || String(value).trim() === "") {
    return "";
  }
  return String(value).slice(0, 10);
}

function quoteQueryValue(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function collectionUrl(origin, collectionPath, query) {
  var url = new URL(collectionPath, origin);
  Object.keys(query).forEach(function (key) {
    if (query[key] != null && query[key] !== "") {
      url.searchParams.set(key, String(query[key]));
    }
  });
  return url.toString();
}

function basicAuthHeader(user, password) {
  return "Basic " + Buffer.from(user + ":" + password, "utf8").toString("base64");
}

async function readJson(response) {
  var text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new OracleRequestError("oracle", response.status, "Oracle Fusion sent a response that was not JSON.");
  }
}

async function oracleGet(origin, collectionPath, query, user, password, fetchImpl) {
  var fetchFn = fetchImpl || fetch;
  var url = collectionUrl(origin, collectionPath, query);
  var response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(user, password),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new OracleRequestError(
      "network",
      null,
      "Could not reach Oracle Fusion. Check ORACLE_FUSION_URL and the network."
    );
  }
  if (!response.ok) {
    await response.text().catch(function () {
      return "";
    });
    if (response.status === 401 || response.status === 403) {
      throw new OracleRequestError(
        "login",
        response.status,
        "Oracle rejected the sign-in. Check ORACLE_FUSION_USER and ORACLE_FUSION_PASSWORD."
      );
    }
    throw new OracleRequestError("oracle", response.status, "Oracle Fusion returned HTTP " + response.status + ".");
  }
  return readJson(response);
}

async function collectPages(fetchPage) {
  var items = [];
  var offset = 0;
  var hasMore = true;
  var pages = 0;
  while (hasMore) {
    pages += 1;
    if (pages > MAX_PAGES) {
      throw new OracleRequestError(
        "oracle",
        null,
        "Oracle returned too many pages. Narrow the request and try again."
      );
    }
    var page = await fetchPage(offset);
    var pageItems = page && Array.isArray(page.items) ? page.items : [];
    items = items.concat(pageItems);
    hasMore = Boolean(page && page.hasMore);
    var limit = Number(page && page.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = pageItems.length;
    }
    var pageOffset = Number(page && page.offset);
    if (!Number.isFinite(pageOffset)) {
      pageOffset = offset;
    }
    var nextOffset = pageOffset + limit;
    if (hasMore && (nextOffset <= offset || pageItems.length === 0)) {
      throw new OracleRequestError("oracle", null, "Oracle paging did not advance. Refresh and try again.");
    }
    offset = nextOffset;
  }
  return items;
}

function selectOpenHolds(rawItems, includeReleased) {
  if (includeReleased) {
    return rawItems || [];
  }
  return (rawItems || []).filter(function (item) {
    return !isReleased(item);
  });
}

function matchKey(invoiceNumber, businessUnit, supplier) {
  return [
    String(invoiceNumber || "").trim().toLowerCase(),
    String(businessUnit || "").trim().toLowerCase(),
    String(supplier || "").trim().toLowerCase(),
  ].join("\u0001");
}

function indexInvoices(invoiceRows) {
  var bySupplier = {};
  var byBusinessUnit = {};
  (invoiceRows || []).forEach(function (row) {
    var info = {
      amount: row.InvoiceAmount,
      currency: row.InvoiceCurrency || row.InvoiceCurrencyCode || "",
    };
    var full = matchKey(row.InvoiceNumber, row.BusinessUnit, row.Supplier);
    var partial = matchKey(row.InvoiceNumber, row.BusinessUnit, "");
    if (!bySupplier[full]) {
      bySupplier[full] = info;
    }
    if (!byBusinessUnit[partial]) {
      byBusinessUnit[partial] = info;
    }
  });
  return { bySupplier: bySupplier, byBusinessUnit: byBusinessUnit };
}

function lookupInvoice(index, raw) {
  if (!index) {
    return null;
  }
  var full = matchKey(raw.InvoiceNumber, raw.BusinessUnit, raw.Supplier);
  if (index.bySupplier[full]) {
    return index.bySupplier[full];
  }
  return index.byBusinessUnit[matchKey(raw.InvoiceNumber, raw.BusinessUnit, "")] || null;
}

function mapHold(raw, invoice) {
  var amount = null;
  var currency = "";
  if (invoice && invoice.amount != null && invoice.amount !== "" && !Number.isNaN(Number(invoice.amount))) {
    amount = Number(invoice.amount);
    currency = invoice.currency || "";
  }
  return {
    holdId: raw && raw.HoldId != null ? raw.HoldId : null,
    supplier: (raw && raw.Supplier) || "",
    invoiceNumber: (raw && raw.InvoiceNumber) || "",
    amount: amount,
    currency: currency,
    holdName: (raw && raw.HoldName) || "",
    holdDate: dateOnly(raw && raw.HoldDate),
    businessUnit: (raw && raw.BusinessUnit) || "",
    released: isReleased(raw),
    releaseDate: dateOnly(raw && raw.ReleaseDate),
    holdReason: (raw && raw.HoldReason) || "",
    holdDetails: (raw && raw.HoldDetails) || "",
    lineHeld: (raw && raw.LineHeld) || "",
    workflowStatus: (raw && raw.WorkflowStatus) || "",
    heldBy: (raw && raw.HeldBy) || "",
  };
}

function mapHolds(rawItems, invoiceRows) {
  var index = indexInvoices(invoiceRows);
  return (rawItems || []).map(function (raw) {
    return mapHold(raw, lookupInvoice(index, raw));
  });
}

function uniqueInvoiceNumbers(rawItems) {
  var seen = {};
  var numbers = [];
  (rawItems || []).forEach(function (raw) {
    var number = raw && raw.InvoiceNumber ? String(raw.InvoiceNumber).trim() : "";
    if (!number || seen[number]) {
      return;
    }
    seen[number] = true;
    numbers.push(number);
  });
  return numbers;
}

async function fetchHoldItems(config, includeReleased) {
  var origin = siteRoot(config.baseUrl);
  var queries = includeReleased ? [null] : OPEN_HOLD_QUERIES.concat([null]);
  var lastError = null;
  for (var i = 0; i < queries.length; i += 1) {
    var q = queries[i];
    try {
      return await collectPages(function (offset) {
        return oracleGet(
          origin,
          HOLD_COLLECTION,
          {
            onlyData: "true",
            limit: PAGE_LIMIT,
            offset: offset,
            q: q,
          },
          config.user,
          config.password,
          config.fetch
        );
      });
    } catch (err) {
      lastError = err;
      if (!(err && err.status === 400)) {
        throw err;
      }
    }
  }
  throw lastError;
}

async function fetchInvoiceBatch(config, origin, numbers) {
  var q = numbers
    .map(function (number) {
      return "InvoiceNumber=" + quoteQueryValue(number);
    })
    .join(" OR ");
  try {
    return await collectPages(function (offset) {
      return oracleGet(
        origin,
        INVOICE_COLLECTION,
        {
          onlyData: "true",
          limit: PAGE_LIMIT,
          offset: offset,
          fields: "InvoiceNumber,BusinessUnit,Supplier,InvoiceAmount,InvoiceCurrency",
          q: q,
        },
        config.user,
        config.password,
        config.fetch
      );
    });
  } catch (err) {
    if (!(err && err.status === 400) || numbers.length === 1) {
      throw err;
    }
    var rows = [];
    for (var i = 0; i < numbers.length; i += 1) {
      var one = await fetchInvoiceBatch(config, origin, [numbers[i]]);
      rows = rows.concat(one);
    }
    return rows;
  }
}

async function fetchInvoicesForHolds(config, rawHolds) {
  var numbers = uniqueInvoiceNumbers(rawHolds);
  if (numbers.length === 0) {
    return [];
  }
  var origin = siteRoot(config.baseUrl);
  var rows = [];
  for (var i = 0; i < numbers.length; i += INVOICE_BATCH) {
    var batch = numbers.slice(i, i + INVOICE_BATCH);
    var found = await fetchInvoiceBatch(config, origin, batch);
    rows = rows.concat(found);
  }
  return rows;
}

async function loadHolds(config) {
  var raw = await fetchHoldItems(config, config.includeReleased);
  var selected = selectOpenHolds(raw, config.includeReleased);
  var warning = null;
  var invoices = [];
  try {
    invoices = await fetchInvoicesForHolds(config, selected);
  } catch (err) {
    var reason = err && err.message ? err.message : "Invoice amounts could not be read.";
    warning = "Holds loaded, but invoice amounts could not be read. " + reason;
  }
  return {
    holds: mapHolds(selected, invoices),
    warning: warning,
  };
}

module.exports = {
  OracleRequestError: OracleRequestError,
  publicError: publicError,
  siteRoot: siteRoot,
  isReleased: isReleased,
  dateOnly: dateOnly,
  collectPages: collectPages,
  selectOpenHolds: selectOpenHolds,
  mapHold: mapHold,
  mapHolds: mapHolds,
  loadHolds: loadHolds,
  HOLD_COLLECTION: HOLD_COLLECTION,
  INVOICE_COLLECTION: INVOICE_COLLECTION,
  OPEN_HOLD_QUERIES: OPEN_HOLD_QUERIES,
};
