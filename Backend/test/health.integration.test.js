import test, { after } from "node:test";
import assert from "node:assert/strict";

import { listen, startStubGateway } from "./helpers/gateway.js";

// Gateway is down: readiness must say so while liveness stays green.
const gateway = await startStubGateway({ ready: false });

Object.assign(process.env, {
  NODE_ENV: "test",
  LITELLM_BASE_URL: gateway.url,
  AUTH_JWT_SECRET: "health-secret-health-secret-health-secret-01",
  LITELLM_DEV_TOKEN: "sk-dev-test",
  LITELLM_STANDARD_TOKEN: "",
  LITELLM_ADMIN_TOKEN: "",
  RATE_LIMIT_MAX: "1000",
});

const { createApp } = await import("../src/app.js");
const app = await listen(createApp());

after(async () => {
  await app.close();
  await gateway.close();
});

test("readiness is 503 'degraded' while the gateway is down", async () => {
  const res = await fetch(`${app.url}/health/ready`);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    status: "degraded",
    service: "ai-governance-backend",
    checks: { gateway: "down" },
  });
});

test("liveness stays 200 so an orchestrator does not restart the Backend over a gateway outage", async () => {
  const res = await fetch(`${app.url}/health`);
  assert.equal(res.status, 200);
});
