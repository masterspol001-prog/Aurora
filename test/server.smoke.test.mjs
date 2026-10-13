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
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("content-security-policy") || "", /default-src 'self'/);
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    assert.equal(cfg.mode, "production");
    const api = await fetch(`http://127.0.0.1:${port}/api/me`);
    assert.equal(api.status, 401);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
});
