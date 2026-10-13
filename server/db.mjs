import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = ["owner", "bookkeeper", "accountant", "auditor", "readonly", "staff"];

export const ROLE_PERMISSIONS = {
  owner: ["write", "close", "members", "audit", "export", "approve"],
  bookkeeper: ["write", "export"],
  accountant: ["audit", "export", "approve"],
  auditor: ["audit", "export"],
  readonly: ["export"],
  staff: ["write", "export"],
};

export function roleCan(role, perm) {
  return (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.owner).includes(perm);
}

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
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("google_sub")) db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL");
}

export function emptyState(name) {
  const period = new Date().toISOString().slice(0, 7);
  return {
    period,
    settings: { regimeId: "IN_GST", currency: "INR", country: "IN", plan: "free", onboarded: false, theme: "light", baseCurrency: "INR", accountingDetail: false },
    company: { name, gstin: "", state: "", stateName: "", upiId: "" },
    clients: [], invoices: [], payments: [], commitments: [], creditNotes: [], recurring: [], activity: [], reminders: [], taxFilings: [],
    coa: [], journals: [], bankAccounts: [], bankTxns: [], expenses: [], vendors: [], bills: [], billPayments: [], subscriptions: [], periods: [],
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
  return db.prepare("SELECT id,email,name,google_sub AS googleSub,password_hash AS passwordHash,password_salt AS passwordSalt FROM users WHERE email=?")
    .get(String(email || "").trim().toLowerCase()) || null;
}

export function findUserByGoogleSub(db, googleSub) {
  return db.prepare("SELECT id,email,name FROM users WHERE google_sub=?").get(String(googleSub || "")) || null;
}

export function createGoogleUser(db, { email, name, googleSub }) {
  const id = newId("u");
  const normalized = String(email).trim().toLowerCase();
  db.prepare("INSERT INTO users (id,email,name,password_hash,password_salt,created_at,google_sub) VALUES (?,?,?,?,?,?,?)")
    .run(id, normalized, name, "", "", nowIso(), String(googleSub));
  return { id, email: normalized, name };
}

export function linkGoogleSub(db, userId, googleSub) {
  return db.prepare("UPDATE users SET google_sub=? WHERE id=?").run(String(googleSub), userId).changes;
}

export function saveOAuthState(db, state, codeVerifier) {
  db.prepare("INSERT INTO oauth_states (state,code_verifier,created_at) VALUES (?,?,?)")
    .run(String(state), String(codeVerifier), nowIso());
}

export function consumeOAuthState(db, state, ttlMs = 10 * 60000) {
  const row = db.prepare("SELECT state,code_verifier AS codeVerifier,created_at AS createdAt FROM oauth_states WHERE state=?").get(String(state));
  if (!row) return null;
  db.prepare("DELETE FROM oauth_states WHERE state=?").run(row.state);
  if (Date.now() - new Date(row.createdAt).getTime() > ttlMs) return null;
  return { codeVerifier: row.codeVerifier };
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
