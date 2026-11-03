import { Link } from "react-router-dom";
import HealthBadge from "../HealthBadge/HealthBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { FiSliders, FiLogOut } from "react-icons/fi";
import styles from "./Header.module.css";

/**
 * Top bar: brand, connection state, and the signed-in user.
 *
 * The role now comes from the Backend session, not from a token the page
 * decodes, so it cannot be spoofed by editing local storage.
 */
export default function Header({ onClear, hasMessages }) {
  const { user, isAdmin, signOut } = useAuth();

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

        {user && (
          <span className={styles.user} title={user.email}>
            <span className={styles.userName}>{user.displayName}</span>
            <span className={styles.userRole}>{user.role}</span>
          </span>
        )}

        {isAdmin && (
          <Link to="/admin" className={styles.adminLink} title="Open AI Governance Admin Portal">
            <FiSliders /> Admin Portal
          </Link>
        )}

        <button
          type="button"
          className={styles.clear}
          onClick={onClear}
          disabled={!hasMessages}
          title="Clear the conversation"
        >
          Clear chat
        </button>

        <button
          type="button"
          className={styles.signOut}
          onClick={signOut}
          title="Sign out"
        >
          <FiLogOut />
        </button>
      </div>
    </div>
  );
}
