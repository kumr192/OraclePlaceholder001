/**
 * Site gate. If APP_ACCESS_PASSWORD is set, callers must send HTTP Basic auth.
 * Any username is accepted. The password must match.
 * This is not the Oracle password, and it is never sent to the browser.
 * Live Oracle settings without this access password fail closed.
 */
var crypto = require("crypto");
var envFile = require("./env.js");

var REALM = 'Basic realm="Invoice hold triage", charset="UTF-8"';
var CONFIG_REQUIRED = "config-required. Set APP_ACCESS_PASSWORD before loading live holds.";

function isGateEnabled(password) {
  return password != null && String(password) !== "";
}

function isLiveConfigured(env) {
  return Boolean(envFile.fusionConfig(env));
}

function decodeBasic(header) {
  if (!header || typeof header !== "string") {
    return null;
  }
  var match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  var decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch (err) {
    return null;
  }
  var sep = decoded.indexOf(":");
  if (sep < 0) {
    return null;
  }
  return {
    username: decoded.slice(0, sep),
    password: decoded.slice(sep + 1),
  };
}

function sameSecret(given, expected) {
  var actual = Buffer.from(String(given), "utf8");
  var wanted = Buffer.from(String(expected), "utf8");
  if (actual.length !== wanted.length) {
    crypto.timingSafeEqual(wanted, wanted);
    return false;
  }
  return crypto.timingSafeEqual(actual, wanted);
}

function authorize(header, expectedPassword, env) {
  if (isLiveConfigured(env) && !isGateEnabled(expectedPassword)) {
    return {
      ok: false,
      status: 503,
      code: "config-required",
      message: CONFIG_REQUIRED,
    };
  }
  if (!isGateEnabled(expectedPassword)) {
    return { ok: true, status: 200 };
  }
  var parsed = decodeBasic(header);
  if (!parsed || !sameSecret(parsed.password, String(expectedPassword))) {
    return {
      ok: false,
      status: 401,
      authenticate: REALM,
      message: "Sign in to view invoice holds.",
    };
  }
  return { ok: true, status: 200 };
}

function writeDenied(res, decision) {
  var headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  };
  if (decision && decision.authenticate) {
    headers["WWW-Authenticate"] = decision.authenticate;
  }
  res.writeHead(decision && decision.status ? decision.status : 401, headers);
  res.end(decision && decision.message ? decision.message : "Sign in to view invoice holds.");
}

function headerFromRequest(req) {
  var headers = req && req.headers ? req.headers : {};
  var value = headers.authorization || headers.Authorization || "";
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value;
}

module.exports = {
  REALM: REALM,
  CONFIG_REQUIRED: CONFIG_REQUIRED,
  isGateEnabled: isGateEnabled,
  isLiveConfigured: isLiveConfigured,
  decodeBasic: decodeBasic,
  authorize: authorize,
  writeDenied: writeDenied,
  headerFromRequest: headerFromRequest,
};
