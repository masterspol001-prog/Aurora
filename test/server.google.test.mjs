import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { openDb } from "../server/db.mjs";
import { createApiRouter } from "../server/routes.mjs";
import { verifyPassword } from "../server/auth.mjs";
import {
  googleConfig, makePkce, authUrl, isAllowedEmail,
  decodeIdTokenClaims, verifyIdTokenClaims, exchangeCode, signInWithGoogle,
} from "../server/google.mjs";

const IDENTITY = { email: "g@x.com", name: "G User", sub: "google-sub-1" };

function idToken(claims, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: "cid", iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 600,
    email_verified: true, email: IDENTITY.email, sub: IDENTITY.sub, name: IDENTITY.name, ...claims,
  })).toString("base64url");
  return `${header}.${payload}.signature`;
}

const fakeFetch = (idTokenValue) => async () => ({
  ok: true,
  json: async () => ({ id_token: idTokenValue }),
});

test("googleConfig gates on client id + secret and parses domains", () => {
  assert.equal(googleConfig({}).enabled, false);
  assert.equal(googleConfig({ GOOGLE_CLIENT_ID: "a" }).enabled, false);
  const cfg = googleConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GOOGLE_ALLOWED_DOMAINS: " Acme.com, @x.io ", LEDGER_PORT: "9000" });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.redirectUri, "http://localhost:9000/api/auth/google/callback");
  assert.deepEqual(cfg.allowedDomains, ["acme.com", "x.io"]);
});

test("PKCE challenge is the S256 hash of the verifier", () => {
  const { verifier, challenge } = makePkce();
  assert.equal(verifier.length, 43);
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge);
});

test("authUrl carries the required OAuth parameters", () => {
  const url = new URL(authUrl({ clientId: "cid", redirectUri: "http://r/cb", state: "st", codeChallenge: "ch" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("redirect_uri"), "http://r/cb");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("code_challenge"), "ch");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
});

test("isAllowedEmail honours the domain allowlist", () => {
  assert.equal(isAllowedEmail("a@x.com", []), true);
  assert.equal(isAllowedEmail("a@acme.com", ["acme.com"]), true);
  assert.equal(isAllowedEmail("a@evil.com", ["acme.com"]), false);
});

test("verifyIdTokenClaims rejects bad tokens and accepts a valid one", () => {
  const base = { aud: "cid", iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 60, email_verified: true, email: IDENTITY.email, sub: IDENTITY.sub };
  assert.equal(verifyIdTokenClaims(base, { clientId: "cid" }).ok, true);
  assert.equal(verifyIdTokenClaims({ ...base, aud: "other" }, { clientId: "cid" }).error, "audience_mismatch");
  assert.equal(verifyIdTokenClaims({ ...base, iss: "evil" }, { clientId: "cid" }).error, "issuer_mismatch");
  assert.equal(verifyIdTokenClaims({ ...base, exp: 1 }, { clientId: "cid" }).error, "token_expired");
  assert.equal(verifyIdTokenClaims({ ...base, email_verified: false }, { clientId: "cid" }).error, "email_unverified");
});

test("signInWithGoogle creates, then re-links, a user by email", async () => {
  const db = openDb(":memory:");
  const config = { enabled: true, clientId: "cid", clientSecret: "sec", redirectUri: "http://r/cb", allowedDomains: [] };
  const token = idToken({});
  assert.equal(decodeIdTokenClaims(token).email, IDENTITY.email);

  const first = await signInWithGoogle({ db, config, code: "c", codeVerifier: "v", fetchImpl: fakeFetch(token) });
  assert.equal(first.ok, true);
  assert.equal(first.user.email, IDENTITY.email);

  const stored = db.prepare("SELECT password_hash AS h, google_sub AS g FROM users WHERE email=?").get(IDENTITY.email);
  assert.equal(stored.h, "");
  assert.equal(stored.g, IDENTITY.sub);
  assert.equal(verifyPassword("anything", stored.h, ""), false);

  const again = await signInWithGoogle({ db, config, code: "c", codeVerifier: "v", fetchImpl: fakeFetch(token) });
  assert.equal(again.user.id, first.user.id);
});

test("exchangeCode surfaces Google errors", async () => {
  const config = { clientId: "cid", clientSecret: "sec", redirectUri: "http://r/cb" };
  const bad = await exchangeCode({ config, code: "x", codeVerifier: "v", fetchImpl: async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) }) });
  assert.deepEqual(bad, { ok: false, error: "invalid_grant" });
});

async function bootGoogleRouter() {
  const db = openDb(":memory:");
  const config = { enabled: true, clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost/api/auth/google/callback", allowedDomains: [] };
  const token = idToken({});
  const handle = createApiRouter({ db, isSecure: () => false, google: config, fetchImpl: fakeFetch(token) });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await handle(req, res, url)) return;
    res.writeHead(404); res.end("no");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, server, config, token };
}

test("google start redirects with state cookie and callback establishes a session", async () => {
  const { base, server } = await bootGoogleRouter();
  let r = await fetch(base + "/api/auth/google/config");
  assert.deepEqual(await r.json(), { enabled: true, startUrl: "/api/auth/google/start" });

  r = await fetch(base + "/api/auth/google/start", { redirect: "manual" });
  assert.equal(r.status, 302);
  const location = r.headers.get("location");
  assert.ok(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
  const state = new URL(location).searchParams.get("state");
  const stateCookie = r.headers.getSetCookie()[0].split(";")[0];
  assert.ok(stateCookie.startsWith("ledger_oauth_state="));

  r = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/");
  const sessionCookie = r.headers.getSetCookie().find((c) => c.startsWith("ledger_session=")).split(";")[0];

  r = await fetch(base + "/api/me", { headers: { cookie: sessionCookie } });
  assert.equal((await r.json()).user.email, IDENTITY.email);

  const replay = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: "manual", headers: { cookie: stateCookie } });
  assert.equal(replay.headers.get("location"), "/?google_error=invalid_state");
  server.close();
});

test("google callback rejects a mismatched state", async () => {
  const { base, server } = await bootGoogleRouter();
  const r = await fetch(`${base}/api/auth/google/callback?code=abc&state=forged`, { redirect: "manual", headers: { cookie: "ledger_oauth_state=other" } });
  assert.equal(r.headers.get("location"), "/?google_error=invalid_state");
  server.close();
});
