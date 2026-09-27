import { request } from "./client.js";
import env from "../config/env.js";

/**
 * Query the Backend liveness endpoint.
 * @returns {Promise<{ status: string, service?: string }>}
 */
export function getHealth() {
  return request(env.healthPath, { method: "GET" });
}

export default { getHealth };
