import { pingGateway } from "./litellm.service.js";

/** A readiness probe may be hit by many tabs/pollers; share one upstream check. */
const DEFAULT_CACHE_TTL_MS = 5000;

/**
 * Create a readiness checker that caches the last result briefly and lets
 * concurrent callers share a single in-flight upstream check.
 *
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.ping performs the real upstream check
 * @param {number} [deps.ttlMs] how long a result stays fresh
 * @param {() => number} [deps.now] clock, injectable for tests
 * @returns {() => Promise<boolean>}
 */
export function createReadinessChecker({
  ping,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
}) {
  let cached = { checkedAt: Number.NEGATIVE_INFINITY, up: false };
  let inflight = null;

  return function isReady() {
    if (now() - cached.checkedAt < ttlMs) {
      return Promise.resolve(cached.up);
    }
    if (!inflight) {
      inflight = Promise.resolve()
        .then(ping)
        .catch(() => false)
        .then((up) => {
          cached = { checkedAt: now(), up: Boolean(up) };
          return cached.up;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

/**
 * Whether the LiteLLM gateway (and its database) is reachable and ready.
 * @returns {Promise<boolean>}
 */
export const isGatewayReady = createReadinessChecker({ ping: pingGateway });

export default { createReadinessChecker, isGatewayReady };
