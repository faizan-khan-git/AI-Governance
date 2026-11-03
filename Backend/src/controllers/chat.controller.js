import config from "../config/index.js";
import {
  buildChatPayload,
  createChatCompletion,
} from "../services/litellm.service.js";
import { parseChatRequest } from "../validators/chat.validator.js";
import { sanitizeChatResponse } from "../utils/sanitize.js";
import { saveTranscript } from "../services/transcript.service.js";
import logger from "../utils/logger.js";

/**
 * POST /api/chat
 *
 * Validates the request, formats it into a standard OpenAI-compatible payload
 * (including prior conversation turns), forwards it to the internal LiteLLM
 * gateway (auth handled in the service layer), and returns the sanitized response.
 */
export async function handleChat(req, res, next) {
  const startedAt = Date.now();
  let request = null;
  let payload = null;

  try {
    request = parseChatRequest(req.body, config.limits);
    payload = buildChatPayload(request);

    logger.info("Forwarding chat request to LiteLLM", {
      model: payload.model,
      role: req.auth?.role,
      messageCount: payload.messages.length,
      historyCount: request.history.length,
    });

    const upstream = await createChatCompletion(payload, {
      virtualKey: req.auth?.virtualKey,
      endUserId: req.auth?.endUserId,
    });
    const sanitized = sanitizeChatResponse(upstream);

    res.status(200).json({ success: true, data: sanitized });

    // Stored after the response is sent: a storage failure can never cost the
    // caller their answer, and the response contract above is unchanged.
    void saveTranscript({
      requestId: sanitized?.id,
      endUser: req.auth?.endUserId,
      model: payload.model,
      systemPrompt: request.system,
      promptText: request.text,
      responseText: sanitized?.message?.content,
      historyCount: request.history.length,
      usage: sanitized?.usage,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Record what was attempted, even when the gateway or a guardrail rejected it.
    if (request && payload) {
      void saveTranscript({
        endUser: req.auth?.endUserId,
        model: payload.model,
        systemPrompt: request.system,
        promptText: request.text,
        historyCount: request.history.length,
        statusCode: error.statusCode ?? 500,
        errorCode: error.code ?? "upstream_error",
        latencyMs: Date.now() - startedAt,
      });
    }
    next(error);
  }
}

export default { handleChat };
