import axios from "axios";

import config from "../config/index.js";
import logger from "../utils/logger.js";
import ApiError from "../utils/ApiError.js";

/**
 * Dedicated axios client for the internal LiteLLM gateway. The internal
 * JWT / virtual-key proxy token is injected here, once, so no caller ever
 * handles the credential directly.
 */
const litellmClient = axios.create({
  baseURL: config.litellm.baseUrl,
  timeout: config.litellm.requestTimeoutMs,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.litellm.proxyToken}`,
  },
});

/**
 * Build a standard OpenAI-compatible chat-completions payload from raw text.
 *
 * @param {object} params
 * @param {string} params.text raw user text
 * @param {string} [params.model] model name (falls back to configured default)
 * @param {number} [params.temperature] sampling temperature
 * @param {string} [params.system] optional system prompt
 * @returns {object} OpenAI-compatible request body
 */
export function buildChatPayload({ text, model, temperature, system }) {
  const messages = [];
  if (typeof system === "string" && system.trim()) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: text });

  return {
    model: model?.trim() ? model.trim() : config.defaults.model,
    messages,
    temperature:
      typeof temperature === "number" && Number.isFinite(temperature)
        ? temperature
        : config.defaults.temperature,
    // Streaming is intentionally disabled: rehydration of masked PII requires
    // the full response body (see project README — Presidio limitations).
    stream: false,
  };
}

/**
 * Forward an OpenAI-compatible payload to the LiteLLM gateway and return the
 * raw upstream response body.
 *
 * @param {object} payload OpenAI-compatible chat-completions body
 * @returns {Promise<object>} raw LiteLLM response body
 * @throws {ApiError} normalized error on upstream/network failure
 */
export async function createChatCompletion(payload) {
  try {
    const { data } = await litellmClient.post(
      config.litellm.chatCompletionsPath,
      payload,
    );
    return data;
  } catch (error) {
    throw normalizeUpstreamError(error, payload.model);
  }
}

/**
 * Translate an axios/upstream failure into a safe, client-facing ApiError
 * without leaking internal tokens, URLs, or stack traces.
 */
function normalizeUpstreamError(error, model) {
  // Gateway responded with a non-2xx status.
  if (error.response) {
    const { status, data } = error.response;
    const upstreamMessage =
      data?.error?.message ??
      data?.detail ??
      data?.message ??
      "Upstream gateway error.";

    logger.warn("LiteLLM upstream returned an error", {
      status,
      model,
      upstreamMessage,
    });

    // Preserve meaningful client-facing statuses (e.g. 400 bad model,
    // 401/403 auth/RBAC, 429 rate/budget, 400 guardrail block).
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    return new ApiError(safeStatus, upstreamMessage, {
      code: "litellm_upstream_error",
    });
  }

  // No response — timeout or network failure.
  if (error.code === "ECONNABORTED") {
    logger.error("LiteLLM request timed out", {
      model,
      timeout: config.litellm.requestTimeoutMs,
    });
    return new ApiError(504, "The AI gateway timed out. Please try again.", {
      code: "gateway_timeout",
    });
  }

  logger.error("Failed to reach LiteLLM gateway", {
    model,
    reason: error.message,
  });
  return new ApiError(502, "Unable to reach the AI gateway.", {
    code: "gateway_unreachable",
  });
}

export default { buildChatPayload, createChatCompletion };
