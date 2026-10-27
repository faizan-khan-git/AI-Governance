import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { signJwt, verifyJwt } from "../src/auth/jwt.js";

const SECRET = "unit-test-secret-unit-test-secret-1234";

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Hand-craft a correctly signed token so we can test claims signJwt would never emit. */
function forge(claims, { secret = SECRET, header = { alg: "HS256", typ: "JWT" } } = {}) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(typeof claims === "string" ? claims : JSON.stringify(claims));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

const now = () => Math.floor(Date.now() / 1000);

test("sign + verify round-trips the claims", () => {
  const token = signJwt({ role: "dev", sub: "alice" }, SECRET, { expiresInSeconds: 60 });
  const claims = verifyJwt(token, SECRET);
  assert.equal(claims.role, "dev");
  assert.equal(claims.sub, "alice");
  assert.ok(claims.exp > claims.iat);
});

test("signJwt refuses to mint a token without a lifetime", () => {
  assert.throws(() => signJwt({ role: "dev" }, SECRET), /must expire/);
  assert.throws(() => signJwt({ role: "dev" }, SECRET, {}), /must expire/);
  assert.throws(() => signJwt({ role: "dev" }, SECRET, { expiresInSeconds: 0 }), /must expire/);
  assert.throws(() => signJwt({ role: "dev" }, SECRET, { expiresInSeconds: -5 }), /must expire/);
  assert.throws(() => signJwt({ role: "dev" }, SECRET, { expiresInSeconds: 1.5 }), /must expire/);
});

test("signJwt: a payload cannot override the computed expiry", () => {
  const token = signJwt({ role: "dev", exp: 9999999999 }, SECRET, { expiresInSeconds: 60 });
  assert.ok(verifyJwt(token, SECRET).exp < now() + 120);
});

test("verifyJwt rejects a validly signed token that has no exp claim", () => {
  const token = forge({ role: "admin", sub: "forever" });
  assert.throws(() => verifyJwt(token, SECRET), /no expiry/);
});

test("verifyJwt rejects a non-numeric exp", () => {
  assert.throws(() => verifyJwt(forge({ role: "dev", exp: "tomorrow" }), SECRET), /no expiry/);
  assert.throws(() => verifyJwt(forge({ role: "dev", exp: null }), SECRET), /no expiry/);
});

test("verifyJwt rejects expired tokens and not-yet-valid tokens", () => {
  assert.throws(() => verifyJwt(forge({ role: "dev", exp: now() - 10 }), SECRET), /expired/);
  assert.throws(
    () => verifyJwt(forge({ role: "dev", exp: now() + 600, nbf: now() + 300 }), SECRET),
    /not yet valid/,
  );
});

test("verifyJwt rejects a tampered signature and the wrong secret", () => {
  const token = signJwt({ role: "dev" }, SECRET, { expiresInSeconds: 60 });
  const tampered = `${token.slice(0, -4)}AAAA`;
  assert.throws(() => verifyJwt(tampered, SECRET), /signature/);
  assert.throws(() => verifyJwt(token, `${SECRET}x`), /signature/);
});

test("verifyJwt rejects other algorithms (alg confusion)", () => {
  const none = forge({ role: "admin", exp: now() + 60 }, { header: { alg: "none", typ: "JWT" } });
  assert.throws(() => verifyJwt(none, SECRET), /algorithm/);
  const hs512 = forge({ role: "admin", exp: now() + 60 }, { header: { alg: "HS512", typ: "JWT" } });
  assert.throws(() => verifyJwt(hs512, SECRET), /algorithm/);
});

test("verifyJwt rejects malformed tokens and non-object payloads", () => {
  assert.throws(() => verifyJwt("", SECRET), /Malformed/);
  assert.throws(() => verifyJwt("a.b", SECRET), /Malformed/);
  assert.throws(() => verifyJwt(forge("null"), SECRET), /Malformed token payload/);
  assert.throws(() => verifyJwt(forge("[1,2]"), SECRET), /Malformed token payload/);
  assert.throws(() => verifyJwt(forge("123"), SECRET), /Malformed token payload/);
});

test("verifyJwt needs a secret", () => {
  assert.throws(() => verifyJwt("a.b.c", ""), /not configured/);
});
