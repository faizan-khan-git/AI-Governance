import test from "node:test";
import assert from "node:assert/strict";

import { deriveEndUserId } from "../src/auth/endUser.js";

test("the id is a stable, well-formed pseudonym", () => {
  const id = deriveEndUserId("alice@example.com", "key-1");
  assert.match(id, /^u_[0-9a-f]{24}$/);
  assert.equal(deriveEndUserId("alice@example.com", "key-1"), id);
});

test("different subjects get different ids", () => {
  assert.notEqual(deriveEndUserId("alice", "k"), deriveEndUserId("bob", "k"));
});

test("the key changes the id, so ids cannot be confirmed by hashing guesses", () => {
  assert.notEqual(deriveEndUserId("alice", "k1"), deriveEndUserId("alice", "k2"));
});

test("the raw subject never appears in the id", () => {
  const subject = "alice@example.com";
  assert.ok(!deriveEndUserId(subject, "k").includes("alice"));
});

test("works without a key (API-key-only deployments) and with odd subjects", () => {
  assert.match(deriveEndUserId("apikey:dev"), /^u_[0-9a-f]{24}$/);
  assert.match(deriveEndUserId(undefined, "k"), /^u_[0-9a-f]{24}$/);
  assert.match(deriveEndUserId(12345, "k"), /^u_[0-9a-f]{24}$/);
});
