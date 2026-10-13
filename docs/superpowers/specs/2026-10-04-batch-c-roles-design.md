# Batch C - Expanded roles and granular permissions

Date: 2026-10-04
Status: Done

## Why

The platform had three roles enforced with inline checks (`role === "owner" ||
role === "bookkeeper"`). The review asked for auditor, read-only and staff
access, and for permissions to be a policy rather than scattered conditionals.

## Scope

- Six roles: owner, bookkeeper, accountant, auditor, readonly, staff.
- One permission map shared by client and server.
- Guard every write entry point and gate close/approve/members/audit.

The original three roles keep their exact behaviour.

## Permission model

| Permission | owner | bookkeeper | accountant | auditor | readonly | staff |
|---|---|---|---|---|---|---|
| write | Y | Y | | | | Y |
| close | Y | | | | | |
| members | Y | | | | | |
| audit | Y | | Y | Y | | |
| approve | Y | | Y | | | |
| export | Y | Y | Y | Y | Y | Y |

- Client: `ROLE_PERMS` + `can(perm)` in `index.html`.
- Server: `ROLE_PERMISSIONS` + `roleCan(role, perm)` in `server/db.mjs`; routes
  use `roleCan(role, "write")` and `roleCan(role, "audit")` instead of literal
  role comparisons.
- Unknown roles fail safe to owner permissions, matching prior behaviour.

## Enforcement

- `can("write")` guards the invoice, payment, credit note, client, vendor,
  expense, bill, recurring, journal, bank-account and bank-import openers, so a
  read-only click is refused before a modal opens.
- The topbar hides **New invoice** and workspace creation for roles without the
  right; a read-only banner is prepended to every view.
- Close, hard-lock, year-end and the approval toggle require `close`;
  approve/reject requires `approve`.
- The audit route is hidden from the nav and refused in the view without the
  `audit` permission.
- The sidebar picker lists all six roles and explains each; `rolesExplain`
  documents the matrix.

## Honesty and limits

- The picker is a preview of "viewing as"; real access control is enforced by
  the server against the authenticated membership role.
- Server enforcement covers workspace writes, the audit log and member
  management; per-field grants are not modelled.
- Unknown roles fail safe to owner in the client map, but the server only
  accepts roles in `ROLES`.

## Verification

- `npm test` 128 (41 engine + 8 accounting engine + 79 UI); `npm run test:all`
  154, all green; engine audit 0 findings.
- New tests cover the permission matrix, the read-only banner and blocked modal,
  auditor vs read-only audit access, and the server role set.
