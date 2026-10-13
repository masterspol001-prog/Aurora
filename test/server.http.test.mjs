import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sendJson, sendError, readJson, hasClientHeader } from "../server/http.mjs";
import { createStaticServer } from "../server/static.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function listen(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

test("http helpers serialize json and read bodies", async () => {
  const s = await listen(async (req, res) => {
    if (req.url === "/body") { const b = await readJson(req); return sendJson(res, 200, { got: b }); }
    if (req.url === "/err") return sendError(res, 403, "forbidden", "nope");
    sendJson(res, 200, { client: hasClientHeader(req) });
  });
  const port = s.address().port;
  const base = `http://127.0.0.1:${port}`;
  let r = await fetch(base + "/", { headers: { "x-ledger-client": "1" } });
  assert.deepEqual(await r.json(), { client: true });
  r = await fetch(base + "/body", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } });
  assert.deepEqual(await r.json(), { got: { a: 1 } });
  r = await fetch(base + "/err");
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "forbidden", message: "nope" });
  s.close();
});

test("static server serves index.html and blocks traversal", async () => {
  const serve = createStaticServer(root);
  const s = await listen((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (serve(req, res, url)) return;
    res.writeHead(404); res.end("no");
  });
  const port = s.address().port;
  const base = `http://127.0.0.1:${port}`;
  const index = await fetch(base + "/");
  assert.equal(index.status, 200);
  const trav = await fetch(base + "/../../etc/passwd");
  assert.equal(trav.status, 404);
  s.close();
});
