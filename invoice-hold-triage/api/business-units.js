/**
 * Vercel serverless function for GET /api/business-units.
 * The list comes from Oracle after the access gate. Credentials stay on the server.
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
  return holds.handleBusinessUnits(source, undefined, res);
};
