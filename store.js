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
export async function fetchConfig() { return api("/config"); }
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
