import { NavLink, Link } from "react-router-dom";
import {
  FiPieChart,
  FiFileText,
  FiAlertTriangle,
  FiShield,
  FiUsers,
  FiSliders,
  FiCpu,
  FiArrowLeft,
} from "react-icons/fi";
import styles from "./AdminSidebar.module.css";

const NAV_ITEMS = [
  { path: "/admin", label: "Overview", icon: <FiPieChart />, end: true },
  { path: "/admin/audit-logs", label: "Audit Logs", icon: <FiFileText /> },
  { path: "/admin/flagged", label: "Flagged Prompts", icon: <FiAlertTriangle /> },
  { path: "/admin/pii-incidents", label: "PII Incidents", icon: <FiShield /> },
  { path: "/admin/users", label: "User Directory", icon: <FiUsers /> },
  { path: "/admin/quotas", label: "Token Quotas & Range", icon: <FiSliders /> },
  { path: "/admin/systems", label: "AI Systems Registry", icon: <FiCpu /> },
];

export default function AdminSidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          🛡️
        </span>
        <div>
          <h2 className={styles.title}>AI Governance</h2>
          <span className={styles.badge}>ADMIN PORTAL</span>
        </div>
      </div>

      <nav className={styles.nav}>
        <span className={styles.navSection}>Governance Controls</span>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              isActive
                ? `${styles.navLink} ${styles.navLinkActive}`
                : styles.navLink
            }
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        <Link to="/" className={styles.backBtn}>
          <FiArrowLeft />
          <span>Back to Chat Console</span>
        </Link>
      </div>
    </aside>
  );
}

