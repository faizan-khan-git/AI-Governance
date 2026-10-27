import test from "node:test";
import assert from "node:assert/strict";

import {
  parseApiKeyMap,
  parseList,
  parseTrustProxy,
  toBool,
  toFloat,
  toInt,
  toPositiveInt,
} from "../src/config/parsers.js";

test("toInt falls back when the value is not a number", () => {
  assert.equal(toInt("42", 1), 42);
  assert.equal(toInt("abc", 7), 7);
  assert.equal(toInt(undefined, 7), 7);
});

test("toPositiveInt rejects zero, negatives and junk", () => {
  assert.equal(toPositiveInt("5", 9), 5);
  assert.equal(toPositiveInt("0", 9), 9);
  assert.equal(toPositiveInt("-3", 9), 9);
  assert.equal(toPositiveInt("x", 9), 9);
});

test("toFloat and toBool", () => {
  assert.equal(toFloat("0.7", 1), 0.7);
  assert.equal(toFloat("nope", 1), 1);
  assert.equal(toBool("true"), true);
  assert.equal(toBool(" YES "), true);
  assert.equal(toBool("false"), false);
  assert.equal(toBool(undefined), false);
});

test("parseList trims items and drops empties", () => {
  assert.deepEqual(parseList(" a, b ,, c "), ["a", "b", "c"]);
  assert.deepEqual(parseList(""), []);
  assert.deepEqual(parseList(undefined), []);
});

test("parseTrustProxy: unset, false and 0 mean 'trust nothing'", () => {
  for (const raw of [undefined, "", "false", "0", "no", "off"]) {
    assert.deepEqual(parseTrustProxy(raw), { value: false, valid: true }, String(raw));
  }
});

test("parseTrustProxy: a number is a trusted-hop count", () => {
  assert.deepEqual(parseTrustProxy("1"), { value: 1, valid: true });
  assert.deepEqual(parseTrustProxy("2"), { value: 2, valid: true });
});

test("parseTrustProxy rejects 'true' because it lets clients spoof their IP", () => {
  for (const raw of ["true", "yes", "on", "TRUE"]) {
    assert.equal(parseTrustProxy(raw).valid, false, raw);
  }
});

test("parseTrustProxy accepts Express keywords and CIDR lists", () => {
  assert.deepEqual(parseTrustProxy("loopback"), { value: "loopback", valid: true });
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12"), {
    value: "10.0.0.0/8, 172.16.0.0/12",
    valid: true,
  });
});

test("parseTrustProxy rejects unrecognised values", () => {
  assert.equal(parseTrustProxy("everyone").valid, false);
  assert.equal(parseTrustProxy("1; drop table").valid, false);
});

test("parseApiKeyMap parses a role map and flags bad JSON", () => {
  assert.deepEqual(parseApiKeyMap(undefined), { map: {}, ok: true });
  assert.deepEqual(parseApiKeyMap('{"k1":"dev","k2":"admin"}'), {
    map: { k1: "dev", k2: "admin" },
    ok: true,
  });
  assert.equal(parseApiKeyMap("{not json").ok, false);
  assert.equal(parseApiKeyMap("[1,2]").ok, false);
  assert.deepEqual(parseApiKeyMap('{"k1":"dev","k2":5}').map, { k1: "dev" });
});
