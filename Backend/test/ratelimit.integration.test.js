import test, { after } from "node:test";
import assert from "node:assert/strict";

import { listen, startStubGateway } from "./helpers/gateway.js";

const gateway = await startStubGateway();

Object.assign(process.env, {
  NODE_ENV: "test",
  LITELLM_BASE_URL: gateway.url,
  AUTH_JWT_SECRET: "ratelimit-secret-ratelimit-secret-ratelimit-1",
  LITELLM_DEV_TOKEN: "sk-dev-test",
  LITELLM_STANDARD_TOKEN: "",
  LITELLM_ADMIN_TOKEN: "",
  RATE_LIMIT_MAX: "3",
  RATE_LIMIT_WINDOW_MS: "60000",
});
delete process.env.TRUST_PROXY; // default: do not trust X-Forwarded-For

const { createApp } = await import("../src/app.js");
const app = await listen(createApp());

after(async () => {
  await app.close();
  await gateway.close();
});

test("a client cannot dodge the rate limit by spoofing X-Forwarded-For", async () => {
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(`${app.url}/health`, {
      headers: { "X-Forwarded-For": `203.0.113.${i + 1}` }, // a different "client" each time
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429, 429, 429]);
});
