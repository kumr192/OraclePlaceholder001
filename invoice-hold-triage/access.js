/**
 * Optional site gate. If APP_ACCESS_PASSWORD is set, callers must send
 * HTTP Basic auth. Any username is accepted. The password must match.
 * This is not the Oracle password, and it is never sent to the browser.
 */
var crypto = require("crypto");

var REALM = 'Basic realm="Invoice hold triage", charset="UTF-8"';

function isGateEnabled(password) {
  return password != null && String(password) !== "";
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

function authorize(header, expectedPassword) {
  if (!isGateEnabled(expectedPassword)) {
    return { ok: true };
  }
  var parsed = decodeBasic(header);
  if (!parsed || !sameSecret(parsed.password, String(expectedPassword))) {
    return {
      ok: false,
      authenticate: REALM,
      message: "Sign in to view invoice holds.",
    };
  }
  return { ok: true };
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
  isGateEnabled: isGateEnabled,
  decodeBasic: decodeBasic,
  authorize: authorize,
  headerFromRequest: headerFromRequest,
};
