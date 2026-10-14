/**
 * Shared /api/holds response used by the local server and the Vercel function.
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

function handleHolds(url, env, fetchImpl, res) {
  var includeReleased = url.searchParams.get("includeReleased") === "true";
  var creds = envFile.fusionConfig(env);
  if (!creds) {
    sendJson(res, 200, {
      ok: true,
      mode: "sample",
      refreshedAt: new Date().toISOString(),
      includeReleased: includeReleased,
      warning: null,
      holds: sampleHolds(),
    });
    return Promise.resolve();
  }

  return oracle
    .loadHolds({
      baseUrl: creds.baseUrl,
      user: creds.user,
      password: creds.password,
      includeReleased: includeReleased,
      fetch: fetchImpl,
    })
    .then(function (result) {
      sendJson(res, 200, {
        ok: true,
        mode: "live",
        refreshedAt: new Date().toISOString(),
        includeReleased: includeReleased,
        warning: result.warning,
        holds: result.holds,
      });
    })
    .catch(function (err) {
      var body = oracle.publicError(err);
      var status = body.kind === "login" ? 401 : 502;
      console.error("Oracle request failed:", body.kind, err && err.status ? err.status : "");
      sendJson(res, status, {
        ok: false,
        mode: "live",
        error: body.kind,
        message: body.message,
      });
    });
}

module.exports = {
  sampleHolds: sampleHolds,
  handleHolds: handleHolds,
};
