import { useCallback, useEffect, useState } from "react";

import { request } from "../../../api/client.js";
import shared from "../shared/shared.module.css";
import styles from "./ActivityLog.module.css";

/** Human labels for the actions the Backend records. */
const ACTION_LABELS = {
  "user.invite": "Granted access",
  "user.reinvite": "Restored access",
  "user.role_change": "Changed role",
  "user.suspend": "Suspended user",
  "user.reactivate": "Reactivated user",
  "user.remove": "Revoked access",
  "transcript.view": "Viewed a conversation",
};

const REASON_LABELS = {
  not_invited: "Not invited",
  identity_mismatch: "Invite already claimed",
  account_suspended: "Account suspended",
  account_removed: "Access removed",
  state_mismatch: "Failed CSRF check",
  state_missing: "Expired attempt",
  verification_failed: "Invalid Google token",
};

/**
 * Administrator accountability: every access change, every transcript opened,
 * and every rejected sign-in attempt.
 *
 * The console enforces governance on users, so it has to be governable itself.
 */
export default function ActivityLog() {
  const [actions, setActions] = useState([]);
  const [denials, setDenials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await request("/api/admin/actions?limit=100", { method: "GET" });
      setActions(res?.data ?? []);
      setDenials(res?.denials ?? []);
    } catch (err) {
      setError(err.message ?? "Could not load the activity log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className={styles.head}>
        <h2 className={styles.title}>Admin Activity</h2>
        <p className={styles.subtitle}>
          Every access change and every conversation an administrator opened, plus
          attempts to sign in without permission.
        </p>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Actions</h3>
        <div className={shared.tableContainer}>
          <div className={shared.tableScroll}>
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className={shared.emptyState}>
                      <div className={shared.emptyInner}>Loading…</div>
                    </td>
                  </tr>
                ) : actions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={shared.emptyState}>
                      <div className={shared.emptyInner}>No admin actions recorded yet.</div>
                    </td>
                  </tr>
                ) : (
                  actions.map((a) => (
                    <tr key={a.id}>
                      <td className={styles.muted}>{new Date(a.created_at).toLocaleString()}</td>
                      <td>{a.actor_email ?? "—"}</td>
                      <td>
                        <span className={styles.actionTag}>
                          {ACTION_LABELS[a.action] ?? a.action}
                        </span>
                      </td>
                      <td>{a.target_email ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Refused sign-in attempts</h3>
        <div className={shared.tableContainer}>
          <div className={shared.tableScroll}>
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className={shared.emptyState}>
                      <div className={shared.emptyInner}>Loading…</div>
                    </td>
                  </tr>
                ) : denials.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={shared.emptyState}>
                      <div className={shared.emptyInner}>No refused attempts.</div>
                    </td>
                  </tr>
                ) : (
                  denials.map((d) => (
                    <tr key={d.id}>
                      <td className={styles.muted}>{new Date(d.created_at).toLocaleString()}</td>
                      <td>{d.email ?? "unknown"}</td>
                      <td>
                        <span className={styles.reasonTag}>
                          {REASON_LABELS[d.reason] ?? d.reason}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
