# Google sign-in (real OAuth 2.0, env-configured) - design

Status: implemented. Server mode only. Off unless configured. No fake auth: with
no credentials the button is not rendered.

## Goal

Let a user sign in with Google instead of a password, without adding any npm
dependency and without weakening the existing password flow.

## Configuration (server environment only)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | yes, to enable | - | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | yes, to enable | - | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | no | `http://localhost:$LEDGER_PORT/api/auth/google/callback` | must be registered in Google Cloud Console |
| `GOOGLE_ALLOWED_DOMAINS` | no | empty (allow all) | comma-separated email-domain allowlist |

`googleConfig(env)` returns `{ enabled, clientId, clientSecret, redirectUri,
allowedDomains }`; `enabled` is true only when both id and secret are non-empty.

## Flow (authorization code + PKCE S256)

1. `GET /api/auth/google/config` -> `{ enabled, startUrl }`. The client probes
   this and only then injects the **Continue with Google** button. This route is
   public (no session, no mutation).
2. `GET /api/auth/google/start`:
   - 302 to Google if enabled, else `/?google_error=google_disabled`.
   - Generates a 32-byte `state` and a PKCE verifier/challenge (`S256`).
   - Stores `state -> code_verifier` in `oauth_states` (single use, 10 min TTL)
     and sets an `HttpOnly; SameSite=Lax` cookie `ledger_oauth_state=state`.
     `Lax` (not `Strict`) so the cookie is sent on Google's top-level redirect
     back; the session cookie stays `SameSite=Strict`.
3. `GET /api/auth/google/callback?code&state`:
   - Rejects unless the query `state` equals the cookie `state`
     (length-checked constant-time compare) and the stored row can be consumed
     once within TTL.
   - Exchanges the code at Google's token endpoint with `code_verifier`
     (client id + secret in the POST body, form-encoded).
   - Reads the returned `id_token` and validates: `aud === clientId`, `iss` in
     `{accounts.google.com, https://accounts.google.com}`, not expired (120 s
     leeway), `email_verified`, and email present. The response comes directly
     from Google's TLS token endpoint, so the JWT signature is not re-verified;
     the claims that matter for account safety are.
   - Enforces `GOOGLE_ALLOWED_DOMAINS` when set.
   - Upserts the user and issues the normal session cookie, then 302 to `/`.
   - Any failure 302s to `/?google_error=<code>`; the client maps the code to a
     short plain-language message. Error redirects are always to a relative `/`
     path, so no open redirect is possible.

## Account linking

- Match by `google_sub` first (returning Google user).
- Otherwise match by normalized email:
  - an existing password account is linked (`google_sub` set) and signed in;
  - if that email is already linked to a different `google_sub`, reject with
    `account_conflict`;
  - otherwise create a user with empty `password_hash` / `password_salt`, which
    makes password login impossible until a password is set. `verifyPassword`
    already returns false for an empty hash.

## Schema

- `users.google_sub TEXT` (added by an idempotent `ALTER TABLE` guarded by
  `PRAGMA table_info`) with a partial unique index.
- `oauth_states(state PK, code_verifier, created_at)`.

## Security properties

- No open redirect (fixed redirect URI from config; relative error redirects).
- CSRF/state replay: single-use state row + cookie binding + constant-time
  compare + 10-minute TTL.
- Secrets are read from the environment only and never logged or sent to the
  browser; the config response exposes only `enabled` and `startUrl`.
- Zero dependencies; `fetch` is injected into the router so tests can stub
  Google without network access.

## Verification

- `test/server.google.test.mjs` (9 tests): config gating, PKCE S256, auth URL
  params, domain allowlist, id_token claim validation, create/link/relink,
  token-endpoint error surfacing, full start -> callback -> session HTTP flow,
  state replay and state mismatch rejection.
- Manual: enabled start route 302s to `accounts.google.com` with the expected
  query and state cookie; disabled start 302s to `/?google_error=google_disabled`.

## Not claimed

- The prototype does not store a refresh token, does not request offline access,
  and does not sync Google profile photos. Signing in with Google proves control
  of that Google account; it is not an identity-verification or KYC claim.
