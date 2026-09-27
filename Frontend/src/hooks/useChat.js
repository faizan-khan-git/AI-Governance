import { useCallback, useState } from "react";

import { sendChat } from "../api/chat.js";
import { useAuth } from "../context/AuthContext.jsx";

let counter = 0;
const nextId = () => `${Date.now()}-${(counter += 1)}`;

/**
 * Owns the conversation state and orchestrates sending a message through the
 * Backend. Assistant messages carry gateway metadata (model, usage, finish
 * reason). Errors are normalized for display and never throw to the UI.
 */
export function useChat() {
  const { auth } = useAuth();
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(
    async ({ text, model, temperature, system }) => {
      const trimmed = String(text ?? "").trim();
      if (!trimmed || sending) return { ok: false };

      setError(null);
      const userMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setSending(true);

      try {
        const response = await sendChat({
          text: trimmed,
          model,
          temperature,
          system,
          auth,
        });
        const data = response?.data ?? {};
        const assistantMessage = {
          id: nextId(),
          role: "assistant",
          content: data?.message?.content ?? "",
          createdAt: new Date().toISOString(),
          meta: {
            model: data?.model ?? model,
            usage: data?.usage ?? null,
            finishReason: data?.finish_reason ?? null,
          },
        };
        setMessages((prev) => [...prev, assistantMessage]);
        return { ok: true };
      } catch (e) {
        setError({
          status: e.status,
          code: e.code,
          message: e.message,
          details: e.details,
        });
        return { ok: false, error: e };
      } finally {
        setSending(false);
      }
    },
    [auth, sending],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { messages, sending, error, send, clear, dismissError };
}

export default useChat;
