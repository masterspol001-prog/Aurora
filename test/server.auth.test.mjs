import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, parseCookies, sessionCookie, clearCookie, SESSION_COOKIE } from "../server/auth.mjs";

test("password hashing verifies the right password only", () => {
  const { hash, salt } = hashPassword("correct horse battery");
  assert.equal(verifyPassword("correct horse battery", hash, salt), true);
  assert.equal(verifyPassword("wrong", hash, salt), false);
  assert.equal(verifyPassword("", hash, salt), false);
});

test("cookies parse and serialize safely", () => {
  assert.deepEqual(parseCookies("a=1; ledger_session=xyz; b=2"), { a: "1", ledger_session: "xyz", b: "2" });
  assert.equal(SESSION_COOKIE, "ledger_session");
  const c = sessionCookie("tok", { secure: true });
  assert.ok(c.includes("HttpOnly"));
  assert.ok(c.includes("SameSite=Strict"));
  assert.ok(c.includes("Secure"));
  assert.ok(clearCookie().includes("Max-Age=0"));
});
