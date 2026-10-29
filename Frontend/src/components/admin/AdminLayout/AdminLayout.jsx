import { Outlet, Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext.jsx";
import { decodeJwtPayload } from "../../../utils/jwt.js";
import AdminSidebar from "../AdminSidebar/AdminSidebar.jsx";
import HealthBadge from "../../HealthBadge/HealthBadge.jsx";
import { FiArrowLeft, FiLock } from "react-icons/fi";
import styles from "./AdminLayout.module.css";

export default function AdminLayout() {
  const { auth, isAuthenticated } = useAuth();

  const role =
    auth.scheme === "jwt" && auth.token
      ? decodeJwtPayload(auth.token)?.role
      : auth.scheme === "apikey" && auth.token?.includes("admin")
        ? "admin"
        : null;

  const isAdmin = role === "admin";

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className={styles.layout}>
        <div className={styles.restrictedCard}>
          <div className={styles.restrictedIcon} aria-hidden="true">
            🔒
          </div>
          <h2 className={styles.restrictedTitle}>Administrator Access Required</h2>
          <p className={styles.restrictedText}>
            This control portal is reserved for AI Governance administrators. You are currently
            signed in with role <strong>{role || "unauthenticated"}</strong>.
            <br />
            Please connect using an admin JWT token minted with <code>--role admin</code> to view
            and manage security flags, token limits, and audit logs.
          </p>
          <Link to="/" className={styles.returnBtn}>
            <FiArrowLeft />
            Return to Chat Console
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <AdminSidebar />
      <div className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.topTitle}>
            <span>Governance Operations</span>
            <span className={styles.roleTag}>ROLE: ADMIN</span>
          </div>
          <div className={styles.topActions}>
            <HealthBadge />
          </div>
        </header>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

