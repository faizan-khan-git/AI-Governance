import { FiUserCheck, FiLogOut } from "react-icons/fi";

import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./AuthPanel.module.css";

/**
 * Shows who is signed in and what they are allowed to do.
 *
 * Credentials are no longer pasted here: access is granted by an administrator
 * and the session lives in an httpOnly cookie, so there is nothing for the page
 * (or anyone with the browser console) to tamper with.
 */
export default function AuthPanel() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  return (
    <section className={styles.panel} aria-label="Signed-in account">
      <div className={styles.head}>
        <h2 className={styles.title}>
          <FiUserCheck aria-hidden="true" />
          Account
        </h2>
        <span className={styles.badge}>Signed in</span>
      </div>

      <dl className={styles.detailList}>
        <div className={styles.detailRow}>
          <dt>Name</dt>
          <dd>{user.displayName}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Email</dt>
          <dd className={styles.ellipsis} title={user.email}>
            {user.email}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Role</dt>
          <dd className={styles.roleValue}>{user.role}</dd>
        </div>
        {user.department && (
          <div className={styles.detailRow}>
            <dt>Department</dt>
            <dd>{user.department}</dd>
          </div>
        )}
      </dl>

      <button type="button" className={styles.secondary} onClick={signOut}>
        <FiLogOut aria-hidden="true" />
        Sign out
      </button>
    </section>
  );
}
