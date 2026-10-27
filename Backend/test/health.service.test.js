import test from "node:test";
import assert from "node:assert/strict";

import { createReadinessChecker } from "../src/services/health.service.js";

/** A controllable clock + upstream check. */
function harness({ ttlMs = 5000 } = {}) {
  const state = {
    time: 1_000_000,
    calls: 0,
    result: true,
    hold: false,
    resolvePending: null,
  };
  const ping = () => {
    state.calls += 1;
    if (state.hold) {
      return new Promise((resolve) => {
        state.resolvePending = () => resolve(state.result);
      });
    }
    if (state.result instanceof Error) return Promise.reject(state.result);
    return Promise.resolve(state.result);
  };
  const isReady = createReadinessChecker({ ping, ttlMs, now: () => state.time });
  return { state, isReady };
}

test("reports the upstream result", async () => {
  const { isReady, state } = harness();
  assert.equal(await isReady(), true);
  state.time += 10_000;
  state.result = false;
  assert.equal(await isReady(), false);
});

test("caches a result until the ttl elapses", async () => {
  const { isReady, state } = harness({ ttlMs: 5000 });
  await isReady();
  await isReady();
  state.time += 4999;
  await isReady();
  assert.equal(state.calls, 1);
  state.time += 2;
  await isReady();
  assert.equal(state.calls, 2);
});

test("concurrent callers share one upstream request", async () => {
  const { isReady, state } = harness();
  state.hold = true;
  const callers = [isReady(), isReady(), isReady()];
  await new Promise((resolve) => setImmediate(resolve)); // let the single ping start
  assert.equal(state.calls, 1);
  state.resolvePending();
  assert.deepEqual(await Promise.all(callers), [true, true, true]);
  assert.equal(state.calls, 1);
});

test("a failing check means 'not ready' rather than throwing", async () => {
  const { isReady, state } = harness();
  state.result = new Error("connection refused");
  assert.equal(await isReady(), false);
});

test("recovers once the upstream is healthy again", async () => {
  const { isReady, state } = harness({ ttlMs: 1000 });
  state.result = false;
  assert.equal(await isReady(), false);
  state.result = true;
  state.time += 1001;
  assert.equal(await isReady(), true);
});
