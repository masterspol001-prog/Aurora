import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.mjs";
import { createApiRouter } from "./routes.mjs";
import { createStaticServer } from "./static.mjs";
import { applySecurityHeaders } from "./http.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = Number(process.env.LEDGER_PORT || 8091);
const dbFile = process.env.LEDGER_DB || join(here, "data", "ledger.db");

const db = openDb(dbFile);
const handleApi = createApiRouter({
  db,
  isSecure: (req) => String(req.headers["x-forwarded-proto"] || "").includes("https"),
  mode: process.env.LEDGER_MODE || "production",
});
const serveStatic = createStaticServer(root);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  applySecurityHeaders(res, { secure: String(req.headers["x-forwarded-proto"] || "").includes("https") });
  if (await handleApi(req, res, url)) return;
  if (serveStatic(req, res, url)) return;
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`FragLedger server listening on http://localhost:${port}`);
});
