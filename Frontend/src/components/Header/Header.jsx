import { Link } from "react-router-dom";
import HealthBadge from "../HealthBadge/HealthBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { decodeJwtPayload } from "../../utils/jwt.js";
import { FiSliders } from "react-icons/fi";
import styles from "./Header.module.css";

export default function Header({ onClear, hasMessages }) {
  const { auth } = useAuth();

  const role =
    auth.scheme === "jwt" && auth.token
      ? decodeJwtPayload(auth.token)?.role
      : auth.scheme === "apikey" && auth.token?.includes("admin")
        ? "admin"
        : null;

  const isAdmin = role === "admin";

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
      </div>
    </div>
  );
}
