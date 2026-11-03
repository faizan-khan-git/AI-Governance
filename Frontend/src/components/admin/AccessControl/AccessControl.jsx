import { useEffect, useMemo, useState } from "react";
import { FiUserPlus, FiTrash2, FiShield, FiX, FiCheck } from "react-icons/fi";

import { request } from "../../../api/client.js";
import { useAuth } from "../../../context/AuthContext.jsx";
import shared from "../shared/shared.module.css";
import styles from "./AccessControl.module.css";

/** Roles an administrator can grant. */
const ROLES = [
  { id: "dev", label: "Developer", hint: "Cheap models only" },
  { id: "standard", label: "Standard", hint: "Mid-tier models" },
  { id: "admin", label: "Administrator", hint: "Full access + console" },
];

const STATUS_LABELS = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  removed: "Removed",
};

/**
 * Access control: the only place access to the console is granted.
 *
 * Invite-only by design — a person cannot use the product until they appear in
 * this list with a role.
 */
export default function AccessControl() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState({ email: "", role: "dev", displayName: "", department: "" });

  const load = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (status) params.set("status", status);
        const res = await request(`/api/admin/access?${params.toString()}`, { method: "GET" });
        setUsers(res?.data ?? []);
      } catch (err) {
        setError(err.message ?? "Could not load the access list.");
      } finally {
        setLoading(false);
      }
    },
    [search, status],
  );

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message, kind = "ok") => {
    setNotice({ message, kind });
    setTimeout(() => setNotice(null), 4000);
  };

  const invite = async (e) => {
    e.preventDefault();
    setBusy("invite");
    setError(null);
    try {
      await request("/api/admin/access", { method: "POST", body: form });
      setShowInvite(false);
      setForm({ email: "", role: "dev", displayName: "", department: "" });
      await load();
      flash("Invitation created. They can sign in with that Google account.");
    } catch (err) {
      setError(err.message ?? "Could not create the invitation.");
    } finally {
      setBusy(null);
    }
  };

  const patch = async (endUser, body, message) => {
    setBusy(endUser);
    setError(null);
    try {
      await request(`/api/admin/access/${endUser}`, { method: "PATCH", body });
      await load();
      flash(message);
    } catch (err) {
      setError(err.message ?? "Could not update the user.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (endUser, email) => {
    if (!window.confirm(`Revoke access for ${email}? Their history is kept for audit.`)) return;
    setBusy(endUser);
    setError(null);
    try {
      await request(`/api/admin/access/${endUser}`, { method: "DELETE" });
      await load();
      flash("Access revoked.");
    } catch (err) {
      setError(err.message ?? "Could not revoke access.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>User Access</h2>
          <p className={styles.subtitle}>
            Only people listed here can use the console. Everyone signs in with their
            own Google account, which is bound on first sign-in.
          </p>
        </div>
        <button type="button" className={styles.inviteBtn} onClick={() => setShowInvite(true)}>
          <FiUserPlus aria-hidden="true" />
          Add user
        </button>
      </header>

      {notice && (
        <p className={styles.notice} role="status">
          {notice.message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={shared.filterBar} onSubmit={(e) => e.preventDefault()}>
        <input
          className={shared.filterInput}
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={shared.filterSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="invited">Invited</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="removed">Removed</option>
        </select>
      </form>

      <div className={shared.tableContainer}>
        <div className={shared.tableScroll}>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Last active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className={shared.emptyState}>
                    <div className={shared.emptyInner}>
                      <div className={shared.emptyIcon}>⏳</div>
                      <div>Loading the access list…</div>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className={shared.emptyState}>
                    <div className={shared.emptyInner}>
                      <div className={shared.emptyIcon}>👥</div>
                      <div>No users yet. Use “Add user” to grant access.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isMe = u.end_user === me?.endUser;
                  return (
                    <tr key={u.end_user}>
                      <td>
                        <div className={styles.userCell}>
                          <span className={styles.userName}>
                            {u.display_name}
                            {isMe && <span className={styles.youTag}>you</span>}
                          </span>
                          <span className={styles.userEmail}>{u.email}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          className={styles.roleSelect}
                          value={u.role}
                          disabled={busy === u.end_user || u.status === "removed"}
                          onChange={(e) =>
                            patch(u.end_user, { role: e.target.value }, "Role updated.")
                          }
                          aria-label={`Role for ${u.email}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`${styles.status} ${styles[`status_${u.status}`]}`}>
                          {STATUS_LABELS[u.status] ?? u.status}
                        </span>
                      </td>
                      <td>{u.total_requests}</td>
                      <td>{Number(u.total_tokens).toLocaleString()}</td>
                      <td className={styles.muted}>
                        {u.last_active_at ? new Date(u.last_active_at).toLocaleString() : "—"}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {u.status === "active" && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              disabled={busy === u.end_user}
                              onClick={() => patch(u.end_user, { status: "suspended" }, "User suspended.")}
                              title="Suspend access"
                            >
                              <FiX />
                            </button>
                          )}
                          {u.status === "suspended" && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              disabled={busy === u.end_user}
                              onClick={() => patch(u.end_user, { status: "invited" }, "Access restored.")}
                              title="Restore access"
                            >
                              <FiCheck />
                            </button>
                          )}
                          {u.status !== "removed" && !isMe && (
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.danger}`}
                              disabled={busy === u.end_user}
                              onClick={() => remove(u.end_user, u.email)}
                              title="Revoke access"
                            >
                              <FiTrash2 />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setShowInvite(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="invite-title" className={styles.modalTitle}>
              <FiShield aria-hidden="true" />
              Grant access
            </h3>
            <p className={styles.modalHint}>
              They sign in with this Google account. Access is granted the moment you
              add them; they do not need an invitation email.
            </p>

            <form onSubmit={invite} className={styles.form}>
              <label className={styles.field}>
                <span>Email</span>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>

              <label className={styles.field}>
                <span>Role</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} — {r.hint}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Full name (optional)</span>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </label>

              <label className={styles.field}>
                <span>Department (optional)</span>
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </label>

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowInvite(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.confirm} disabled={busy === "invite"}>
                  {busy === "invite" ? "Adding…" : "Add user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
