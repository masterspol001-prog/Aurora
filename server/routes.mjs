import { randomBytes } from "node:crypto";
import * as store from "./db.mjs";
import { hashPassword, verifyPassword, parseCookies, sessionCookie, clearCookie, SESSION_COOKIE, OAUTH_STATE_COOKIE, oauthStateCookie, clearOAuthStateCookie, safeEqual } from "./auth.mjs";
import { sendJson, sendError, sendRedirect, readJson, hasClientHeader, clientIp } from "./http.mjs";
import { validateWorkspace } from "./validate.mjs";
import { googleConfig, makePkce, authUrl, signInWithGoogle } from "./google.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60000;

export function createApiRouter({ db, isSecure = () => false, google = googleConfig(), fetchImpl = fetch, mode = "production" }) {
  const attempts = new Map();
  const runtimeMode = mode === "demo" ? "demo" : "production";
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
    if (path === "/api/config" && method === "GET") {
      sendJson(res, 200, { mode: runtimeMode, serverTime: new Date().toISOString(), version: 1 });
      return true;
    }
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

      if (path === "/api/auth/google/config" && method === "GET") {
        sendJson(res, 200, { enabled: !!google.enabled, startUrl: "/api/auth/google/start" });
        return true;
      }

      if (path === "/api/auth/google/start" && method === "GET") {
        if (!google.enabled) { sendRedirect(res, "/?google_error=google_disabled"); return true; }
        const state = randomBytes(32).toString("hex");
        const { verifier, challenge } = makePkce();
        store.saveOAuthState(db, state, verifier);
        sendRedirect(res, authUrl({ clientId: google.clientId, redirectUri: google.redirectUri, state, codeChallenge: challenge }),
          { "set-cookie": oauthStateCookie(state, { secure }) });
        return true;
      }

      if (path === "/api/auth/google/callback" && method === "GET") {
        const fail = (code) => sendRedirect(res, `/?google_error=${encodeURIComponent(code)}`, { "set-cookie": clearOAuthStateCookie() });
        if (!google.enabled) { fail("google_disabled"); return true; }
        const code = url.searchParams.get("code") || "";
        const stateParam = url.searchParams.get("state") || "";
        const cookieState = cookies[OAUTH_STATE_COOKIE] || "";
        if (!code || !stateParam || !safeEqual(stateParam, cookieState)) { fail("invalid_state"); return true; }
        const saved = store.consumeOAuthState(db, stateParam);
        if (!saved) { fail("invalid_state"); return true; }
        let result;
        try { result = await signInWithGoogle({ db, config: google, code, codeVerifier: saved.codeVerifier, fetchImpl }); }
        catch { result = { ok: false, error: "google_unavailable" }; }
        if (!result.ok) { fail(result.error); return true; }
        const token = store.createSession(db, result.user.id);
        store.appendAudit(db, { workspaceId: null, userId: result.user.id, action: "auth.google", detail: result.user.email, ip: clientIp(req) });
        sendRedirect(res, "/", { "set-cookie": [sessionCookie(token, { secure }), clearOAuthStateCookie()] });
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
        const canWrite = store.roleCan(role, "write");

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
          const check = validateWorkspace(body.state);
          if (!check.valid) {
            sendJson(res, 422, { error: "invalid_state", message: "The workspace did not pass validation", errors: check.errors });
            return true;
          }
          const revision = store.saveWorkspaceState(db, wsId, body.revision, body.state);
          if (revision === null) { sendError(res, 409, "revision_conflict", "This workspace changed since you loaded it"); return true; }
          store.appendAudit(db, { workspaceId: wsId, userId: user.id, action: "workspace.save", detail: `revision ${revision}`, ip: clientIp(req) });
          sendJson(res, 200, { revision });
          return true;
        }

        if (sub === "/audit" && method === "GET") {
          if (!store.roleCan(role, "audit")) { sendError(res, 403, "forbidden", "Your role cannot view the audit log"); return true; }
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
