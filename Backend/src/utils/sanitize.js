/**
 * Response sanitizer.
 *
 * The LiteLLM gateway already performs PII rehydration (Presidio) and output
 * scanning (LLM Guard) before it returns. This layer is a final, defensive pass
 * that shapes the upstream response into a minimal, client-safe contract:
 *   - strips internal/provider bookkeeping fields
 *   - never leaks upstream auth, headers, or system prompts
 *   - normalizes the assistant message and usage stats
 *
 * @param {object} upstream the raw JSON body returned by LiteLLM
 * @returns {object} a sanitized, client-facing response
 */
export function sanitizeChatResponse(upstream) {
  if (!upstream || typeof upstream !== "object") {
    return { id: null, model: null, message: null, usage: null };
  }

  const firstChoice = Array.isArray(upstream.choices)
    ? upstream.choices[0]
    : undefined;
  const rawMessage = firstChoice?.message ?? {};

  const message = {
    role: typeof rawMessage.role === "string" ? rawMessage.role : "assistant",
    content: typeof rawMessage.content === "string" ? rawMessage.content : "",
  };

  const usage = upstream.usage
    ? {
        prompt_tokens: upstream.usage.prompt_tokens ?? 0,
        completion_tokens: upstream.usage.completion_tokens ?? 0,
        total_tokens: upstream.usage.total_tokens ?? 0,
      }
    : null;

  return {
    id: upstream.id ?? null,
    model: upstream.model ?? null,
    created: upstream.created ?? null,
    finish_reason: firstChoice?.finish_reason ?? null,
    message,
    usage,
  };
}

export default sanitizeChatResponse;
