import { createHash, randomBytes } from "node:crypto";
import * as store from "./db.mjs";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

export function googleConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  const port = Number(env.LEDGER_PORT || 8091);
  const redirectUri = String(env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/auth/google/callback`).trim();
  const allowedDomains = String(env.GOOGLE_ALLOWED_DOMAINS || "")
    .split(",").map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return { enabled: !!(clientId && clientSecret), clientId, clientSecret, redirectUri, allowedDomains };
}

export function makePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl({ clientId, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export function isAllowedEmail(email, allowedDomains = []) {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  return allowedDomains.includes(domain);
}

export function decodeIdTokenClaims(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function verifyIdTokenClaims(claims, { clientId, now = Date.now(), leewaySec = 120 } = {}) {
  if (!claims || typeof claims !== "object") return { ok: false, error: "invalid_token" };
  if (claims.aud !== clientId) return { ok: false, error: "audience_mismatch" };
  if (!GOOGLE_ISSUERS.includes(claims.iss)) return { ok: false, error: "issuer_mismatch" };
  if (typeof claims.exp !== "number" || claims.exp < now / 1000 - leewaySec) return { ok: false, error: "token_expired" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { ok: false, error: "email_unverified" };
  if (!claims.email || !claims.sub) return { ok: false, error: "invalid_token" };
  return { ok: true };
}

export async function exchangeCode({ config, code, codeVerifier, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: String(code || ""),
    code_verifier: String(codeVerifier || ""),
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  let res;
  try {
    res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return { ok: false, error: "token_request_failed" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) return { ok: false, error: data.error || "token_exchange_failed" };
  return { ok: true, idToken: data.id_token };
}

export async function signInWithGoogle({ db, config, code, codeVerifier, fetchImpl = fetch, now = Date.now() }) {
  const exchanged = await exchangeCode({ config, code, codeVerifier, fetchImpl });
  if (!exchanged.ok) return exchanged;
  const claims = decodeIdTokenClaims(exchanged.idToken);
  const verified = verifyIdTokenClaims(claims, { clientId: config.clientId, now });
  if (!verified.ok) return verified;
  const email = String(claims.email).trim().toLowerCase();
  if (!isAllowedEmail(email, config.allowedDomains)) return { ok: false, error: "domain_not_allowed" };

  const existingBySub = store.findUserByGoogleSub(db, claims.sub);
  if (existingBySub) return { ok: true, user: existingBySub };

  const existingByEmail = store.findUserByEmail(db, email);
  if (existingByEmail) {
    if (existingByEmail.googleSub && existingByEmail.googleSub !== claims.sub) {
      return { ok: false, error: "account_conflict" };
    }
    store.linkGoogleSub(db, existingByEmail.id, claims.sub);
    return { ok: true, user: { id: existingByEmail.id, email: existingByEmail.email, name: existingByEmail.name } };
  }

  const name = String(claims.name || "").trim() || email;
  const created = store.createGoogleUser(db, { email, name, googleSub: claims.sub });
  return { ok: true, user: created };
}
