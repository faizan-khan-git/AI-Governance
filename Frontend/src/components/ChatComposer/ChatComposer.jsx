import { useState } from "react";

import styles from "./ChatComposer.module.css";

/**
 * Prompt input. Enter sends, Shift+Enter inserts a newline. Sending is blocked
 * while a request is in flight. A non-blocking notice appears when no credential
 * is set (the gateway will otherwise reject with 401 when RBAC is enabled).
 */
export default function ChatComposer({ onSend, sending, authenticated }) {
  const [text, setText] = useState("");

  const submit = () => {
    const value = text.trim();
    if (!value || sending) return;
    onSend(value);
    setText("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.wrap}>
      {!authenticated && (
        <div className={styles.notice}>
          No credential set — add a JWT or API key in the Authentication panel.
          Requests will be rejected if RBAC is enabled on the Backend.
        </div>
      )}

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Send a message…  (Enter to send, Shift+Enter for newline)"
        />
        <button
          type="button"
          className={styles.send}
          onClick={submit}
          disabled={!text.trim() || sending}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
