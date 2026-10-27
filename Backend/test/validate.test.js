import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectConfig,
  isPlaceholderSecret,
  isWeakApiKey,
} from "../src/config/validate.js";

const STRONG_SECRET = "9f2c4e7a1b8d3c6e5f0a2b4d6c8e1f3a5b7d9c0e2f4a6b8d1c3e5f7a9b0c2d4e";
const STRONG_API_KEY = "b3a1c5e7d9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d1e3f5a7b9";

const baseConfig = (overrides = {}) => ({
  env: "development",
  litellm: { baseUrl: "http://gateway:4000" },
  rbac: {
    jwtSecret: STRONG_SECRET,
    roleTokens: { dev: "sk-dev", standard: "", admin: "" },
    apiKeys: {},
  },
  cors: { origins: ["http://localhost:5173"] },
  ...overrides,
});

const inspect = (cfg, env = {}) => inspectConfig(cfg, env);

test("a sound configuration has no errors and no warnings", () => {
  assert.deepEqual(inspect(baseConfig()), { errors: [], warnings: [] });
});

test("the .env.example placeholder secret is rejected even though it is >= 32 chars", () => {
  const placeholder = "sk-replace-with-a-long-random-secret";
  assert.ok(placeholder.length >= 32);
  assert.equal(isPlaceholderSecret(placeholder), true);
  const { errors } = inspect(baseConfig({ rbac: { ...baseConfig().rbac, jwtSecret: placeholder } }));
  assert.ok(errors.some((e) => /placeholder/i.test(e)), errors.join("\n"));
});

test("random hex secrets are never mistaken for placeholders", () => {
  assert.equal(isPlaceholderSecret(STRONG_SECRET), false);
  assert.equal(isPlaceholderSecret(STRONG_API_KEY), false);
});

test("a short JWT secret is an error", () => {
  const { errors } = inspect(baseConfig({ rbac: { ...baseConfig().rbac, jwtSecret: "short" } }));
  assert.ok(errors.some((e) => /at least 32/.test(e)));
});

test("missing role tokens and missing auth method are errors", () => {
  const cfg = baseConfig({
    rbac: { jwtSecret: "", roleTokens: { dev: "", standard: "", admin: "" }, apiKeys: {} },
  });
  const { errors } = inspect(cfg);
  assert.ok(errors.some((e) => /No role tokens/.test(e)));
  assert.ok(errors.some((e) => /No auth method/.test(e)));
});

test("RBAC_ENABLED=false and invalid RBAC_API_KEYS JSON are errors", () => {
  const { errors } = inspect(baseConfig(), { RBAC_ENABLED: "false", RBAC_API_KEYS: "{oops" });
  assert.ok(errors.some((e) => /RBAC_ENABLED=false/.test(e)));
  assert.ok(errors.some((e) => /RBAC_API_KEYS must be a JSON object/.test(e)));
});

test("weak and documented example API keys are flagged", () => {
  assert.equal(isWeakApiKey("dev-abc123"), true);
  assert.equal(isWeakApiKey("admin-xyz789"), true);
  assert.equal(isWeakApiKey("short"), true);
  assert.equal(isWeakApiKey(STRONG_API_KEY), false);
});

test("weak API keys only warn in development, so an existing setup keeps starting", () => {
  const cfg = baseConfig({
    rbac: { ...baseConfig().rbac, apiKeys: { "dev-abc123": "dev", [STRONG_API_KEY]: "admin" } },
  });
  const { errors, warnings } = inspect(cfg);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /role\(s\): dev/);
  assert.doesNotMatch(warnings[0], /dev-abc123/, "must not echo the key itself");
});

test("weak API keys are errors in production", () => {
  const cfg = baseConfig({
    env: "production",
    rbac: { ...baseConfig().rbac, apiKeys: { "admin-xyz789": "admin" } },
  });
  const { errors } = inspect(cfg);
  assert.ok(errors.some((e) => /weak or documented example keys/.test(e)));
});

test("wildcard CORS warns in development and fails in production", () => {
  const dev = inspect(baseConfig({ cors: { origins: ["*"] } }));
  assert.deepEqual(dev.errors, []);
  assert.ok(dev.warnings.some((w) => /CORS_ORIGIN/.test(w)));

  const prod = inspect(baseConfig({ env: "production", cors: { origins: ["*"] } }));
  assert.ok(prod.errors.some((e) => /CORS_ORIGIN/.test(e)));
});

test("TRUST_PROXY=true is rejected", () => {
  const { errors } = inspect(baseConfig(), { TRUST_PROXY: "true" });
  assert.ok(errors.some((e) => /TRUST_PROXY/.test(e)));
  assert.deepEqual(inspect(baseConfig(), { TRUST_PROXY: "1" }).errors, []);
});
