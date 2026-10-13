# FragLedger Backend (Accounts, Multi-Tenancy, Persistence, Roles, Audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-dependency Node + SQLite backend that gives the billing ledger real accounts, multiple workspaces per user, server persistence with conflict detection, server-enforced roles, and an audit log, without breaking the existing static demo or tests.

**Architecture:** One Node `http` process using built-in `node:sqlite`, serving both the JSON API (`/api/*`) and the existing static app from the same origin. State is stored per workspace as a versioned JSON snapshot with normalized `users`/`memberships`/`sessions`/`audit_log` tables. The client keeps working offline via `localStorage`; a new `store.js` adapter switches to the API only when it is reachable.

**Tech Stack:** Node 22 `http`, `node:sqlite` (`DatabaseSync`), `node:crypto` (scrypt, randomBytes, timingSafeEqual), `node:test`. No npm dependencies. No build step.

## Global Constraints

- No npm dependencies and no build step: use only Node built-ins.
- Money stays exact integer minor units; the server never performs float arithmetic on money and stores `state` verbatim.
- Do not commit anything. The user has instructed that nothing be committed. Omit every `git commit` step; leave changes staged in the working tree only.
- Do not touch other projects in `/workspace`. All paths below are under `/workspace/billing-ledger/`.
- Existing suites must stay green at all times: `node --test test/engine.test.mjs test/ui.test.mjs` (57 tests).
- Secrets/config come from env only (`LEDGER_PORT`, `LEDGER_DB`); never hardcode secrets and never read unrelated env vars.
- Roles are exactly `owner`, `bookkeeper`, `accountant`.
- Session cookie name is exactly `ledger_session`; CSRF header is exactly `x-ledger-client` with value `1`.
- Demo mode (`npm run serve`, no API) must behave exactly as before.

---

### Task 1: Database layer and schema

**Files:**
- Create: `/workspace/billing-ledger/server/db.mjs`
- Test: `/workspace/billing-ledger/test/server.db.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `openDb(file?) -> DatabaseSync`
  - `newId(prefix) -> string`, `nowIso() -> string`
  - `emptyState(name) -> object`
  - `createUser(db, {email,name,passwordHash,passwordSalt}) -> {id,email,name}`
  - `findUserByEmail(db, email) -> {id,email,name,passwordHash,passwordSalt}|null`
  - `findUserById(db, id) -> {id,email,name}|null`
  - `updateUserPassword(db, id, passwordHash, passwordSalt) -> void`
  - `createSession(db, userId, ttlDays?) -> token`
  - `getSessionUser(db, token) -> {id,email,name}|null`
  - `deleteSession(db, token) -> void`
  - `createWorkspace(db, {name, ownerUserId, state?}) -> {id,name,ownerUserId,revision,state}`
  - `getWorkspace(db, id) -> {id,name,ownerUserId,revision,state}|null`
  - `saveWorkspaceState(db, id, expectedRevision, state) -> number|null`
  - `listWorkspacesForUser(db, userId) -> Array<{id,name,revision,role}>`
  - `getMembership(db, workspaceId, userId) -> {role}|null`
  - `addMember(db, workspaceId, userId, role) -> void`
  - `updateMemberRole(db, workspaceId, userId, role) -> number`
  - `removeMember(db, workspaceId, userId) -> number`
  - `listMembers(db, workspaceId) -> Array<{userId,role,email,name}>`
  - `countOwners(db, workspaceId) -> number`
  - `appendAudit(db, {workspaceId,userId,action,detail?,ip?}) -> void`
  - `listAudit(db, workspaceId, limit?) -> Array<object>`
  - `ROLES` = `["owner","bookkeeper","accountant"]`

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/server.db.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../server/db.mjs";

const fresh = () => db.openDb(":memory:");

test("schema creates tables and a workspace round-trips exact integers", () => {
  const d = fresh();
  const u = db.createUser(d, { email: "a@b.com", name: "A", passwordHash: "h", passwordSalt: "s" });
  const state = db.emptyState("Northwind");
  state.invoices.push({ id: "inv_1", totals: { totalPaise: 900719925474099n ? 900719925474000 : 900719925474000 } });
  const ws = db.createWorkspace(d, { name: "Northwind", ownerUserId: u.id, state });
  assert.equal(ws.revision, 1);
  const back = db.getWorkspace(d, ws.id);
  assert.equal(back.state.invoices[0].totals.totalPaise, 900719925474000);
  assert.equal(db.getMembership(d, ws.id, u.id).role, "owner");
});

test("saveWorkspaceState enforces the expected revision", () => {
  const d = fresh();
  const u = db.createUser(d, { email: "a@b.com", name: "A", passwordHash: "h", passwordSalt: "s" });
  const ws = db.createWorkspace(d, { name: "W", ownerUserId: u.id });
  assert.equal(db.saveWorkspaceState(d, ws.id, 1, { ok: true }), 2);
  assert.equal(db.saveWorkspaceState(d, ws.id, 1, { ok: false }), null);
  assert.equal(db.saveWorkspaceState(d, ws.id, 2, { ok: "yes" }), 3);
});

test("sessions expire and can be deleted", () => {
  const d = fresh();
  const u = db.createUser(d, { email: "a@b.com", name: "A", passwordHash: "h", passwordSalt: "s" });
  const token = db.createSession(d, u.id);
  assert.equal(db.getSessionUser(d, token).id, u.id);
  db.deleteSession(d, token);
  assert.equal(db.getSessionUser(d, token), null);
});

test("audit rows and members list", () => {
  const d = fresh();
  const u = db.createUser(d, { email: "a@b.com", name: "A", passwordHash: "h", passwordSalt: "s" });
  const ws = db.createWorkspace(d, { name: "W", ownerUserId: u.id });
  db.appendAudit(d, { workspaceId: ws.id, userId: u.id, action: "workspace.create", detail: "W", ip: "127.0.0.1" });
  assert.equal(db.listAudit(d, ws.id).length, 1);
  assert.equal(db.listMembers(d, ws.id)[0].role, "owner");
  assert.equal(db.countOwners(d, ws.id), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/server.db.test.mjs`
Expected: FAIL with `Cannot find module '../server/db.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `/workspace/billing-ledger/server/db.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = ["owner", "bookkeeper", "accountant"];

export const newId = (prefix) => `${prefix}_${randomUUID()}`;
export const nowIso = () => new Date().toISOString();
const tokenHash = (token) => createHash("sha256").update(String(token)).digest("hex");

export function openDb(file = process.env.LEDGER_DB || ":memory:") {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, state_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT, user_id TEXT,
      action TEXT NOT NULL, detail TEXT, ip TEXT, at TEXT NOT NULL
    );
  `);
}

export function emptyState(name) {
  const period = new Date().toISOString().slice(0, 7);
  return {
    period,
    settings: { regimeId: "IN_GST", currency: "INR", country: "IN", plan: "free", onboarded: false, theme: "light", baseCurrency: "INR" },
    company: { name, gstin: "", state: "", stateName: "" },
    clients: [], invoices: [], payments: [], commitments: [], creditNotes: [], recurring: [], activity: [],
    nextInvoiceSeq: 1,
  };
}

export function createUser(db, { email, name, passwordHash, passwordSalt }) {
  const id = newId("u");
  const normalized = String(email).trim().toLowerCase();
  db.prepare("INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, normalized, name, passwordHash, passwordSalt, nowIso());
  return { id, email: normalized, name };
}

export function findUserByEmail(db, email) {
  return db.prepare("SELECT id,email,name,password_hash AS passwordHash,password_salt AS passwordSalt FROM users WHERE email=?")
    .get(String(email || "").trim().toLowerCase()) || null;
}

export function findUserById(db, id) {
  return db.prepare("SELECT id,email,name FROM users WHERE id=?").get(id) || null;
}

export function updateUserPassword(db, id, passwordHash, passwordSalt) {
  db.prepare("UPDATE users SET password_hash=?, password_salt=? WHERE id=?").run(passwordHash, passwordSalt, id);
}

export function createSession(db, userId, ttlDays = 30) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400000);
  db.prepare("INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at,last_seen) VALUES (?,?,?,?,?,?)")
    .run(newId("s"), tokenHash(token), userId, now.toISOString(), expires.toISOString(), now.toISOString());
  return token;
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    "SELECT s.id AS sid, s.expires_at AS exp, u.id AS uid, u.email AS email, u.name AS name " +
    "FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
  ).get(tokenHash(token));
  if (!row) return null;
  if (new Date(row.exp) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE id=?").run(row.sid);
    return null;
  }
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare("UPDATE sessions SET last_seen=?, expires_at=? WHERE id=?").run(nowIso(), expires, row.sid);
  return { id: row.uid, email: row.email, name: row.name };
}

export function deleteSession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
}

export function createWorkspace(db, { name, ownerUserId, state }) {
  const id = newId("ws");
  const at = nowIso();
  const json = JSON.stringify(state || emptyState(name));
  db.prepare("INSERT INTO workspaces (id,name,owner_user_id,revision,state_json,created_at,updated_at) VALUES (?,?,?,1,?,?,?)")
    .run(id, name, ownerUserId, json, at, at);
  addMember(db, id, ownerUserId, "owner");
  return getWorkspace(db, id);
}

export function getWorkspace(db, id) {
  const row = db.prepare("SELECT id,name,owner_user_id,revision,state_json FROM workspaces WHERE id=?").get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, ownerUserId: row.owner_user_id, revision: row.revision, state: JSON.parse(row.state_json) };
}

export function saveWorkspaceState(db, id, expectedRevision, state) {
  const info = db.prepare("UPDATE workspaces SET state_json=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?")
    .run(JSON.stringify(state), nowIso(), id, expectedRevision);
  if (info.changes === 0) return null;
  return db.prepare("SELECT revision FROM workspaces WHERE id=?").get(id).revision;
}

export function listWorkspacesForUser(db, userId) {
  return db.prepare(
    "SELECT w.id AS id, w.name AS name, w.revision AS revision, m.role AS role " +
    "FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at"
  ).all(userId);
}

export function getMembership(db, workspaceId, userId) {
  return db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspaceId, userId) || null;
}

export function addMember(db, workspaceId, userId, role) {
  db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)")
    .run(workspaceId, userId, role, nowIso());
}

export function updateMemberRole(db, workspaceId, userId, role) {
  return db.prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?").run(role, workspaceId, userId).changes;
}

export function removeMember(db, workspaceId, userId) {
  return db.prepare("DELETE FROM memberships WHERE workspace_id=? AND user_id=?").run(workspaceId, userId).changes;
}

export function listMembers(db, workspaceId) {
  return db.prepare(
    "SELECT m.user_id AS userId, m.role AS role, u.email AS email, u.name AS name " +
    "FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at"
  ).all(workspaceId);
}

export function countOwners(db, workspaceId) {
  return db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=? AND role='owner'").get(workspaceId).n;
}

export function appendAudit(db, { workspaceId, userId, action, detail = "", ip = "" }) {
  db.prepare("INSERT INTO audit_log (workspace_id,user_id,action,detail,ip,at) VALUES (?,?,?,?,?,?)")
    .run(workspaceId, userId, action, detail, ip, nowIso());
}

export function listAudit(db, workspaceId, limit = 100) {
  return db.prepare("SELECT id,user_id AS userId,action,detail,ip,at FROM audit_log WHERE workspace_id=? ORDER BY id DESC LIMIT ?")
    .all(workspaceId, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/server.db.test.mjs`
Expected: PASS (4 tests). A `ExperimentalWarning: SQLite` line is expected.

---

### Task 2: Auth primitives (password, cookies, session token helpers)

**Files:**
- Create: `/workspace/billing-ledger/server/auth.mjs`
- Test: `/workspace/billing-ledger/test/server.auth.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashPassword(password) -> {hash, salt}`
  - `verifyPassword(password, hash, salt) -> boolean`
  - `parseCookies(header) -> Record<string,string>`
  - `SESSION_COOKIE = "ledger_session"`
  - `sessionCookie(token, {secure?,maxAge?}) -> string`
  - `clearCookie() -> string`

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/server.auth.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, parseCookies, sessionCookie, clearCookie, SESSION_COOKIE } from "../server/auth.mjs";

test("password hashing verifies the right password only", () => {
  const { hash, salt } = hashPassword("correct horse battery");
  assert.equal(verifyPassword("correct horse battery", hash, salt), true);
  assert.equal(verifyPassword("wrong", hash, salt), false);
  assert.equal(verifyPassword("", hash, salt), false);
});

test("cookies parse and serialize safely", () => {
  assert.deepEqual(parseCookies("a=1; ledger_session=xyz; b=2"), { a: "1", ledger_session: "xyz", b: "2" });
  assert.equal(SESSION_COOKIE, "ledger_session");
  const c = sessionCookie("tok", { secure: true });
  assert.ok(c.includes("HttpOnly"));
  assert.ok(c.includes("SameSite=Strict"));
  assert.ok(c.includes("Secure"));
  assert.ok(clearCookie().includes("Max-Age=0"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/server.auth.test.mjs`
Expected: FAIL with `Cannot find module '../server/auth.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `/workspace/billing-ledger/server/auth.mjs`:

```js
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(String(password), salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = "ledger_session";

export function sessionCookie(token, { secure = false, maxAge = 2592000 } = {}) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/server.auth.test.mjs`
Expected: PASS (2 tests).

---

### Task 3: HTTP helpers and static file serving

**Files:**
- Create: `/workspace/billing-ledger/server/http.mjs`
- Create: `/workspace/billing-ledger/server/static.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sendJson(res, status, body, headers?) -> void`
  - `sendError(res, status, code, message) -> void`
  - `readJson(req, limit?) -> Promise<object>` (rejects with `err.status`, `err.code`)
  - `hasClientHeader(req) -> boolean`
  - `clientIp(req) -> string`
  - `CLIENT_HEADER = "x-ledger-client"`
  - `createStaticServer(root) -> (req, res, url) => boolean`

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/server.http.test.mjs`:

```js
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
  assert.ok((await index.text()).includes("<!DOCTYPE html>") || (await fetch(base + "/index.html")).status === 200);
  const trav = await fetch(base + "/../../etc/passwd");
  assert.equal(trav.status, 404);
  s.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/server.http.test.mjs`
Expected: FAIL with `Cannot find module '../server/http.mjs'`.

- [ ] **Step 3: Write the implementations**

Create `/workspace/billing-ledger/server/http.mjs`:

```js
export const CLIENT_HEADER = "x-ledger-client";

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body ?? {});
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), ...headers });
  res.end(data);
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message });
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
```

Create `/workspace/billing-ledger/server/static.mjs`:

```js
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

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
  return function serve(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = normalize(join(root, rel));
    if (!file.startsWith(normalize(root))) return false;
    let st;
    try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": st.size });
    createReadStream(file).pipe(res);
    return true;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/server.http.test.mjs`
Expected: PASS (2 tests).

---

### Task 4: API router (auth, workspaces, state, members, audit, rate limit, CSRF)

**Files:**
- Create: `/workspace/billing-ledger/server/routes.mjs`
- Test: `/workspace/billing-ledger/test/server.routes.test.mjs`

**Interfaces:**
- Consumes: `server/db.mjs`, `server/auth.mjs`, `server/http.mjs`.
- Produces: `createApiRouter({db, isSecure?}) -> (req, res, url) => Promise<boolean>` (returns `true` when it handled the request).

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/server.routes.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb } from "../server/db.mjs";
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
  got.state.invoices.push({ id: "inv_1", totals: { totalPaise: 123456789012345 } });
  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: got.state }, cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revision, 2);
  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: got.state }, cookie });
  assert.equal(r.status, 409);
  r = await call(base, "POST", "/api/workspaces", { body: { name: "W2" }, client: false, cookie });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/server.routes.test.mjs`
Expected: FAIL with `Cannot find module '../server/routes.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `/workspace/billing-ledger/server/routes.mjs`:

```js
import * as store from "./db.mjs";
import { hashPassword, verifyPassword, parseCookies, sessionCookie, clearCookie, SESSION_COOKIE } from "./auth.mjs";
import { sendJson, sendError, readJson, hasClientHeader, clientIp } from "./http.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60000;

export function createApiRouter({ db, isSecure = () => false }) {
  const attempts = new Map();
  const isLimited = (key) => {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) { attempts.set(key, { count: 0, resetAt: now + RATE_WINDOW_MS }); return false; }
    return entry.count >= RATE_LIMIT;
  };
  const bump = (key) => { const entry = attempts.get(key); if (entry) entry.count += 1; };

  return async function handle(req, res, url) {
    const path = url.pathname;
    if (!path.startsWith("/api/")) return false;
    const method = req.method.toUpperCase();
    try {
      const cookies = parseCookies(req.headers.cookie);
      const user = store.getSessionUser(db, cookies[SESSION_COOKIE]);
      const secure = !!isSecure(req);

      if (method !== "GET" && !hasClientHeader(req)) {
        sendError(res, 400, "missing_client_header", "Missing x-ledger-client header");
        return true;
      }

      if (path === "/api/auth/register" && method === "POST") {
        const body = await readJson(req);
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        const password = String(body.password || "");
        if (!EMAIL_RE.test(email)) { sendError(res, 400, "invalid_email", "Enter a valid email"); return true; }
        if (!name) { sendError(res, 400, "invalid_name", "Enter your name"); return true; }
        if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
          sendError(res, 400, "weak_password", `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`); return true;
        }
        if (store.findUserByEmail(db, email)) { sendError(res, 409, "email_taken", "That email is already registered"); return true; }
        const { hash, salt } = hashPassword(password);
        let created;
        try { created = store.createUser(db, { email, name, passwordHash: hash, passwordSalt: salt }); }
        catch { sendError(res, 409, "email_taken", "That email is already registered"); return true; }
        const token = store.createSession(db, created.id);
        sendJson(res, 201, { user: created }, { "set-cookie": sessionCookie(token, { secure }) });
        return true;
      }

      if (path === "/api/auth/login" && method === "POST") {
        const body = await readJson(req);
        const email = String(body.email || "").trim().toLowerCase();
        const key = `${email}|${clientIp(req)}`;
        if (isLimited(key)) { sendError(res, 429, "rate_limited", "Too many attempts. Try again later."); return true; }
        const found = store.findUserByEmail(db, email);
        const ok = found && verifyPassword(String(body.password || ""), found.passwordHash, found.passwordSalt);
        if (!ok) { bump(key); sendError(res, 401, "invalid_credentials", "Email or password is incorrect"); return true; }
        const token = store.createSession(db, found.id);
        sendJson(res, 200, { user: { id: found.id, email: found.email, name: found.name } }, { "set-cookie": sessionCookie(token, { secure }) });
        return true;
      }

      if (path === "/api/auth/logout" && method === "POST") {
        store.deleteSession(db, cookies[SESSION_COOKIE]);
        sendJson(res, 204, {}, { "set-cookie": clearCookie() });
        return true;
      }

      if (!user) { sendError(res, 401, "unauthenticated", "Sign in to continue"); return true; }

      if (path === "/api/me" && method === "GET") {
        sendJson(res, 200, { user, memberships: store.listWorkspacesForUser(db, user.id) });
        return true;
      }

      if (path === "/api/auth/password" && method === "POST") {
        const body = await readJson(req);
        const full = store.findUserByEmail(db, user.email);
        if (!verifyPassword(String(body.currentPassword || ""), full.passwordHash, full.passwordSalt)) {
          sendError(res, 401, "invalid_credentials", "Current password is incorrect"); return true;
        }
        const next = String(body.newPassword || "");
        if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) {
          sendError(res, 400, "weak_password", `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`); return true;
        }
        const { hash, salt } = hashPassword(next);
        store.updateUserPassword(db, user.id, hash, salt);
        sendJson(res, 204, {});
        return true;
      }

      if (path === "/api/workspaces" && method === "GET") {
        sendJson(res, 200, { workspaces: store.listWorkspacesForUser(db, user.id) });
        return true;
      }

      if (path === "/api/workspaces" && method === "POST") {
        const body = await readJson(req);
        const name = String(body.name || "").trim();
        if (!name) { sendError(res, 400, "invalid_name", "Enter a workspace name"); return true; }
        const ws = store.createWorkspace(db, { name, ownerUserId: user.id });
        store.appendAudit(db, { workspaceId: ws.id, userId: user.id, action: "workspace.create", detail: name, ip: clientIp(req) });
        sendJson(res, 201, { workspace: { id: ws.id, name: ws.name, role: "owner", revision: ws.revision } });
        return true;
      }

      const match = path.match(/^\/api\/workspaces\/([^/]+)(\/[^/]*)?$/);
      if (match) {
        const wsId = decodeURIComponent(match[1]);
        const sub = match[2] || "";
        const ws = store.getWorkspace(db, wsId);
        if (!ws) { sendError(res, 404, "not_found", "Workspace not found"); return true; }
        const membership = store.getMembership(db, wsId, user.id);
        if (!membership) { sendError(res, 403, "forbidden", "You are not a member of this workspace"); return true; }
        const role = membership.role;
        const canWrite = role === "owner" || role === "bookkeeper";

        if (sub === "" && method === "GET") {
          sendJson(res, 200, { meta: { id: ws.id, name: ws.name, ownerUserId: ws.ownerUserId, role }, revision: ws.revision, state: ws.state });
          return true;
        }

        if (sub === "/state" && method === "PUT") {
          if (!canWrite) { sendError(res, 403, "forbidden", "Your role cannot change ledger data"); return true; }
          const body = await readJson(req);
          if (typeof body.revision !== "number" || !body.state || typeof body.state !== "object") {
            sendError(res, 400, "invalid_state", "revision and state are required"); return true;
          }
          const revision = store.saveWorkspaceState(db, wsId, body.revision, body.state);
          if (revision === null) { sendError(res, 409, "revision_conflict", "This workspace changed since you loaded it"); return true; }
          store.appendAudit(db, { workspaceId: wsId, userId: user.id, action: "workspace.save", detail: `revision ${revision}`, ip: clientIp(req) });
          sendJson(res, 200, { revision });
          return true;
        }

        if (sub === "/audit" && method === "GET") {
          if (role !== "owner" && role !== "accountant") { sendError(res, 403, "forbidden", "Your role cannot view the audit log"); return true; }
          const limit = Math.min(500, Number(url.searchParams.get("limit")) || 100);
          sendJson(res, 200, { entries: store.listAudit(db, wsId, limit) });
          return true;
        }

        if (sub === "/members" && method === "GET") {
          sendJson(res, 200, { members: store.listMembers(db, wsId) });
          return true;
        }

        if (sub === "/members" && method === "POST") {
          if (role !== "owner") { sendError(res, 403, "forbidden", "Only an owner can manage members"); return true; }
          const body = await readJson(req);
          const target = store.findUserByEmail(db, String(body.email || ""));
          if (!target) { sendError(res, 404, "user_not_found", "No registered user with that email"); return true; }
          const newRole = String(body.role || "bookkeeper");
          if (!store.ROLES.includes(newRole)) { sendError(res, 400, "invalid_role", "Unknown role"); return true; }
          if (store.getMembership(db, wsId, target.id)) { sendError(res, 409, "already_member", "That user is already a member"); return true; }
          store.addMember(db, wsId, target.id, newRole);
          store.appendAudit(db, { workspaceId: wsId, userId: user.id, action: "member.add", detail: `${target.email} as ${newRole}`, ip: clientIp(req) });
          sendJson(res, 201, { members: store.listMembers(db, wsId) });
          return true;
        }

        const memberMatch = sub.match(/^\/members\/([^/]+)$/);
        if (memberMatch) {
          if (role !== "owner") { sendError(res, 403, "forbidden", "Only an owner can manage members"); return true; }
          const targetId = decodeURIComponent(memberMatch[1]);
          if (method === "PATCH") {
            const body = await readJson(req);
            const newRole = String(body.role || "");
            if (!store.ROLES.includes(newRole)) { sendError(res, 400, "invalid_role", "Unknown role"); return true; }
            if (store.getMembership(db, wsId, targetId)?.role === "owner" && newRole !== "owner" && store.countOwners(db, wsId) <= 1) {
              sendError(res, 400, "last_owner", "A workspace must keep at least one owner"); return true;
            }
            if (!store.updateMemberRole(db, wsId, targetId, newRole)) { sendError(res, 404, "not_found", "Member not found"); return true; }
            store.appendAudit(db, { workspaceId: wsId, userId: user.id, action: "member.role", detail: `${targetId} -> ${newRole}`, ip: clientIp(req) });
            sendJson(res, 200, { members: store.listMembers(db, wsId) });
            return true;
          }
          if (method === "DELETE") {
            if (store.getMembership(db, wsId, targetId)?.role === "owner" && store.countOwners(db, wsId) <= 1) {
              sendError(res, 400, "last_owner", "A workspace must keep at least one owner"); return true;
            }
            if (!store.removeMember(db, wsId, targetId)) { sendError(res, 404, "not_found", "Member not found"); return true; }
            store.appendAudit(db, { workspaceId: wsId, userId: user.id, action: "member.remove", detail: targetId, ip: clientIp(req) });
            sendJson(res, 204, {});
            return true;
          }
        }
      }

      sendError(res, 404, "not_found", "No such API route");
      return true;
    } catch (err) {
      const status = err.status || 500;
      sendError(res, status, err.code || "server_error", err.status ? err.message : "Unexpected server error");
      return true;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/server.routes.test.mjs`
Expected: PASS (3 tests).

---

### Task 5: Role enforcement, audit access, and rate limiting tests

**Files:**
- Modify: `/workspace/billing-ledger/test/server.routes.test.mjs` (append tests)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: no new code; proves the permission matrix and limits.

- [ ] **Step 1: Append the failing tests**

Add to `/workspace/billing-ledger/test/server.routes.test.mjs`:

```js
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

  let r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 1, state: { ok: 1 } }, cookie: book });
  assert.equal(r.status, 200);

  r = await call(base, "PUT", `/api/workspaces/${ws.id}/state`, { body: { revision: 2, state: { ok: 2 } }, cookie: ca });
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
```

- [ ] **Step 2: Run tests to verify they fail or pass correctly**

Run: `cd /workspace/billing-ledger && node --test test/server.routes.test.mjs`
Expected: PASS for all 5 tests (the implementation from Task 4 already supports them; if any fail, fix `server/routes.mjs` until green). Rate-limit note: the earlier successful `owner` logins count toward the window, so keep the loop at 11 attempts as written.

---

### Task 6: Server entry point and scripts

**Files:**
- Create: `/workspace/billing-ledger/server/index.mjs`
- Create: `/workspace/billing-ledger/server/.gitignore`
- Modify: `/workspace/billing-ledger/package.json`
- Test: `/workspace/billing-ledger/test/server.smoke.test.mjs`

**Interfaces:**
- Consumes: `openDb`, `createApiRouter`, `createStaticServer`.
- Produces: a runnable process via `npm run server`.

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/server.smoke.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("server starts, serves the app and the API on one port", async () => {
  const port = 8199;
  const child = spawn(process.execPath, [join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, LEDGER_PORT: String(port), LEDGER_DB: ":memory:" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      new Promise((resolve) => {
        const poll = async () => {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/api/me`);
            if (r.status === 401) return resolve();
          } catch { /* not up yet */ }
          setTimeout(poll, 100);
        };
        poll();
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("server did not start")), 8000)),
    ]);
    const page = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.equal(page.status, 200);
    const api = await fetch(`http://127.0.0.1:${port}/api/me`);
    assert.equal(api.status, 401);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/server.smoke.test.mjs`
Expected: FAIL with `server did not start` (no `server/index.mjs` yet).

- [ ] **Step 3: Write the implementation**

Create `/workspace/billing-ledger/server/index.mjs`:

```js
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.mjs";
import { createApiRouter } from "./routes.mjs";
import { createStaticServer } from "./static.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = Number(process.env.LEDGER_PORT || 8091);
const dbFile = process.env.LEDGER_DB || join(here, "data", "ledger.db");

const db = openDb(dbFile);
const handleApi = createApiRouter({
  db,
  isSecure: (req) => String(req.headers["x-forwarded-proto"] || "").includes("https"),
});
const serveStatic = createStaticServer(root);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (await handleApi(req, res, url)) return;
  if (serveStatic(req, res, url)) return;
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`FragLedger server listening on http://localhost:${port}`);
});
```

Create `/workspace/billing-ledger/server/.gitignore`:

```
data/
```

Modify `/workspace/billing-ledger/package.json` `scripts` to add `server` (and a combined test script):

```json
  "scripts": {
    "test": "node --test test/engine.test.mjs test/ui.test.mjs",
    "test:server": "node --test test/server.db.test.mjs test/server.auth.test.mjs test/server.http.test.mjs test/server.routes.test.mjs test/server.smoke.test.mjs",
    "test:all": "node --test test/engine.test.mjs test/ui.test.mjs test/server.db.test.mjs test/server.auth.test.mjs test/server.http.test.mjs test/server.routes.test.mjs test/server.smoke.test.mjs",
    "serve": "python3 -m http.server 8090",
    "server": "node server/index.mjs"
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/server.smoke.test.mjs`
Expected: PASS (1 test).

Also run: `cd /workspace/billing-ledger && npm run test:server`
Expected: all server tests PASS.

---

### Task 7: Client storage adapter (`store.js`)

**Files:**
- Create: `/workspace/billing-ledger/store.js`
- Test: `/workspace/billing-ledger/test/store.test.mjs`

**Interfaces:**
- Consumes: browser `fetch`; Node test stubs `globalThis.fetch`.
- Produces (all exported from `store.js`):
  - `initStore({root}) -> Promise<"server"|"demo">`
  - `storeMode() -> "server"|"demo"`
  - `loadWorkspace() -> Promise<{state, revision, workspaceId}|null>`
  - `saveWorkspace(state) -> Promise<number>` (returns new revision; throws `{status:409}` on conflict, `{status:401}` when unauthenticated)
  - `currentUser() -> object|null`
  - `setCurrentUser(user) -> void`
  - `activeWorkspaceId() -> string|null`
  - `setActiveWorkspace(id) -> Promise<void>`
  - `listWorkspaces() -> Promise<Array<object>>`
  - `createWorkspace(name) -> Promise<object>`
  - `signIn(email, password) -> Promise<object>`
  - `signOut() -> Promise<void>`
  - `demoLoad() -> object|null`, `demoSave(state) -> void`

- [ ] **Step 1: Write the failing test**

Create `/workspace/billing-ledger/test/store.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

function fetchStub(handler) {
  return async (url, options = {}) => {
    const res = await handler(String(url), options);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: () => null },
      json: async () => res.body ?? {},
      text: async () => JSON.stringify(res.body ?? {}),
    };
  };
}

test("demo fallback when API is absent", async () => {
  globalThis.fetch = fetchStub(() => ({ status: 404, body: {} }));
  const store = await import(`../store.js?demo=${Date.now()}`);
  const mode = await store.initStore();
  assert.equal(mode, "demo");
  assert.equal(store.storeMode(), "demo");
  store.demoSave({ hello: 1 });
  assert.deepEqual(store.demoLoad(), { hello: 1 });
});

test("server mode loads and saves with revision", async () => {
  const calls = [];
  globalThis.fetch = fetchStub((url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/me")) return { status: 401, body: { error: "unauthenticated" } };
    if (url.endsWith("/api/workspaces")) return { status: 200, body: { workspaces: [{ id: "ws_1", name: "W", role: "owner", revision: 1 }] } };
    if (url.includes("/api/workspaces/ws_1") && (!options.method || options.method === "GET")) {
      return { status: 200, body: { meta: { id: "ws_1", name: "W", role: "owner" }, revision: 4, state: { clients: [] } } };
    }
    if (options.method === "PUT") return { status: 200, body: { revision: 5 } };
    return { status: 404, body: {} };
  });
  const store = await import(`../store.js?server=${Date.now()}`);
  const mode = await store.initStore();
  assert.equal(mode, "server");
  const loaded = await store.loadWorkspace();
  assert.equal(loaded.revision, 4);
  assert.deepEqual(loaded.state, { clients: [] });
  const rev = await store.saveWorkspace({ clients: [{ id: "c1" }] });
  assert.equal(rev, 5);
  const put = calls.find((c) => c.options.method === "PUT");
  assert.equal(JSON.parse(put.options.body).revision, 4);
  assert.equal(put.options.headers["x-ledger-client"], "1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && node --test test/store.test.mjs`
Expected: FAIL with `Cannot find module '../store.js'`.

- [ ] **Step 3: Write the implementation**

Create `/workspace/billing-ledger/store.js`:

```js
const LS_KEY = "fragledger.v1";
const LS_WS = "fragledger.ws";

let mode = "demo";
let revision = 1;
let workspaceId = null;
let user = null;

const hasStorage = () => {
  try { return typeof localStorage !== "undefined"; } catch { return false; }
};
const lsGet = (k) => { try { return hasStorage() ? localStorage.getItem(k) : null; } catch { return null; } };
const lsSet = (k, v) => { try { if (hasStorage()) localStorage.setItem(k, v); } catch { /* ignore */ } };

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "x-ledger-client": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || res.statusText), { status: res.status, code: data.error, body: data });
  return data;
}

export async function initStore() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.status === 404) { mode = "demo"; return mode; }
    mode = "server";
    if (res.ok) {
      const me = await res.json();
      user = me.user || null;
      const ws = me.memberships && me.memberships[0];
      if (ws) workspaceId = ws.id;
    }
  } catch { mode = "demo"; }
  if (mode === "server" && !workspaceId) workspaceId = lsGet(LS_WS);
  return mode;
}

export const storeMode = () => mode;
export const currentUser = () => user;
export const setCurrentUser = (u) => { user = u; };
export const activeWorkspaceId = () => workspaceId;
export async function setActiveWorkspace(id) { workspaceId = id; lsSet(LS_WS, id); }

export async function signIn(email, password) {
  const data = await api("/auth/login", { method: "POST", body: { email, password } });
  user = data.user || null;
  const list = await listWorkspaces();
  workspaceId = list[0] ? list[0].id : null;
  if (workspaceId) lsSet(LS_WS, workspaceId);
  return user;
}

export async function signOut() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  user = null;
  workspaceId = null;
}

export async function listWorkspaces() {
  const data = await api("/workspaces");
  return data.workspaces || [];
}

export async function createWorkspace(name) {
  const data = await api("/workspaces", { method: "POST", body: { name } });
  workspaceId = data.workspace.id;
  lsSet(LS_WS, workspaceId);
  return data.workspace;
}

export async function loadWorkspace() {
  if (mode === "demo") return demoLoad() ? { state: demoLoad(), revision: 1, workspaceId: "demo" } : null;
  if (!workspaceId) {
    const list = await listWorkspaces();
    workspaceId = list[0] ? list[0].id : null;
    if (workspaceId) lsSet(LS_WS, workspaceId);
  }
  if (!workspaceId) return null;
  const data = await api(`/workspaces/${encodeURIComponent(workspaceId)}`);
  revision = data.revision;
  return { state: data.state, revision, workspaceId, meta: data.meta };
}

export async function saveWorkspace(state) {
  if (mode === "demo") { demoSave(state); return 1; }
  const data = await api(`/workspaces/${encodeURIComponent(workspaceId)}/state`, { method: "PUT", body: { revision, state } });
  revision = data.revision;
  return revision;
}

export function demoSave(state) { lsSet(LS_KEY, JSON.stringify(state)); }
export function demoLoad() {
  const raw = lsGet(LS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/billing-ledger && node --test test/store.test.mjs`
Expected: PASS (2 tests).

---

### Task 8: Wire the client to the adapter (demo path unchanged)

**Files:**
- Modify: `/workspace/billing-ledger/index.html`
- Test: existing `/workspace/billing-ledger/test/ui.test.mjs` must stay green; add one case.

**Interfaces:**
- Consumes: `store.js` named exports from Task 7.
- Produces: `index.html` uses `loadWorkspace`/`saveWorkspace` when present, else the current `localStorage` path.

- [ ] **Step 1: Add the failing UI test**

In `/workspace/billing-ledger/test/ui.test.mjs`, find where the script is extracted and evaluated. Immediately after the module is evaluated and before the first test, add:

```js
test("exposes the storage adapter hook without breaking demo mode", () => {
  assert.equal(typeof app.__frag.saveNow, "function");
  assert.equal(app.__frag.storeMode === undefined ? "demo" : app.__frag.storeMode(), "demo");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/billing-ledger && npm test`
Expected: FAIL on the new test because `__frag.saveNow` is not defined.

- [ ] **Step 3: Modify `index.html` minimally**

Make these three edits.

1. At the top of the module script, after the `engine.js` import block, add a dynamic, optional import that never throws in demo/test:

```js
let storeAdapter = null;
try {
  storeAdapter = await import("./store.js");
} catch (e) {
  storeAdapter = null;
}
const __serverMode = !!(storeAdapter && (await storeAdapter.initStore()) === "server");
```

2. Replace the body of `saveState()` so it persists through the adapter when in server mode, and fires a conflict/401 handler otherwise:

```js
function saveState() {
  const { view, role, settings, ui, company, period, clients, invoices, payments, commitments, creditNotes, recurring, activity, nextInvoiceSeq } = state;
  const payload = { view, role, settings, ui, company, period, clients, invoices, payments, commitments, creditNotes, recurring, activity, nextInvoiceSeq };
  if (__serverMode) {
    storeAdapter.saveWorkspace(payload).catch((err) => {
      if (err && err.status === 409) toast("This workspace changed elsewhere. Reload to get the latest.", "err");
      else if (err && err.status === 401) toast("Your session expired. Sign in again.", "err");
    });
    return;
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (e) { /* storage unavailable: keep working in memory */ }
}
```

3. In `boot()`, when `__serverMode`, load from the adapter before falling back to `localStorage`:

```js
async function boot() {
  let saved = null;
  if (__serverMode) {
    try { const loaded = await storeAdapter.loadWorkspace(); if (loaded && loaded.state) saved = loaded.state; } catch (e) { saved = null; }
  }
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; } }
  if (saved && Array.isArray(saved.invoices)) {
    Object.assign(state, saved);
    state.settings = { regimeId: "IN_GST", currency: "INR", country: "IN", plan: "free", onboarded: false, theme: "light", baseCurrency: "INR", ...(saved.settings || {}) };
    state.ui = { railCollapsed: false, ...(saved.ui || {}) };
    const ids = [...state.invoices, ...state.payments, ...state.commitments, ...state.clients, ...(state.creditNotes || []), ...(state.recurring || [])]
      .map((o) => String(o.id || "")).join(",").match(/\d+/g) || [];
    if (ids.length) uid = Math.max(1000, ...ids.map(Number));
  } else {
    seed();
  }
  if (!state.period) state.period = PERIOD;
}
await boot();
```

4. Add `saveNow` and `storeMode` to the debug surface (find the `globalThis.__frag = {...}` line) so the test can reach them:

```js
globalThis.__frag = { state, render, PLANS, planLimit, docCount, taxNoun, isGstRegime, toggleTheme, openPalette, actionItems, invStatus, voidInvoice, importCsvRows, statementRows, invoiceDocumentHtml, invoiceMailto, generateRecurring, recurringDue, dueRecurringCount, baseEquivalent, taxTreatmentLabel, saveNow: saveState, storeMode: () => (storeAdapter ? storeAdapter.storeMode() : "demo") };
```

Note: `boot()` becomes async and is awaited at top level; the module already runs as `type="module"`, so top-level await is valid. The UI test harness evaluates the module and must await its completion; confirm it already awaits (it does, because other top-level work runs before tests). If the harness does not await, wrap the `await boot()` in the same microtask chain the harness uses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /workspace/billing-ledger && npm test`
Expected: PASS (58 tests: the original 57 plus the new one).

Run: `cd /workspace/billing-ledger && node --test test/store.test.mjs`
Expected: PASS (2 tests).

---

### Task 9: Server-mode shell (sign-in, workspace switcher) and docs

**Files:**
- Modify: `/workspace/billing-ledger/index.html`
- Modify: `/workspace/billing-ledger/README.md`
- Modify: `/workspace/billing-ledger/docs/BACKLOG.md`

**Interfaces:**
- Consumes: `store.js` exports and `__serverMode` from Task 8.
- Produces: a sign-in screen and workspace switcher shown only in server mode; documentation.

- [ ] **Step 1: Add the server-mode sign-in gate**

In `index.html`, inside `render()`, before rendering views, add a guard so server mode without a session shows a sign-in card instead of the app:

```js
function renderSignIn(msg = "") {
  el("view").innerHTML = `
    <div class="card" style="max-width:420px;margin:8vh auto">
      <div class="card-h"><h2>Sign in</h2></div>
      <div class="card-b">
        ${msg ? `<div class="flag">${esc(msg)}</div>` : ""}
        <div class="field"><label class="f">Email</label><input id="si_email" autocomplete="email"></div>
        <div class="field"><label class="f">Password</label><input id="si_pass" type="password" autocomplete="current-password"></div>
        <div class="toolbar"><button class="btn primary" id="si_go">Sign in</button><button class="btn" id="si_reg">Create account</button></div>
        <div class="subtle" style="margin-top:10px">Server mode stores data on the server. Nothing is shared until you add members.</div>
      </div>
    </div>`;
  el("si_go").onclick = async () => {
    try { await storeAdapter.signIn(el("si_email").value.trim(), el("si_pass").value); location.reload(); }
    catch (e) { renderSignIn(e.message || "Could not sign in"); }
  };
  el("si_reg").onclick = async () => {
    try {
      await fetch("/api/auth/register", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-ledger-client": "1" }, body: JSON.stringify({ email: el("si_email").value.trim(), name: el("si_email").value.trim(), password: el("si_pass").value }) });
      await storeAdapter.signIn(el("si_email").value.trim(), el("si_pass").value);
      location.reload();
    } catch (e) { renderSignIn(e.message || "Could not create the account"); }
  };
}
```

At the start of `render()` add:

```js
if (__serverMode && storeAdapter && !storeAdapter.currentUser()) { renderSignIn(); return; }
```

- [ ] **Step 2: Add the workspace switcher to the topbar**

In `renderTopbar()`, when `__serverMode`, prepend a select listing `await`-loaded workspaces and a "New workspace" button. Because `renderTopbar` is synchronous, cache the list at boot:

In the boot block after `await boot();`, add:

```js
let workspaceOptions = [];
if (__serverMode && storeAdapter && storeAdapter.currentUser()) {
  try { workspaceOptions = await storeAdapter.listWorkspaces(); } catch (e) { workspaceOptions = []; }
}
```

Then in `renderTopbar()` prepend:

```js
${__serverMode && workspaceOptions.length ? `<select id="ws_switch" aria-label="Workspace">${workspaceOptions.map((w) => `<option value="${w.id}" ${w.id === storeAdapter.activeWorkspaceId() ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select><button class="btn sm" id="ws_new">+ Workspace</button>` : ""}
```

Wire it at the end of `renderTopbar()`:

```js
const wsw = el("ws_switch"); if (wsw) wsw.onchange = async () => { await storeAdapter.setActiveWorkspace(wsw.value); location.reload(); };
const wsn = el("ws_new"); if (wsn) wsn.onclick = async () => { const name = prompt("Workspace name"); if (name) { await storeAdapter.createWorkspace(name); location.reload(); } };
```

`activeWorkspaceId()` and `setActiveWorkspace(id)` are already defined in Task 7.

- [ ] **Step 3: Verify manually and with tests**

Run: `cd /workspace/billing-ledger && npm test`
Expected: PASS (58 tests; demo mode unaffected).

Run the server and smoke-check with curl:

```bash
cd /workspace/billing-ledger
LEDGER_PORT=8091 LEDGER_DB=:memory: npm run server &
curl -s -o /dev/null -w "index %{http_code}\n" http://127.0.0.1:8091/index.html
curl -s -o /dev/null -w "api %{http_code}\n" http://127.0.0.1:8091/api/me
```

Expected: `index 200` and `api 401`.

- [ ] **Step 4: Update docs**

In `README.md`, add a "Server mode (accounts + persistence)" section:

```markdown
## Server mode (accounts + persistence)

```bash
# Demo: static app, data in this browser only
npm run serve

# Server: accounts, multiple workspaces, server persistence, roles, audit log
npm run server
# then open http://localhost:8091
```

Server mode uses a zero-dependency Node + SQLite backend (`server/`). The first
registered user creates a workspace and becomes its owner. Roles: owner (all,
manages members), bookkeeper (all ledger writes, no member management),
accountant (read + reports + audit only). Concurrent edits are caught with a
revision conflict (HTTP 409) rather than silently overwriting. Data lives in
`server/data/ledger.db` (gitignored). Set `LEDGER_PORT` and `LEDGER_DB` to
change the port and file.
```

In `docs/BACKLOG.md`, mark item 10 and item 13 as done once the tasks pass:

```markdown
- P1 item 10 (auth + enforced roles + audit) and P2 item 13 (server-side
  persistence) **done** in the backend increment (zero-dep Node + node:sqlite,
  workspaces + memberships, revision conflict detection, audit log). See
  `docs/superpowers/specs/2026-09-19-backend-auth-persistence-design.md`.
```

- [ ] **Step 5: Full verification**

Run: `cd /workspace/billing-ledger && npm run test:all`
Expected: engine (36) + UI (22) + server suites all PASS.

Run: `cd /workspace/billing-ledger && node /tmp/opencode/frag-audit.mjs`
Expected: `0 findings`.

---

## Self-Review

- Spec coverage: architecture (Tasks 6, 9), data model (Task 1), API surface (Task 4), auth/sessions (Tasks 2, 4), roles (Tasks 4, 5), client adapter (Tasks 7, 8), audit (Tasks 1, 4, 5), error handling (Tasks 3, 4), validation/money safety (Tasks 1, 4), testing (all tasks, Task 9 step 5), risks/rollout (Task 9 docs). Covered.
- Placeholder scan: no TBD/TODO; every code step contains full code or exact edits.
- Type consistency: `openDb`, `createWorkspace`, `saveWorkspaceState`, `getMembership`, `createApiRouter`, `sendJson`, and the `store.js` exports (`initStore`, `loadWorkspace`, `saveWorkspace`, `activeWorkspaceId`, `setActiveWorkspace`) are used consistently across tasks.
- Commit steps intentionally omitted per the Global Constraint that nothing be committed.
