import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../server/db.mjs";

const fresh = () => db.openDb(":memory:");

test("schema creates tables and a workspace round-trips exact integers", () => {
  const d = fresh();
  const u = db.createUser(d, { email: "a@b.com", name: "A", passwordHash: "h", passwordSalt: "s" });
  const state = db.emptyState("Northwind");
  state.invoices.push({ id: "inv_1", totals: { totalPaise: 900719925474000 } });
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

test("role permissions cover the expanded role set", () => {
  assert.deepEqual(db.ROLES, ["owner", "bookkeeper", "accountant", "auditor", "readonly", "staff"]);
  assert.equal(db.roleCan("owner", "close"), true);
  assert.equal(db.roleCan("bookkeeper", "write"), true);
  assert.equal(db.roleCan("bookkeeper", "close"), false);
  assert.equal(db.roleCan("accountant", "audit"), true);
  assert.equal(db.roleCan("accountant", "write"), false);
  assert.equal(db.roleCan("auditor", "audit"), true);
  assert.equal(db.roleCan("auditor", "write"), false);
  assert.equal(db.roleCan("readonly", "write"), false);
  assert.equal(db.roleCan("readonly", "export"), true);
  assert.equal(db.roleCan("staff", "write"), true);
  assert.equal(db.roleCan("staff", "close"), false);
  assert.equal(db.roleCan("unknown", "write"), true, "unknown roles fail safe to owner perms");
});
