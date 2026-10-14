/**
 * Serves the triage page and /api/holds.
 * Oracle credentials stay in environment variables and are not sent to the browser.
 */
var http = require("http");
var fs = require("fs");
var path = require("path");
var envFile = require("./env.js");
var oracle = require("./oracle.js");
var sample = require("./data.js");

var ROOT = __dirname;
var FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/triage.js": "triage.js",
};
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, fileName) {
  var filePath = path.join(ROOT, fileName);
  var body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(fileName)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(body);
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
    return;
  }

  oracle
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

function createApp(options) {
  var opts = options || {};
  var env = opts.env || process.env;
  var fetchImpl = opts.fetch;

  return function app(req, res) {
    var url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/holds" && req.method === "GET") {
      handleHolds(url, env, fetchImpl, res);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("Method not allowed");
      return;
    }
    var fileName = FILES[url.pathname];
    if (!fileName) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fileName)] });
      res.end();
      return;
    }
    sendFile(res, fileName);
  };
}

function start() {
  envFile.loadEnvFile(path.join(ROOT, ".env"), process.env);
  var port = Number(process.env.PORT) || 3000;
  var host = process.env.HOST || "127.0.0.1";
  var creds = envFile.fusionConfig(process.env);
  var app = createApp({ env: process.env });
  var server = http.createServer(app);
  server.listen(port, host, function () {
    if (!creds) {
      console.log("Oracle settings are missing. The page will show sample data.");
    } else {
      console.log("Oracle settings found for user " + creds.user + ". The page will load live holds.");
    }
    console.log("Open http://" + host + ":" + port);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp: createApp,
  sampleHolds: sampleHolds,
};
