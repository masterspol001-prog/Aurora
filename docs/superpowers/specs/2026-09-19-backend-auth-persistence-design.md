# FragLedger Backend: Accounts, Multi-Tenancy, Persistence, Roles, Audit

Status: approved design, not yet implemented
Date: 2026-09-19
Program: backlog P1 item 10 (auth + roles + audit) and P2 item 13 (server persistence)

## 1. Problem

The billing ledger is a self-contained static prototype. All state lives in the
browser (`localStorage`), there are no accounts, and the "Viewing as" role
selector is cosmetic. Two limits follow:

- Data is trapped in one browser and cannot be shared or trusted.
- Role permissions cannot be enforced honestly on the client, and there is no
  durable audit trail.

This spec defines a zero-dependency backend that adds real accounts, multiple
workspaces per user, server persistence, enforced roles, and an audit log,
without discarding the existing prototype.

## 2. Goals and non-goals

Goals (first increment):

- Email + password accounts, self-contained (no external service).
- Many users; each user may belong to many workspaces with a role per workspace.
- Server persistence of the full ledger state, with conflict detection.
- Server-enforced role permissions: owner, bookkeeper, accountant.
- Append-only audit log for mutating actions.
- Keep the static demo mode and all existing tests working.

Non-goals (later increments):

- File attachments, reconciliation assistant, email delivery / invites.
- Plan billing/payment, 2FA, SSO, horizontal scaling, offline sync merging.

## 3. Decisions (with rationale)

- Runtime/storage: Node `http` + built-in `node:sqlite`. Verified available on
  the target Node v22.22.0 (`node:sqlite` exports `DatabaseSync`). This keeps
  the project dependency-free and build-free, matching the prototype.
- Storage shape: versioned workspace **snapshot** document plus normalized
  `users`/`workspaces`/`memberships`/`sessions`/`audit_log` tables. Chosen over
  entity-level REST and event sourcing because it maps onto the existing
  `state` object and `saveState()` with least risk and code.
- Auth: `scrypt` password hashing (`node:crypto`) and random session tokens
  stored only as SHA-256 hashes, delivered in an `HttpOnly` cookie.
- Single origin: the server also serves the static files, so the preview
  environment's single-port constraint holds and no proxy is needed.
- Demo mode is preserved: when no API is present, the client falls back to
  `localStorage` exactly as today.

## 4. Architecture

```
browser (index.html + engine.js + store.js)
        |  same origin
        v
server/index.mjs  (Node http, no deps)
  routes/  api handlers, validation, role checks
  db.mjs   node:sqlite connection, migrations, prepared statements
  auth.mjs scrypt hash/verify, session create/verify, cookies
  static.mjs serves index.html / engine.js / store.js
  files: server/data/ledger.db (gitignored)
```

Two run modes:

- `npm run serve` - static demo, `localStorage`, no backend, unchanged.
- `npm run server` - real backend on `LEDGER_PORT` (default 8091); serves the
  app and `/api/*`.

## 5. Data model

SQLite, foreign keys on.

- `users(id TEXT PK, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT)`
- `workspaces(id TEXT PK, name TEXT NOT NULL, owner_user_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, state_json TEXT NOT NULL,
  created_at TEXT, updated_at TEXT)`
- `memberships(workspace_id TEXT, user_id TEXT, role TEXT NOT NULL,
  created_at TEXT, PRIMARY KEY (workspace_id, user_id))`
- `sessions(id TEXT PK, token_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL,
  created_at TEXT, expires_at TEXT, last_seen TEXT)`
- `audit_log(id INTEGER PK AUTOINCREMENT, workspace_id TEXT, user_id TEXT,
  action TEXT NOT NULL, detail TEXT, ip TEXT, at TEXT)`

Notes:

- `state_json` holds the same object the client keeps in memory: `settings`,
  `company`, `clients`, `invoices`, `payments`, `commitments`, `creditNotes`,
  `recurring`, `activity`, `period`, `nextInvoiceSeq`. Money remains exact
  integer minor units; the server never does float arithmetic on money.
- `revision` increments on every successful state write and drives optimistic
  concurrency.
- Roles are validated to the set {owner, bookkeeper, accountant}.

## 6. API surface

All responses JSON. Errors are `{ "error": "<code>", "message": "<human>" }`.

Auth:

- `POST /api/auth/register` `{email, name, password}` -> `201 {user}`, sets cookie.
- `POST /api/auth/login` `{email, password}` -> `200 {user}`, sets cookie.
- `POST /api/auth/logout` -> `204`, clears cookie.
- `POST /api/auth/password` `{currentPassword, newPassword}` -> `204`.
- `GET /api/me` -> `{user, memberships:[{workspaceId, role}]}`.

Workspaces:

- `GET /api/workspaces` -> memberships with workspace name and role.
- `POST /api/workspaces` `{name}` -> `201 {workspace}`; creator becomes owner;
  the workspace receives a freshly seeded empty state.
- `GET /api/workspaces/:id` -> `{meta, revision, state}` (any member).
- `PUT /api/workspaces/:id/state` `{revision, state}` -> `200 {revision}`;
  `409` when `revision` is stale; `403` when the role cannot write.
- `GET /api/workspaces/:id/audit?limit=` -> audit rows (owner, accountant).

Members:

- `POST /api/workspaces/:id/members` `{email, role}` -> `201` (owner only;
  the target user must already be registered).
- `PATCH /api/workspaces/:id/members/:userId` `{role}` -> `200` (owner only).
- `DELETE /api/workspaces/:id/members/:userId` -> `204` (owner only; the last
  owner cannot be removed).

## 7. Auth and session details

- Password: `crypto.scryptSync(password, salt, 64)` with a 16-byte random salt;
  verify with `crypto.timingSafeEqual`. Minimum length 8; reject the empty and
  whitespace-only password.
- Session token: 32 random bytes (hex). Store `sha256(token)`. Cookie
  `ledger_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=30d`,
  `Secure` when the request is HTTPS.
- On each authenticated request, load the session by token hash, reject if
  expired, and slide `last_seen`/`expires_at`.
- CSRF: `SameSite=Strict` plus a required `x-ledger-client: 1` header on all
  non-GET requests; requests without it are rejected `400`.
- Login rate limit: in-memory counter per email+IP, e.g. 10 attempts / 15 min,
  returning `429`.
- Config via environment only (`LEDGER_PORT`, `LEDGER_DB`). Sessions are opaque
  random tokens, not signed assertions, so no signing secret is required. No
  secrets are hardcoded; none are read from unrelated environment variables.

## 8. Roles and permissions (server-enforced)

| Action                                   | owner | bookkeeper | accountant |
|------------------------------------------|:-----:|:----------:|:----------:|
| Read workspace state, reports, export    | yes   | yes        | yes        |
| Create/update clients, invoices, payments, credit notes, recurring, commitments | yes | yes | no |
| Manage workspace settings                | yes   | yes        | no         |
| View audit log                           | yes   | no         | yes        |
| Add / change / remove members            | yes   | no         | no         |

The client additionally hides actions the current role cannot perform, but the
server is the authority. The pre-existing "Viewing as" selector remains a
convenience for owners to preview other role views; it never grants permission.

## 9. Client changes

- New `store.js` exposing `initStore()`, `loadState()`, `saveState(state)`,
  `storeMode()`, `onConflict()`, `signOut()`:
  - Demo mode (no `/api` reachable or `LEDGER_DEMO=1`): `localStorage`,
    identical to today.
  - Server mode: `GET` the active workspace state on boot; `saveState()` sends
    `PUT` with the last known `revision`; on `200` update `revision`; on `409`
    surface a conflict banner offering Reload or Overwrite; on `401` show
    sign-in.
- `index.html` gains a thin server-mode shell: sign-in, sign-out, workspace
  switcher, and a "New workspace" action. These elements render only in server
  mode. All existing views, `engine.js`, and the demo path are untouched.
- The active workspace id is kept in memory (and a non-sensitive cookie/local
  key) so reloads return to the same workspace.

## 10. Audit log

- Every successful mutating API call appends one `audit_log` row with
  `workspace_id`, `user_id`, `action` (for example `invoice.create`,
  `payment.record`, `member.add`), a short `detail`, the client IP, and time.
- In server mode the in-app activity feed reads recent audit rows; in demo mode
  it keeps using the in-memory `activity` array.

## 11. Error handling

- `400` validation (bad input, missing CSRF header, oversized body).
- `401` missing/expired session. `403` role/permission denied.
- `404` unknown workspace/user. `409` stale revision. `429` rate limited.
- `500` unexpected; logged server-side, generic message to the client.
- State writes are validated: object shape, required top-level keys, arrays of
  objects, size cap (for example 5 MB) before persistence.

## 12. Validation and money safety

- The server does not recompute tax; it stores the exact integer minor units the
  client produced with `engine.js`, so totals are never altered in transit.
- Type and range checks on write reject floats where integers are expected in
  money fields (best-effort schema check; the client remains the calculator).

## 13. Testing and verification

New `test/server.test.mjs` (node:test), each case on an ephemeral port with a
temporary SQLite file:

1. Register returns a user and a session cookie; duplicate email -> `409`.
2. Login succeeds; wrong password -> `401`; logout invalidates the session.
3. `GET /me` reports the caller's memberships.
4. Create workspace -> creator is owner; `GET` returns empty seeded state.
5. State `PUT` round-trips a fixture with large exact integers unchanged.
6. Stale `PUT` revision -> `409`; correct revision -> `200` and increments.
7. Role enforcement: bookkeeper can `PUT` state; accountant gets `403`;
   non-member gets `403`/`404`.
8. Owner can add an existing user as a member; a member cannot add members.
9. Mutations append audit rows; `GET /audit` permitted for owner/accountant,
   denied for bookkeeper.
10. Missing `x-ledger-client` header -> `400`.
11. After 10 failed logins for the same email+IP, the next attempt -> `429`.

Existing suites must stay green: `node --test test/engine.test.mjs
test/ui.test.mjs` (57 tests) and the engine audit harness.

## 14. Risks and mitigations

- `node:sqlite` is experimental: pin the engine to Node 22.x in `engines`, and
  isolate all SQLite access in `db.mjs` so it can be swapped to `better-sqlite3`
  later with no call-site changes.
- Snapshot writes can be large: cap size, gzip is out of scope, and only the
  active workspace is loaded.
- Conflict handling is new UX: keep it to a banner with Reload/Overwrite.
- Security must not regress: rate limit, hashed tokens, same-site cookies, no
  secrets in code, and no secret/LLM-key reading from the environment.

## 15. Rollout

1. Build `server/db.mjs`, `auth.mjs`, `routes/`, `static.mjs`, `index.mjs`.
2. Add `npm run server`; keep `npm run serve` as demo.
3. Add `store.js` and the server-mode shell, gated so demo mode is unaffected.
4. Add `test/server.test.mjs`; confirm the existing 57 tests remain green.
5. Verify the preview still serves the demo, then verify server mode manually.
