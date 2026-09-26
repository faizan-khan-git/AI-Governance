import {
  buildChatPayload,
  createChatCompletion,
} from "../services/litellm.service.js";
import { sanitizeChatResponse } from "../utils/sanitize.js";
import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";

const MAX_TEXT_LENGTH = 32000;

/**
 * Extract the raw user text from a request that may arrive as:
 *   - text/plain body (raw string)
 *   - JSON body: { text | message | prompt: string, ... }
 *
 * @param {import('express').Request} req
 * @returns {string} the raw user text (trimmed of surrounding whitespace only)
 */
function extractText(req) {
  const { body } = req;

  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object") {
    const candidate = body.text ?? body.message ?? body.prompt;
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return "";
}

/**
 * POST /api/chat
 *
 * Receives raw text, formats it into a standard OpenAI-compatible payload,
 * forwards it to the internal LiteLLM gateway (auth handled in the service
 * layer), and returns the sanitized response to the client.
 */
export async function handleChat(req, res, next) {
  try {
    const text = extractText(req);

    if (!text || !text.trim()) {
      throw new ApiError(400, "Request must include non-empty text.", {
        code: "invalid_request",
        details:
          'Send raw text (text/plain) or JSON with a "text"/"message"/"prompt" field.',
      });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      throw new ApiError(413, "Input text is too large.", {
        code: "payload_too_large",
        details: `Maximum allowed length is ${MAX_TEXT_LENGTH} characters.`,
      });
    }

    // Optional overrides are only honored when sent as a JSON object.
    const overrides = req.body && typeof req.body === "object" ? req.body : {};

    const payload = buildChatPayload({
      text,
      model: overrides.model,
      temperature: overrides.temperature,
      system: overrides.system,
    });

    logger.info("Forwarding chat request to LiteLLM", {
      model: payload.model,
      messageCount: payload.messages.length,
    });

    const upstream = await createChatCompletion(payload);
    const sanitized = sanitizeChatResponse(upstream);

    res.status(200).json({ success: true, data: sanitized });
  } catch (error) {
    next(error);
  }
}

export default { handleChat };
