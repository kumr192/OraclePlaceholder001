/**
 * Vercel edge gate for the page and the API.
 * The password check matches access.js: any username, APP_ACCESS_PASSWORD.
 * Live Oracle settings without that access password fail closed.
 * The Oracle password is never written to the response.
 */

var REALM = 'Basic realm="Invoice hold triage", charset="UTF-8"';

var CONFIG_REQUIRED = "config-required. Set APP_ACCESS_PASSWORD before loading live holds.";

function isGateEnabled(password) {
  return password != null && String(password) !== "";
}

function isLiveConfigured(env) {
  var source = env || {};
  var url = String(source.ORACLE_FUSION_URL || "").trim();
  var user = String(source.ORACLE_FUSION_USER || "").trim();
  var password = source.ORACLE_FUSION_PASSWORD;
  return Boolean(url && user && password != null && String(password) !== "");
}

function decide(env, authorizationHeader) {
  var source = env || {};
  var expected = source.APP_ACCESS_PASSWORD;
  if (!isGateEnabled(expected)) {
    if (isLiveConfigured(source)) {
      return { status: 503, message: CONFIG_REQUIRED };
    }
    return null;
  }
  var password = decodeBasic(authorizationHeader);
  if (password != null && sameSecret(password, expected)) {
    return null;
  }
  return {
    status: 401,
    authenticate: REALM,
    message: "Sign in to view invoice holds.",
  };
}

function decodeBasic(header) {
  if (!header || typeof header !== "string") {
    return null;
  }
  var match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  var binary;
  try {
    binary = atob(match[1]);
  } catch (err) {
    return null;
  }
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  var decoded = new TextDecoder().decode(bytes);
  var sep = decoded.indexOf(":");
  if (sep < 0) {
    return null;
  }
  return decoded.slice(sep + 1);
}

function sameSecret(given, expected) {
  var a = String(given);
  var b = String(expected);
  if (a.length !== b.length) {
    return false;
  }
  var mismatch = 0;
  for (var i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function responseFor(decision) {
  var headers = {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  };
  if (decision.authenticate) {
    headers["WWW-Authenticate"] = decision.authenticate;
  }
  return new Response(decision.message, {
    status: decision.status,
    headers: headers,
  });
}

export function decideRequest(env, authorizationHeader) {
  return decide(env, authorizationHeader);
}

export default function middleware(request) {
  var path = new URL(request.url).pathname;
  if (path === "/favicon.ico") {
    return;
  }
  var decision = decide(process.env, request.headers.get("authorization"));
  if (!decision) {
    return;
  }
  return responseFor(decision);
}

export const config = {
  matcher: "/:path*",
};
