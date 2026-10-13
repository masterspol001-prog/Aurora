import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createStaticServer(root) {
  const base = normalize(root);
  return function serve(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) return false;
    let st;
    try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": st.size });
    createReadStream(file).pipe(res);
    return true;
  };
}
