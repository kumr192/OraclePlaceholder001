/**
 * Vercel serverless function for GET /api/holds.
 * maxDuration is set in vercel.json (60 seconds). Open holds take about 11s
 * and include-released about 29s, so both finish inside that limit.
 */
var access = require("../access.js");
var holds = require("../holds.js");

module.exports = function handler(req, res) {
  var decision = access.authorize(access.headerFromRequest(req), process.env.APP_ACCESS_PASSWORD);
  if (!decision.ok) {
    res.writeHead(401, {
      "WWW-Authenticate": decision.authenticate,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(decision.message);
    return Promise.resolve();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return Promise.resolve();
  }
  var url = new URL(req.url || "/api/holds", "http://127.0.0.1");
  return holds.handleHolds(url, process.env, undefined, res);
};
