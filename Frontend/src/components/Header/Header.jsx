import HealthBadge from "../HealthBadge/HealthBadge.jsx";
import styles from "./Header.module.css";

export default function Header({ onClear, hasMessages }) {
  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          🛡️
        </span>
        <div>
          <h1 className={styles.title}>AI Governance Console</h1>
          <p className={styles.subtitle}>
            LiteLLM Gateway · RBAC · PII &amp; Security Guards
          </p>
        </div>
      </div>

      <div className={styles.actions}>
        <HealthBadge />
        <button
          type="button"
          className={styles.clear}
          onClick={onClear}
          disabled={!hasMessages}
          title="Clear the conversation"
        >
          Clear chat
        </button>
      </div>
    </div>
  );
}
