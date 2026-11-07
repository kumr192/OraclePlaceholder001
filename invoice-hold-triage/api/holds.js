/**
 * Vercel serverless function for GET /api/holds.
 * maxDuration is set in vercel.json (60 seconds). Open holds take about 11s
 * and include-released about 29s, so both finish inside that limit.
 */
var access = require("../access.js");
var holds = require("../holds.js");

module.exports = function handler(req, res, env) {
  var source = env || process.env;
  var decision = access.authorize(access.headerFromRequest(req), source.APP_ACCESS_PASSWORD, source);
  if (!decision.ok) {
    access.writeDenied(res, decision);
    return Promise.resolve();
  }
  if (req.method !== "GET") {
    res.writeHead(405, {
      Allow: "GET",
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed");
    return Promise.resolve();
  }
  return holds.handleHolds(holds.requestUrl(req, "/api/holds"), source, undefined, res);
};
