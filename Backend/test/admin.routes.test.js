import test, { after } from "node:test";
import assert from "node:assert/strict";

import { listen, startStubGateway } from "./helpers/gateway.js";

const SECRET = "admin-test-secret-admin-test-secret-0123456789";

const gateway = await startStubGateway();

Object.assign(process.env, {
  NODE_ENV: "test",
  LITELLM_BASE_URL: gateway.url,
  AUTH_JWT_SECRET: SECRET,
  LITELLM_DEV_TOKEN: "sk-dev-admin-test",
  LITELLM_ADMIN_TOKEN: "sk-admin-admin-test",
  RATE_LIMIT_MAX: "1000",
});

const { createApp } = await import("../src/app.js");
const { signJwt } = await import("../src/auth/jwt.js");
const app = await listen(createApp());

after(async () => {
  await app.close();
  await gateway.close();
});

const jwtFor = (role, sub = "admin@example.com") =>
  signJwt({ role, sub }, SECRET, { expiresInSeconds: 300 });

const get = (path, token) =>
  fetch(`${app.url}${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

test("GET /api/admin/dashboard without auth returns 401 unauthenticated", async () => {
  const res = await get("/api/admin/dashboard");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error?.code, "unauthenticated");
});

test("GET /api/admin/dashboard with dev role returns 403 admin_required", async () => {
  const token = jwtFor("dev", "dev-user@example.com");
  const res = await get("/api/admin/dashboard", token);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error?.code, "admin_required");
});

test("GET /api/admin/dashboard with standard role returns 403 admin_required", async () => {
  const token = jwtFor("standard", "std-user@example.com");
  const res = await get("/api/admin/dashboard", token);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error?.code, "admin_required");
});

test("GET /api/admin/audit-logs with dev role is rejected with 403", async () => {
  const token = jwtFor("dev");
  const res = await get("/api/admin/audit-logs", token);
  assert.equal(res.status, 403);
});

test("GET /api/admin/quotas with dev role is rejected with 403", async () => {
  const token = jwtFor("dev");
  const res = await get("/api/admin/quotas", token);
  assert.equal(res.status, 403);
});

