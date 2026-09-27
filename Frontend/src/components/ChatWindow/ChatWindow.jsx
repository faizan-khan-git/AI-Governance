import { useEffect, useRef } from "react";

import MessageBubble from "../MessageBubble/MessageBubble.jsx";
import styles from "./ChatWindow.module.css";

const ERROR_TITLES = {
  unauthenticated: "Authentication required",
  invalid_token: "Invalid or expired token",
  invalid_api_key: "Unrecognized API key",
  invalid_role_claim: "Invalid role",
  role_forbidden: "Role not permitted",
  role_not_provisioned: "Role not provisioned",
  timeout: "Request timed out",
  network_error: "Cannot reach backend",
};

/**
 * Scrollable transcript with an empty state, a live "typing" indicator, and a
 * dismissible error banner that maps Backend/gateway error codes to guidance.
 */
export default function ChatWindow({
  messages,
  sending,
  error,
  onDismissError,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const showEmpty = messages.length === 0 && !sending && !error;

  return (
    <div className={styles.window}>
      {showEmpty && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>💬</div>
          <h3 className={styles.emptyTitle}>Start a governed conversation</h3>
          <p className={styles.emptyText}>
            Set your credential, pick a model, and send a prompt. PII masking,
            security scanning, RBAC, and budget limits are enforced by the
            gateway.
          </p>
        </div>
      )}

      <div className={styles.list}>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {sending && (
          <div className={styles.typing}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </div>
        )}

        {error && (
          <div className={styles.error} role="alert">
            <div className={styles.errorHead}>
              <strong>
                {ERROR_TITLES[error.code] ?? "Request failed"}
                {error.status ? ` · ${error.status}` : ""}
              </strong>
              <button
                type="button"
                className={styles.errorClose}
                onClick={onDismissError}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
            <p className={styles.errorMsg}>{error.message}</p>
            {error.details && (
              <p className={styles.errorDetails}>
                {typeof error.details === "string"
                  ? error.details
                  : JSON.stringify(error.details)}
              </p>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
