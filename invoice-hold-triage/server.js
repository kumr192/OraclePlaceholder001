/**
 * Local server for the triage page, /api/holds, and /api/business-units.
 * On Vercel, public/ is static and the api/ folder is the same API.
 * Oracle credentials stay in environment variables and are not sent to the browser.
 */
var http = require("http");
var fs = require("fs");
var path = require("path");
var envFile = require("./env.js");
var access = require("./access.js");
var holds = require("./holds.js");

var ROOT = __dirname;
var PUBLIC = path.join(ROOT, "public");
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

function sendFile(res, fileName) {
  var filePath = path.join(PUBLIC, fileName);
  var body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(fileName)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function deny(res, decision) {
  res.writeHead(401, {
    "WWW-Authenticate": decision.authenticate,
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(decision.message);
}

function createApp(options) {
  var opts = options || {};
  var env = opts.env || process.env;
  var fetchImpl = opts.fetch;

  return function app(req, res) {
    var url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    var decision = access.authorize(access.headerFromRequest(req), env.APP_ACCESS_PASSWORD);
    if (!decision.ok) {
      deny(res, decision);
      return;
    }
    if (url.pathname === "/api/holds" && req.method === "GET") {
      holds.handleHolds(url, env, fetchImpl, res);
      return;
    }
    if (url.pathname === "/api/business-units" && req.method === "GET") {
      holds.handleBusinessUnits(env, fetchImpl, res);
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
    if (access.isGateEnabled(process.env.APP_ACCESS_PASSWORD)) {
      console.log("Access password is set. The browser will ask for it.");
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
  sampleHolds: holds.sampleHolds,
};
