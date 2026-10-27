import test, { after } from "node:test";
import assert from "node:assert/strict";

import { listen, startStubGateway } from "./helpers/gateway.js";

const gateway = await startStubGateway();

Object.assign(process.env, {
  NODE_ENV: "test",
  LITELLM_BASE_URL: gateway.url,
  AUTH_JWT_SECRET: "proxy-secret-proxy-secret-proxy-secret-proxy-01",
  LITELLM_DEV_TOKEN: "sk-dev-test",
  LITELLM_STANDARD_TOKEN: "",
  LITELLM_ADMIN_TOKEN: "",
  RATE_LIMIT_MAX: "2",
  RATE_LIMIT_WINDOW_MS: "60000",
  TRUST_PROXY: "1", // one trusted reverse proxy, e.g. an ingress
});

const { createApp } = await import("../src/app.js");
const app = await listen(createApp());

after(async () => {
  await app.close();
  await gateway.close();
});

test("behind one trusted proxy the forwarded client IP is honored per client", async () => {
  const hit = async (ip) =>
    (await fetch(`${app.url}/health`, { headers: { "X-Forwarded-For": ip } })).status;

  // Client A exhausts its own bucket…
  assert.deepEqual([await hit("198.51.100.1"), await hit("198.51.100.1"), await hit("198.51.100.1")], [200, 200, 429]);
  // …while client B, seen through the same proxy, is unaffected.
  assert.equal(await hit("198.51.100.2"), 200);
});
