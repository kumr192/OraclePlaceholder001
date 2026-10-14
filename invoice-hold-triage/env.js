/**
 * Read Oracle sign-in settings from the environment or a local .env file.
 * Values are never printed from this module.
 */
var fs = require("fs");

function parseEnv(text) {
  var values = {};
  String(text || "").split(/\r?\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") {
      return;
    }
    var eq = trimmed.indexOf("=");
    if (eq <= 0) {
      return;
    }
    var key = trimmed.slice(0, eq).trim();
    var value = trimmed.slice(eq + 1).trim();
    if (
      (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  });
  return values;
}

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  var parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
  Object.keys(parsed).forEach(function (key) {
    if (env[key] === undefined) {
      env[key] = parsed[key];
    }
  });
}

function fusionConfig(env) {
  var source = env || {};
  var url = String(source.ORACLE_FUSION_URL || "").trim();
  var user = String(source.ORACLE_FUSION_USER || "").trim();
  var password = source.ORACLE_FUSION_PASSWORD;
  if (!url || !user || password == null || String(password) === "") {
    return null;
  }
  return {
    baseUrl: url,
    user: user,
    password: String(password),
  };
}

module.exports = {
  parseEnv: parseEnv,
  loadEnvFile: loadEnvFile,
  fusionConfig: fusionConfig,
};
