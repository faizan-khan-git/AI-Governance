import ApiError from "../utils/ApiError.js";

/** Model names such as `gpt-4o`, `openai/gpt-4o` or `bedrock/anthropic.claude-v2:1`. */
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/**
 * Roles a client may place in `history`. `system` is excluded on purpose: the
 * system prompt has its own field, so a forged history entry cannot smuggle one in.
 */
const HISTORY_ROLES = Object.freeze(["user", "assistant"]);

const invalid = (message, details) =>
  new ApiError(400, message, { code: "invalid_request", details });

const tooLarge = (message, details) =>
  new ApiError(413, message, { code: "payload_too_large", details });

/**
 * Extract the raw user text from a request that may arrive as:
 *   - a text/plain body (raw string)
 *   - a JSON body: { text | message | prompt: string, ... }
 *
 * @param {unknown} body the parsed request body
 * @returns {string} the raw text, or "" when none was supplied
 */
export function extractText(body) {
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

function parseModel(value) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw invalid('"model" must be a string.');
  }
  const model = value.trim();
  if (!model) return undefined;
  if (!MODEL_PATTERN.test(model)) {
    throw invalid('"model" contains unsupported characters or is too long.');
  }
  return model;
}

function parseTemperature(value) {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw invalid('"temperature" must be a number between 0 and 2.');
  }
  return value;
}

function parseSystem(value, maxLength) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw invalid('"system" must be a string.');
  }
  if (!value.trim()) return undefined;
  if (value.length > maxLength) {
    throw tooLarge(
      "System prompt is too large.",
      `Maximum allowed length is ${maxLength} characters.`,
    );
  }
  return value;
}

function parseHistory(value, limits) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw invalid('"history" must be an array of { role, content } messages.');
  }
  if (value.length > limits.maxHistoryMessages) {
    throw tooLarge(
      "Conversation history is too long.",
      `At most ${limits.maxHistoryMessages} history messages are allowed.`,
    );
  }

  let totalChars = 0;
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalid(`history[${index}] must be an object.`);
    }
    if (!HISTORY_ROLES.includes(entry.role)) {
      throw invalid(`history[${index}].role must be "user" or "assistant".`);
    }
    if (typeof entry.content !== "string" || !entry.content.trim()) {
      throw invalid(`history[${index}].content must be a non-empty string.`);
    }
    if (entry.content.length > limits.maxTextLength) {
      throw tooLarge(
        "A history message is too large.",
        `history[${index}] exceeds ${limits.maxTextLength} characters.`,
      );
    }
    totalChars += entry.content.length;
    if (totalChars > limits.maxHistoryChars) {
      throw tooLarge(
        "Conversation history is too large.",
        `The history may contain at most ${limits.maxHistoryChars} characters in total.`,
      );
    }
    // Whitelist the fields we forward; anything else a client sends is dropped.
    return { role: entry.role, content: entry.content };
  });
}

/**
 * Validate and normalize a chat request.
 *
 * Optional fields are only honored when the body is a JSON object; a text/plain
 * body carries just the prompt. Every violation raises an ApiError (400 / 413) so
 * malformed input is rejected here instead of failing later with a 500.
 *
 * @param {unknown} body the parsed request body
 * @param {{ maxTextLength: number, maxSystemLength: number,
 *           maxHistoryMessages: number, maxHistoryChars: number }} limits
 * @returns {{ text: string, model?: string, temperature?: number,
 *             system?: string, history: Array<{ role: string, content: string }> }}
 * @throws {ApiError}
 */
export function parseChatRequest(body, limits) {
  const text = extractText(body);

  if (!text.trim()) {
    throw invalid(
      "Request must include non-empty text.",
      'Send raw text (text/plain) or JSON with a "text"/"message"/"prompt" field.',
    );
  }
  if (text.length > limits.maxTextLength) {
    throw tooLarge(
      "Input text is too large.",
      `Maximum allowed length is ${limits.maxTextLength} characters.`,
    );
  }

  const options =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};

  return {
    text,
    model: parseModel(options.model),
    temperature: parseTemperature(options.temperature),
    system: parseSystem(options.system, limits.maxSystemLength),
    history: parseHistory(options.history, limits),
  };
}

export default { parseChatRequest, extractText };
