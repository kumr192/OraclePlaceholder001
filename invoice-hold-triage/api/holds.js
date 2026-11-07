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
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end(decision.message);
    return Promise.resolve();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return Promise.resolve();
  }
  return holds.handleHolds(holds.requestUrl(req, "/api/holds"), process.env, undefined, res);
};
