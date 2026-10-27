import { ApiError, request } from "./client.js";
import env from "../config/env.js";

/**
 * Query the Backend readiness endpoint.
 *
 * The Backend answers 503 when it is alive but cannot reach the LiteLLM gateway.
 * That is a degraded state — not an unreachable Backend — so it is returned as a
 * value instead of being thrown. Anything else that fails is genuinely offline.
 *
 * @returns {Promise<{ status: string, service?: string, checks?: { gateway: string } }>}
 */
export async function getHealth() {
  try {
    return await request(env.readyPath, { method: "GET" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      return { status: "degraded", checks: { gateway: "down" } };
    }
    throw error;
  }
}

export default { getHealth };
