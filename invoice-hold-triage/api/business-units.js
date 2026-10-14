/**
 * Vercel serverless function for GET /api/business-units.
 * The list comes from Oracle after the access gate. Credentials stay on the server.
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
  return holds.handleBusinessUnits(process.env, undefined, res);
};
