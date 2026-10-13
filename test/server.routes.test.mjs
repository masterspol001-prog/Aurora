import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, emptyState } from "../server/db.mjs";
import { createApiRouter } from "../server/routes.mjs";

async function boot() {
  const db = openDb(":memory:");
  const handle = createApiRouter({ db, isSecure: () => false });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await handle(req, res, url)) return;
    res.writeHead(404); res.end("no");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server };
}

function call(base, method, path, { body, cookie, client = true } = {}) {
  const headers = {};
  if (client) headers["x-ledger-client"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const cookieFrom = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get("set-cookie")) || "";

test("register, login, me and logout", async () => {
  const { base, server } = await boot();
  let r = await call(base, "POST", "/api/auth/register", { body: { email: "a@b.com", name: "A", password: "password123" } });
  assert.equal(r.status, 201);
  const cookie = cookieFrom(r).split(";")[0];
  assert.ok(cookie.startsWith("ledger_session="));
  r = await call(base, "GET", "/api/me", { cookie });
  assert.equal((await r.json()).user.email, "a@b.com");
  r = await call(base, "POST", "/api/auth/logout", { cookie });
  assert.equal(r.status, 204);
  r = await call(base, "GET", "/api/me", { cookie });
  assert.equal(r.status, 401);
  server.close();
});

test("duplicate email is rejected and wrong password fails", async () => {
  const { base, server } = await boot();
  await call(base, "POST", "/api/auth/register", { body: { email: "a@b.com", name: "A", password: "password123" } });
  let r = await call(base, "POST", "/api/auth/register", { body: { email: "a@b.com", name: "A", password: "password123" } });
  assert.equal(r.status, 409);
  r = await call(base, "POST", "/api/auth/login", { body: { email: "a@b.com", password: "wrong" } });
  assert.equal(r.status, 401);
  server.close();
});

test("missing client header is rejected, and workspace state round-trips", async () => {
  const { base, server } = await boot();
  let r = await call(base, "POST", "/api/auth/register", { body: { email: "a@b.com", name: "A", password: "password123" } });
  const cookie = cookieFrom(r).split(";")[0];
  r = await call(base, "POST", "/api/workspaces", { body: { name: "W" }, cookie });
  assert.equal(r.status, 201);
  const ws = (await r.json()).workspace;
  r = await call(base, "GET", `/api/workspaces/${ws.id}`, { cookie });
  const got = await r.json();
  assert.equal(got.revision, 1);
  got.state.invoices.push({ id: "inv_1", number: "INV-1", clientName: "C", date: "2026-10-01", dueDate: "2026-10-15", status: "draft", lineItems: [{ description: "x", qty: 1, ratePaise: 123456789012345, gstRate: 0, hsnSac: "998314" }], totals: { totalPaise: 123456789012345 } });
  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: got.state }, cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revision, 2);
  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: got.state }, cookie });
  assert.equal(r.status, 409);
  r = await call(base, "POST", "/api/workspaces", { body: { name: "W2" }, client: false, cookie });
  assert.equal(r.status, 400);
  server.close();
});

async function seedWorkspace(base) {
  let r = await call(base, "POST", "/api/auth/register", { body: { email: "owner@x.com", name: "Owner", password: "password123" } });
  const owner = cookieFrom(r).split(";")[0];
  r = await call(base, "POST", "/api/workspaces", { body: { name: "W" }, cookie: owner });
  const ws = (await r.json()).workspace;

  await call(base, "POST", "/api/auth/register", { body: { email: "book@x.com", name: "Book", password: "password123" } });
  await call(base, "POST", "/api/auth/register", { body: { email: "ca@x.com", name: "CA", password: "password123" } });

  await call(base, "POST", `/api/workspaces/${ws.id}/members`, { body: { email: "book@x.com", role: "bookkeeper" }, cookie: owner });
  await call(base, "POST", `/api/workspaces/${ws.id}/members`, { body: { email: "ca@x.com", role: "accountant" }, cookie: owner });

  const login = async (email) => {
    const res = await call(base, "POST", "/api/auth/login", { body: { email, password: "password123" } });
    return cookieFrom(res).split(";")[0];
  };
  return { ws, owner, book: await login("book@x.com"), ca: await login("ca@x.com") };
}

test("roles are enforced on the server", async () => {
  const { base, server } = await boot();
  const { ws, owner, book, ca } = await seedWorkspace(base);

  let r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: emptyState("W") }, cookie: book });
  assert.equal(r.status, 200);

  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 2, state: emptyState("W") }, cookie: ca });
  assert.equal(r.status, 403);

  r = await call(base, "GET", `/api/workspaces/${ws.id}`, { cookie: ca });
  assert.equal(r.status, 200);

  r = await call(base, "GET", `/api/workspaces/${ws.id}/audit`, { cookie: owner });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).entries.length >= 1);

  r = await call(base, "GET", `/api/workspaces/${ws.id}/audit`, { cookie: book });
  assert.equal(r.status, 403);

  r = await call(base, "GET", `/api/workspaces/${ws.id}/audit`, { cookie: ca });
  assert.equal(r.status, 200);

  r = await call(base, "POST", `/api/workspaces/${ws.id}/members`, { body: { email: "ca@x.com", role: "bookkeeper" }, cookie: book });
  assert.equal(r.status, 403);

  server.close();
});

test("non-members are rejected and login is rate limited", async () => {
  const { base, server } = await boot();
  await call(base, "POST", "/api/auth/register", { body: { email: "owner@x.com", name: "Owner", password: "password123" } });
  const owner = cookieFrom(await call(base, "POST", "/api/auth/login", { body: { email: "owner@x.com", password: "password123" } })).split(";")[0];
  const ws = (await (await call(base, "POST", "/api/workspaces", { body: { name: "W" }, cookie: owner })).json()).workspace;

  await call(base, "POST", "/api/auth/register", { body: { email: "out@x.com", name: "Out", password: "password123" } });
  const out = cookieFrom(await call(base, "POST", "/api/auth/login", { body: { email: "out@x.com", password: "password123" } })).split(";")[0];
  let r = await call(base, "GET", `/api/workspaces/${ws.id}`, { cookie: out });
  assert.equal(r.status, 403);

  let last = 0;
  for (let i = 0; i < 11; i++) {
    last = (await call(base, "POST", "/api/auth/login", { body: { email: "owner@x.com", password: "nope" } })).status;
  }
  assert.equal(last, 429);
  server.close();
});

test("config endpoint reports the runtime mode", async () => {
  const { base, server } = await boot();
  const r = await call(base, "GET", "/api/config", { client: false });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(["production", "demo"].includes(body.mode));
  server.close();
});

test("a malformed snapshot is rejected with 422 and field paths, and is not persisted", async () => {
  const { base, server } = await boot();
  const owner = cookieFrom(await call(base, "POST", "/api/auth/register", { body: { email: "v@x.com", name: "V", password: "password123" } })).split(";")[0];
  const ws = (await (await call(base, "POST", "/api/workspaces", { body: { name: "W" }, cookie: owner })).json()).workspace;
  const bad = emptyState("W");
  bad.invoices.push({ id: "inv_1", number: "INV-1", date: "2026-10-01", status: "draft", lineItems: [{ description: "x", qty: 1, ratePaise: 9.5, gstRate: 0 }], totals: { totalPaise: 9.5 } });
  const r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: bad }, cookie: owner });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.error, "invalid_state");
  assert.ok(body.errors.some((e) => e.path.startsWith("invoices")));
  const after = await (await call(base, "GET", `/api/workspaces/${ws.id}`, { cookie: owner })).json();
  assert.equal(after.state.invoices.length, 0, "malformed state was not persisted");
  server.close();
});
