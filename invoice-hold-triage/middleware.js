/**
 * Vercel edge gate for the page and the API.
 * The password check matches access.js: any username, APP_ACCESS_PASSWORD.
 * Oracle credentials are not read here.
 */

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

export default function middleware(request) {
  var path = new URL(request.url).pathname;
  if (path === "/favicon.ico") {
    return;
  }
  var expected = process.env.APP_ACCESS_PASSWORD;
  if (!isGateEnabled(expected)) {
    return;
  }
  var password = decodeBasic(request.headers.get("authorization"));
  if (password != null && sameSecret(password, expected)) {
    return;
  }
  return new Response("Sign in to view invoice holds.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: "/:path*",
};
