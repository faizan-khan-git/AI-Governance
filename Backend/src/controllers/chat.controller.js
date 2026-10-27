import config from "../config/index.js";
import {
  buildChatPayload,
  createChatCompletion,
} from "../services/litellm.service.js";
import { parseChatRequest } from "../validators/chat.validator.js";
import { sanitizeChatResponse } from "../utils/sanitize.js";
import logger from "../utils/logger.js";

/**
 * POST /api/chat
 *
 * Validates the request, formats it into a standard OpenAI-compatible payload
 * (including prior conversation turns), forwards it to the internal LiteLLM
 * gateway (auth handled in the service layer), and returns the sanitized response.
 */
export async function handleChat(req, res, next) {
  try {
    const request = parseChatRequest(req.body, config.limits);
    const payload = buildChatPayload(request);

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
  } catch (error) {
    next(error);
  }
}

export default { handleChat };
