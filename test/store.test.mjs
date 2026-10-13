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
  assert.equal(store.demoLoad(), null);
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
