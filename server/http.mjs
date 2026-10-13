export const CLIENT_HEADER = "x-ledger-client";

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Applies conservative security headers to every response. The inline module
// script and inline styles in the single-file client require 'unsafe-inline';
// everything else is locked to the same origin.
export function applySecurityHeaders(res, { secure = false } = {}) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("content-security-policy", CSP);
  if (secure) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body ?? {});
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), ...headers });
  res.end(data);
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message });
}

export function sendRedirect(res, location, headers = {}) {
  res.writeHead(302, { location, "cache-control": "no-store", ...headers });
  res.end();
}

export function readJson(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413, code: "payload_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400, code: "bad_json" })); }
    });
    req.on("error", reject);
  });
}

export const hasClientHeader = (req) => req.headers[CLIENT_HEADER] === "1";

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}
