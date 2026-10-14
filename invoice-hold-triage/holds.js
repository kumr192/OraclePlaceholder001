/**
 * Shared /api/holds and /api/business-units responses.
 * Used by the local server and the Vercel functions.
 * Oracle credentials stay in the environment and are not included in the response.
 */
var envFile = require("./env.js");
var oracle = require("./oracle.js");
var sample = require("./data.js");

function sampleHolds() {
  return sample.map(function (row) {
    return {
      holdId: null,
      supplier: row.supplier,
      invoiceNumber: row.invoiceNumber,
      amount: row.amount,
      currency: row.currency,
      holdName: row.holdName,
      holdDate: row.holdDate,
      businessUnit: row.businessUnit,
      released: false,
      releaseDate: "",
      holdReason: "",
      holdDetails: "",
      lineHeld: "",
      workflowStatus: "",
      heldBy: "",
    };
  });
}

function sendJson(res, status, body) {
  var payload = JSON.stringify(body);
  if (typeof res.status === "function" && typeof res.json === "function" && !res.writeHead) {
    res.status(status).json(body);
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sampleBusinessUnits() {
  var seen = {};
  sample.forEach(function (row) {
    var name = String(row.businessUnit || "").trim();
    if (name) {
      seen[name] = true;
    }
  });
  return Object.keys(seen).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function holdsForUnit(rows, businessUnit) {
  var unit = oracle.normalizeBusinessUnit(businessUnit);
  if (!unit) {
    return rows;
  }
  return rows.filter(function (row) {
    return String(row.businessUnit || "").trim().toLowerCase() === unit.toLowerCase();
  });
}

function sendOracleError(res, err) {
  var body = oracle.publicError(err);
  var status = body.kind === "login" ? 401 : 502;
  console.error("Oracle request failed:", body.kind, err && err.status ? err.status : "");
  sendJson(res, status, {
    ok: false,
    mode: "live",
    error: body.kind,
    message: body.message,
  });
}

function handleHolds(url, env, fetchImpl, res) {
  var includeReleased = url.searchParams.get("includeReleased") === "true";
  var businessUnit = oracle.normalizeBusinessUnit(url.searchParams.get("businessUnit"));
  var creds = envFile.fusionConfig(env);
  if (!creds) {
    sendJson(res, 200, {
      ok: true,
      mode: "sample",
      refreshedAt: new Date().toISOString(),
      includeReleased: includeReleased,
      businessUnit: businessUnit || null,
      warning: null,
      holds: holdsForUnit(sampleHolds(), businessUnit),
    });
    return Promise.resolve();
  }

  return oracle
    .loadHolds({
      baseUrl: creds.baseUrl,
      user: creds.user,
      password: creds.password,
      includeReleased: includeReleased,
      businessUnit: businessUnit,
      fetch: fetchImpl,
    })
    .then(function (result) {
      sendJson(res, 200, {
        ok: true,
        mode: "live",
        refreshedAt: new Date().toISOString(),
        includeReleased: includeReleased,
        businessUnit: businessUnit || null,
        warning: result.warning,
        holds: result.holds,
      });
    })
    .catch(function (err) {
      sendOracleError(res, err);
    });
}

function handleBusinessUnits(env, fetchImpl, res) {
  var creds = envFile.fusionConfig(env);
  if (!creds) {
    sendJson(res, 200, {
      ok: true,
      mode: "sample",
      source: "sample",
      warning: null,
      businessUnits: sampleBusinessUnits(),
    });
    return Promise.resolve();
  }

  return oracle
    .listBusinessUnits({
      baseUrl: creds.baseUrl,
      user: creds.user,
      password: creds.password,
      fetch: fetchImpl,
    })
    .then(function (result) {
      sendJson(res, 200, {
        ok: true,
        mode: "live",
        source: result.source,
        warning: result.warning,
        businessUnits: result.businessUnits,
      });
    })
    .catch(function (err) {
      sendOracleError(res, err);
    });
}

module.exports = {
  sampleHolds: sampleHolds,
  sampleBusinessUnits: sampleBusinessUnits,
  handleHolds: handleHolds,
  handleBusinessUnits: handleBusinessUnits,
};
