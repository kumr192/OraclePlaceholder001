/**
 * Read Payables invoice holds from Oracle Fusion REST.
 * Docs:
 * https://docs.oracle.com/en/cloud/saas/financials/26b/farfa/op-invoiceholds-get.html
 * https://docs.oracle.com/en/cloud/saas/financials/25d/farfa/op-invoices-get.html
 *
 * Open holds are queried with ReleaseName IS NULL. On some instances
 * ReleaseDate IS NULL returns HTTP 200 with zero rows, and ReleaseDate=null
 * returns HTTP 400, so those queries are not used.
 */
var HOLD_COLLECTION = "/fscmRestApi/resources/11.13.18.05/invoiceHolds";
var INVOICE_COLLECTION = "/fscmRestApi/resources/11.13.18.05/invoices";
var PAGE_LIMIT = 500;
var MAX_PAGES = 40;
var OPEN_HOLD_CAP = 1000;
var RELEASED_HOLD_CAP = 500;
var INVOICE_CONCURRENCY = 6;
var OPEN_HOLD_QUERY = "ReleaseName IS NULL";
var OPEN_HOLD_QUERY_FALLBACK = "ReleaseName IS NULL;ReleaseDate IS NULL";
var RELEASED_HOLD_QUERY = "ReleaseName IS NOT NULL";
var BUSINESS_UNIT_LOV = "/fscmRestApi/resources/11.13.18.05/finBusinessUnitsLOV";
var INVOICE_FIELDS = "InvoiceId,InvoiceNumber,BusinessUnit,Supplier,InvoiceAmount,InvoiceCurrency";

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
  if (raw == null) {
    return false;
  }
  var name = raw.ReleaseName != null && String(raw.ReleaseName).trim() !== "";
  var date = raw.ReleaseDate != null && String(raw.ReleaseDate).trim() !== "";
  return name || date;
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

function normalizeBusinessUnit(value) {
  var text = String(value || "").trim();
  if (!text || text.toLowerCase() === "all") {
    return "";
  }
  return text;
}

function holdQueryFor(baseQuery, businessUnit) {
  var unit = normalizeBusinessUnit(businessUnit);
  if (!unit) {
    return baseQuery || null;
  }
  var clause = "BusinessUnit=" + quoteQueryValue(unit);
  if (!baseQuery) {
    return clause;
  }
  return baseQuery + ";" + clause;
}

function joinWarning(left, right) {
  if (left && right) {
    return left + " " + right;
  }
  return left || right || null;
}

function collectionUrl(origin, collectionPath, query) {
  var url = new URL(collectionPath, origin);
  Object.keys(query || {}).forEach(function (key) {
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

async function pageHolds(config, origin, q, orderBy, cap) {
  var items = [];
  var offset = 0;
  var truncated = false;
  var pages = 0;
  var includeLinks = true;
  while (true) {
    pages += 1;
    if (pages > MAX_PAGES) {
      throw new OracleRequestError("oracle", null, "Oracle returned too many pages. Narrow the request and try again.");
    }
    var limit = Math.min(PAGE_LIMIT, cap - items.length);
    if (limit <= 0) {
      truncated = true;
      break;
    }
    var query = {
      limit: limit,
      offset: offset,
      q: q,
      orderBy: orderBy,
    };
    if (includeLinks) {
      query.links = "parent";
    } else {
      query.onlyData = "true";
    }
    var page;
    try {
      page = await oracleGet(origin, HOLD_COLLECTION, query, config.user, config.password, config.fetch);
    } catch (err) {
      if (includeLinks && err && err.status === 400) {
        includeLinks = false;
        pages -= 1;
        continue;
      }
      throw err;
    }
    var pageItems = page && Array.isArray(page.items) ? page.items : [];
    items = items.concat(pageItems);
    var hasMore = Boolean(page && page.hasMore);
    if (items.length >= cap) {
      items = items.slice(0, cap);
      truncated = hasMore;
      break;
    }
    if (!hasMore) {
      break;
    }
    var pageLimit = Number(page && page.limit);
    if (!Number.isFinite(pageLimit) || pageLimit <= 0) {
      pageLimit = pageItems.length;
    }
    var pageOffset = Number(page && page.offset);
    if (!Number.isFinite(pageOffset)) {
      pageOffset = offset;
    }
    var nextOffset = pageOffset + pageLimit;
    if (nextOffset <= offset || pageItems.length === 0) {
      throw new OracleRequestError("oracle", null, "Oracle paging did not advance. Refresh and try again.");
    }
    offset = nextOffset;
  }
  return { items: items, truncated: truncated, warning: null, ordered: true };
}

async function fetchHoldQuery(config, origin, q, orderBy, cap) {
  try {
    return await pageHolds(config, origin, q, orderBy, cap);
  } catch (err) {
    if (orderBy && err && err.status === 400) {
      var unordered = await pageHolds(config, origin, q, null, cap);
      unordered.ordered = false;
      unordered.warning = "Oracle did not accept a date sort, so these may not be the latest holds.";
      return unordered;
    }
    throw err;
  }
}

async function explainEmptyOpenHolds(config, origin) {
  var probe = await oracleGet(
    origin,
    HOLD_COLLECTION,
    {
      onlyData: "true",
      limit: 1,
      offset: 0,
      q: holdQueryFor(null, config.businessUnit),
    },
    config.user,
    config.password,
    config.fetch
  );
  var sample = probe && Array.isArray(probe.items) ? probe.items[0] : null;
  if (!sample) {
    if (normalizeBusinessUnit(config.businessUnit)) {
      return "Oracle returned no invoice holds for " + normalizeBusinessUnit(config.businessUnit) + ".";
    }
    return "Oracle returned no invoice holds.";
  }
  if (!isReleased(sample)) {
    return "No open holds were returned, but Oracle still has a hold with no release name. The open-hold filter may not match this instance.";
  }
  return "No open holds were returned. Oracle does have released holds — turn on Include released holds to see the most recent ones.";
}

async function fetchOpenHolds(config, origin) {
  var cap = config.openCap || OPEN_HOLD_CAP;
  var primary = await fetchHoldQuery(config, origin, holdQueryFor(OPEN_HOLD_QUERY, config.businessUnit), null, cap);
  if (primary.items.length > 0) {
    return primary;
  }
  var alternate;
  try {
    alternate = await fetchHoldQuery(
      config,
      origin,
      holdQueryFor(OPEN_HOLD_QUERY_FALLBACK, config.businessUnit),
      null,
      cap
    );
  } catch (err) {
    if (!(err && err.status === 400)) {
      throw err;
    }
    alternate = { items: [], truncated: false, warning: null, ordered: true };
  }
  if (alternate.items.length > 0) {
    return alternate;
  }
  var warning = await explainEmptyOpenHolds(config, origin);
  return { items: [], truncated: false, warning: warning, ordered: true };
}

async function fetchReleasedHolds(config, origin) {
  var cap = config.releasedCap || RELEASED_HOLD_CAP;
  return fetchHoldQuery(config, origin, holdQueryFor(RELEASED_HOLD_QUERY, config.businessUnit), "HoldDate:desc", cap);
}

function isActiveBusinessUnit(row) {
  if (!row || row.ActiveFlag == null || row.ActiveFlag === "") {
    return true;
  }
  var flag = row.ActiveFlag;
  if (flag === false || flag === "false" || flag === "FALSE" || flag === "N" || flag === "n") {
    return false;
  }
  return true;
}

function businessUnitNames(rows, nameField) {
  var seen = {};
  var names = [];
  (rows || []).forEach(function (row) {
    if (nameField === "BusinessUnitName" && !isActiveBusinessUnit(row)) {
      return;
    }
    var name = String((row && row[nameField]) || "").trim();
    if (!name || seen[name]) {
      return;
    }
    seen[name] = true;
    names.push(name);
  });
  names.sort(function (a, b) {
    return a.localeCompare(b);
  });
  return names;
}

async function fetchBusinessUnitLov(config, origin) {
  var attempts = [
    { onlyData: "true", fields: "BusinessUnitName,ActiveFlag", orderBy: "BusinessUnitName:asc" },
    { onlyData: "true", fields: "BusinessUnitName,ActiveFlag" },
    { onlyData: "true" },
  ];
  var lastError = null;
  for (var i = 0; i < attempts.length; i += 1) {
    try {
      return await collectPages(function (offset) {
        return oracleGet(
          origin,
          BUSINESS_UNIT_LOV,
          Object.assign({ limit: PAGE_LIMIT, offset: offset }, attempts[i]),
          config.user,
          config.password,
          config.fetch
        );
      });
    } catch (err) {
      lastError = err;
      if (err && (err.kind === "login" || err.kind === "network" || err.status === 401 || err.status === 403)) {
        throw err;
      }
      if (err && err.status === 404) {
        throw err;
      }
      if (!(err && err.status === 400)) {
        throw err;
      }
    }
  }
  throw lastError;
}

async function distinctBusinessUnitsFromHolds(config, origin) {
  try {
    return await scanHoldBusinessUnits(config, origin, true);
  } catch (err) {
    if (err && err.status === 400) {
      return scanHoldBusinessUnits(config, origin, false);
    }
    throw err;
  }
}

async function scanHoldBusinessUnits(config, origin, withFields) {
  var items = [];
  var offset = 0;
  var pages = 0;
  while (pages < 4) {
    pages += 1;
    var query = {
      onlyData: "true",
      limit: PAGE_LIMIT,
      offset: offset,
      q: OPEN_HOLD_QUERY,
    };
    if (withFields) {
      query.fields = "BusinessUnit";
    }
    var page = await oracleGet(
      origin,
      HOLD_COLLECTION,
      query,
      config.user,
      config.password,
      config.fetch
    );
    var pageItems = page && Array.isArray(page.items) ? page.items : [];
    items = items.concat(pageItems);
    if (!page || !page.hasMore) {
      break;
    }
    var limit = Number(page.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = pageItems.length || PAGE_LIMIT;
    }
    var pageOffset = Number(page.offset);
    if (!Number.isFinite(pageOffset)) {
      pageOffset = offset;
    }
    var nextOffset = pageOffset + limit;
    if (nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
  }
  return businessUnitNames(items, "BusinessUnit");
}

async function listBusinessUnits(config) {
  var origin = siteRoot(config.baseUrl);
  try {
    var rows = await fetchBusinessUnitLov(config, origin);
    var names = businessUnitNames(rows, "BusinessUnitName");
    if (names.length > 0) {
      return { businessUnits: names, source: "lov", warning: null };
    }
  } catch (err) {
    if (err && (err.kind === "login" || err.kind === "network")) {
      throw err;
    }
  }
  var fromHolds = await distinctBusinessUnitsFromHolds(config, origin);
  return {
    businessUnits: fromHolds,
    source: "holds",
    warning: fromHolds.length
      ? "Business units were taken from invoice holds. The business unit list was not available."
      : "Oracle returned no business units.",
  };
}

function sameBusinessUnit(raw, businessUnit) {
  var unit = normalizeBusinessUnit(businessUnit);
  if (!unit) {
    return true;
  }
  return String((raw && raw.BusinessUnit) || "").trim().toLowerCase() === unit.toLowerCase();
}

function dedupeHolds(items) {
  var seen = {};
  var unique = [];
  (items || []).forEach(function (item) {
    var id = item && item.HoldId != null ? String(item.HoldId) : "";
    if (id) {
      if (seen[id]) {
        return;
      }
      seen[id] = true;
    }
    unique.push(item);
  });
  return unique;
}

function selectOpenHolds(rawItems, includeReleased) {
  if (includeReleased) {
    return rawItems || [];
  }
  return (rawItems || []).filter(function (item) {
    return !isReleased(item);
  });
}

function invoiceIdFromHold(raw) {
  if (!raw) {
    return "";
  }
  var direct = raw.InvoiceId != null ? raw.InvoiceId : raw.InvoiceId1;
  if (direct != null && String(direct).trim() !== "") {
    return String(direct).trim();
  }
  var links = Array.isArray(raw.links) ? raw.links : [];
  for (var i = 0; i < links.length; i += 1) {
    var href = links[i] && links[i].href ? String(links[i].href) : "";
    var match = href.match(/\/invoices\/(\d+)(?:\/|$|\?)/);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function invoiceInfo(row) {
  if (!row) {
    return null;
  }
  return {
    amount: row.InvoiceAmount,
    currency: row.InvoiceCurrency || row.InvoiceCurrencyCode || "",
    invoiceNumber: row.InvoiceNumber || "",
    businessUnit: row.BusinessUnit || "",
    supplier: row.Supplier || "",
    invoiceId: row.InvoiceId != null ? String(row.InvoiceId) : "",
  };
}

function indexInvoices(invoiceRows) {
  var byId = {};
  var byNumber = {};
  (invoiceRows || []).forEach(function (row) {
    var info = invoiceInfo(row);
    if (!info) {
      return;
    }
    if (info.invoiceId) {
      byId[info.invoiceId] = info;
    }
    var number = String(info.invoiceNumber || "").trim().toLowerCase();
    if (!number) {
      return;
    }
    if (!byNumber[number]) {
      byNumber[number] = [];
    }
    byNumber[number].push(info);
  });
  return { byId: byId, byNumber: byNumber };
}

function lookupInvoice(index, raw) {
  if (!index || !raw) {
    return null;
  }
  var id = invoiceIdFromHold(raw);
  if (id && index.byId[id]) {
    return index.byId[id];
  }
  var number = String(raw.InvoiceNumber || "").trim().toLowerCase();
  var candidates = index.byNumber[number] || [];
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  var businessUnit = String(raw.BusinessUnit || "").trim().toLowerCase();
  var supplier = String(raw.Supplier || "").trim().toLowerCase();
  var byBoth = candidates.filter(function (candidate) {
    return (
      String(candidate.businessUnit || "").trim().toLowerCase() === businessUnit &&
      String(candidate.supplier || "").trim().toLowerCase() === supplier
    );
  });
  if (byBoth.length >= 1) {
    return byBoth[0];
  }
  var byUnit = candidates.filter(function (candidate) {
    return String(candidate.businessUnit || "").trim().toLowerCase() === businessUnit;
  });
  if (byUnit.length >= 1) {
    return byUnit[0];
  }
  return candidates[0];
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

async function mapPool(items, concurrency, worker) {
  var results = new Array(items.length);
  var cursor = 0;
  async function run() {
    while (cursor < items.length) {
      var index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  var workers = [];
  var count = Math.min(concurrency, items.length);
  for (var i = 0; i < count; i += 1) {
    workers.push(run());
  }
  await Promise.all(workers);
  return results;
}

async function fetchInvoiceById(config, origin, id) {
  var path = INVOICE_COLLECTION + "/" + encodeURIComponent(id);
  try {
    return await oracleGet(
      origin,
      path,
      { onlyData: "true", fields: INVOICE_FIELDS },
      config.user,
      config.password,
      config.fetch
    );
  } catch (err) {
    if (err && err.status === 404) {
      return null;
    }
    if (err && err.status === 400) {
      return oracleGet(origin, path, { onlyData: "true" }, config.user, config.password, config.fetch);
    }
    throw err;
  }
}

async function fetchInvoicesByNumber(config, origin, number) {
  var page = await oracleGet(
    origin,
    INVOICE_COLLECTION,
    {
      onlyData: "true",
      limit: 20,
      offset: 0,
      fields: INVOICE_FIELDS,
      q: "InvoiceNumber=" + quoteQueryValue(number),
    },
    config.user,
    config.password,
    config.fetch
  );
  return page && Array.isArray(page.items) ? page.items : [];
}

async function fetchInvoicesForHolds(config, origin, rawHolds) {
  var ids = [];
  var seenIds = {};
  var numbers = [];
  var seenNumbers = {};
  (rawHolds || []).forEach(function (raw) {
    var id = invoiceIdFromHold(raw);
    if (id) {
      if (!seenIds[id]) {
        seenIds[id] = true;
        ids.push(id);
      }
      return;
    }
    var number = raw && raw.InvoiceNumber ? String(raw.InvoiceNumber).trim() : "";
    if (number && !seenNumbers[number]) {
      seenNumbers[number] = true;
      numbers.push(number);
    }
  });

  var failures = 0;
  function keepGoing(err) {
    if (err && (err.kind === "login" || err.kind === "network")) {
      throw err;
    }
    failures += 1;
    return null;
  }

  var byId = await mapPool(ids, INVOICE_CONCURRENCY, function (id) {
    return fetchInvoiceById(config, origin, id).catch(keepGoing);
  });
  var byNumber = await mapPool(numbers, INVOICE_CONCURRENCY, function (number) {
    return fetchInvoicesByNumber(config, origin, number).catch(function (err) {
      keepGoing(err);
      return [];
    });
  });

  var rows = [];
  byId.forEach(function (row, index) {
    if (!row) {
      return;
    }
    if (row.InvoiceId == null || String(row.InvoiceId).trim() === "") {
      row.InvoiceId = ids[index];
    }
    rows.push(row);
  });
  byNumber.forEach(function (list) {
    (list || []).forEach(function (row) {
      if (row) {
        rows.push(row);
      }
    });
  });
  return { rows: rows, failures: failures };
}

function releasedCapWarning(count) {
  return (
    "Only released holds are capped. Showing the " +
    count +
    " most recent released holds. Older released holds were not loaded."
  );
}

function openCapWarning(count) {
  return "Showing the first " + count + " open holds. More open holds were not loaded.";
}

async function loadHolds(config) {
  var origin = siteRoot(config.baseUrl);
  var open = await fetchOpenHolds(config, origin);
  var released = { items: [], truncated: false, warning: null };
  if (config.includeReleased) {
    released = await fetchReleasedHolds(config, origin);
  }
  var openItems = selectOpenHolds(open.items, false).filter(function (item) {
    return sameBusinessUnit(item, config.businessUnit);
  });
  released.items = (released.items || []).filter(function (item) {
    return sameBusinessUnit(item, config.businessUnit);
  });
  if (config.includeReleased && openItems.length === 0 && released.items.length > 0) {
    open.warning = null;
  }
  var selected = config.includeReleased ? dedupeHolds(openItems.concat(released.items)) : openItems;
  var warning = joinWarning(open.warning, released.warning);
  if (open.truncated) {
    warning = joinWarning(warning, openCapWarning(openItems.length));
  }
  if (released.truncated) {
    warning = joinWarning(warning, releasedCapWarning(released.items.length));
  }
  if (selected.length === 0 && !warning) {
    var unit = normalizeBusinessUnit(config.businessUnit);
    warning = unit
      ? "Oracle returned no invoice holds for " + unit + "."
      : "Oracle returned no invoice holds.";
  }
  var invoiceResult = { rows: [], failures: 0 };
  if (selected.length > 0) {
    try {
      invoiceResult = await fetchInvoicesForHolds(config, origin, selected);
    } catch (err) {
      var reason = err && err.message ? err.message : "Invoice amounts could not be read.";
      warning = joinWarning(warning, "Holds loaded, but invoice amounts could not be read. " + reason);
    }
  }
  if (invoiceResult.failures > 0) {
    warning = joinWarning(warning, "Some invoice amounts could not be read from Oracle.");
  }
  return {
    holds: mapHolds(selected, invoiceResult.rows),
    warning: warning,
    truncated: Boolean(open.truncated || released.truncated),
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
  invoiceIdFromHold: invoiceIdFromHold,
  lookupInvoice: lookupInvoice,
  indexInvoices: indexInvoices,
  loadHolds: loadHolds,
  HOLD_COLLECTION: HOLD_COLLECTION,
  INVOICE_COLLECTION: INVOICE_COLLECTION,
  OPEN_HOLD_QUERY: OPEN_HOLD_QUERY,
  RELEASED_HOLD_QUERY: RELEASED_HOLD_QUERY,
  BUSINESS_UNIT_LOV: BUSINESS_UNIT_LOV,
  normalizeBusinessUnit: normalizeBusinessUnit,
  holdQueryFor: holdQueryFor,
  listBusinessUnits: listBusinessUnits,
  dedupeHolds: dedupeHolds,
  OPEN_HOLD_CAP: OPEN_HOLD_CAP,
  RELEASED_HOLD_CAP: RELEASED_HOLD_CAP,
};
