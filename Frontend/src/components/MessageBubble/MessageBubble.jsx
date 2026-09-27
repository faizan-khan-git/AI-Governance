import { formatNumber } from "../../utils/format.js";
import styles from "./MessageBubble.module.css";

/**
 * Renders a single message. Assistant messages include a metadata footer with
 * the model used, token usage, and finish reason returned by the gateway.
 */
export default function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const meta = message.meta;

  return (
    <div className={styles.row} data-role={isUser ? "user" : "assistant"}>
      <div className={styles.avatar} aria-hidden="true">
        {isUser ? "🧑" : "🤖"}
      </div>

      <div className={styles.bubble}>
        <div className={styles.author}>{isUser ? "You" : "Assistant"}</div>
        <div className={styles.content}>{message.content || "—"}</div>

        {!isUser && meta && (
          <div className={styles.meta}>
            {meta.model && <span className={styles.tag}>{meta.model}</span>}
            {meta.usage?.total_tokens != null && (
              <span className={styles.tag}>
                {formatNumber(meta.usage.total_tokens)} tok
              </span>
            )}
            {meta.finishReason && (
              <span className={styles.tag}>{meta.finishReason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
