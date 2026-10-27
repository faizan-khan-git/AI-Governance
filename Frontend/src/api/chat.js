import { request } from "./client.js";
import env from "../config/env.js";

/**
 * Send a chat request to the Backend. The Backend authenticates the caller
 * (RBAC), forwards to the LiteLLM gateway with the role's virtual key, and
 * returns a sanitized response.
 *
 * @param {object} params
 * @param {string} params.text prompt text (the new message)
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {string} [params.system] optional system prompt
 * @param {Array<{ role: 'user'|'assistant', content: string }>} [params.history]
 *   prior turns, oldest first, so the model has the conversation context
 * @param {{ scheme: string, token: string }} [params.auth]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function sendChat({ text, model, temperature, system, history, auth }) {
  const body = { text, model, temperature };
  if (system && system.trim()) {
    body.system = system;
  }
  if (Array.isArray(history) && history.length > 0) {
    body.history = history;
  }
  return request(env.chatPath, { method: "POST", body, auth });
}

export default { sendChat };
