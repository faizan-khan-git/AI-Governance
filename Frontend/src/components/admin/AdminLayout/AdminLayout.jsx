import { useState } from "react";
import { Outlet, Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext.jsx";
import AdminSidebar from "../AdminSidebar/AdminSidebar.jsx";
import HealthBadge from "../../HealthBadge/HealthBadge.jsx";
import { FiArrowLeft, FiLock, FiMenu } from "react-icons/fi";
import styles from "./AdminLayout.module.css";

export default function AdminLayout() {
  // The role comes from the verified session, not from anything the page decodes.
  const { user, isAuthenticated, isAdmin } = useAuth();
  const role = user?.role ?? null;
  // Drawer state for small screens; the sidebar is always inline on desktop.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

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
            Ask an administrator to grant your account the admin role to view and manage
            users, security flags, limits and audit logs.
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
      <AdminSidebar
        open={navOpen}
        onClose={closeNav}
        onNavigate={closeNav}
      />
      <div className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.topTitle}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setNavOpen((open) => !open)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
            >
              <FiMenu />
            </button>
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

