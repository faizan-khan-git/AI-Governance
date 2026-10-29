import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchQuotas, saveQuota, deleteQuota } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiSliders, FiPlus, FiTrash2, FiEdit2, FiSlash, FiCheck, FiX } from "react-icons/fi";

export default function QuotaManager() {
  const { auth } = useAuth();
  const [quotas, setQuotas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const [form, setForm] = useState({
    end_user: "",
    display_name: "",
    daily_token_limit: "",
    monthly_token_limit: "",
    daily_cost_limit_usd: "",
    monthly_cost_limit_usd: "",
    is_blocked: false,
    notes: "",
  });

  const loadQuotas = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchQuotas(auth);
      setQuotas(data || []);
    } catch (err) {
      console.error("Failed to load quotas:", err);
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    loadQuotas();
  }, [loadQuotas]);

  const handleOpenAdd = () => {
    setEditingUser(null);
    setForm({
      end_user: "",
      display_name: "",
      daily_token_limit: "",
      monthly_token_limit: "",
      daily_cost_limit_usd: "",
      monthly_cost_limit_usd: "",
      is_blocked: false,
      notes: "",
    });
    setModalOpen(true);
  };

  const handleOpenEdit = (q) => {
    setEditingUser(q.end_user);
    setForm({
      end_user: q.end_user,
      display_name: q.display_name || "",
      daily_token_limit: q.daily_token_limit != null ? String(q.daily_token_limit) : "",
      monthly_token_limit: q.monthly_token_limit != null ? String(q.monthly_token_limit) : "",
      daily_cost_limit_usd: q.daily_cost_limit_usd != null ? String(q.daily_cost_limit_usd) : "",
      monthly_cost_limit_usd: q.monthly_cost_limit_usd != null ? String(q.monthly_cost_limit_usd) : "",
      is_blocked: q.is_blocked || false,
      notes: q.notes || "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (endUser) => {
    if (!window.confirm(`Are you sure you want to remove token limits for ${endUser}?`)) {
      return;
    }
    try {
      await deleteQuota(auth, endUser);
      loadQuotas();
    } catch (err) {
      alert("Error deleting quota: " + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.end_user.trim()) {
      alert("Please provide an end_user hash or identifier.");
      return;
    }

    try {
      await saveQuota(auth, form.end_user.trim(), {
        display_name: form.display_name.trim(),
        daily_token_limit: form.daily_token_limit ? Number(form.daily_token_limit) : null,
        monthly_token_limit: form.monthly_token_limit ? Number(form.monthly_token_limit) : null,
        daily_cost_limit_usd: form.daily_cost_limit_usd ? Number(form.daily_cost_limit_usd) : null,
        monthly_cost_limit_usd: form.monthly_cost_limit_usd ? Number(form.monthly_cost_limit_usd) : null,
        is_blocked: form.is_blocked,
        notes: form.notes.trim(),
      });
      setModalOpen(false);
      loadQuotas();
    } catch (err) {
      alert("Error saving quota: " + err.message);
    }
  };

  const columns = [
    {
      header: "Caller / User",
      key: "end_user",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.display_name || "Custom User"}</div>
          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
            {val}
          </div>
        </div>
      ),
    },
    {
      header: "Access Status",
      key: "is_blocked",
      render: (blocked) =>
        blocked ? (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
            <FiSlash /> BLOCKED
          </span>
        ) : (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeSuccess}`}>
            <FiCheck /> ALLOWED
          </span>
        ),
    },
    {
      header: "Daily Utilization / Limit",
      key: "daily_limit",
      render: (_, row) => {
        const used = Number(row.today_tokens_used || 0);
        const limit = row.daily_token_limit ? Number(row.daily_token_limit) : null;
        if (!limit) {
          return (
            <div>
              <span style={{ fontSize: "0.85rem" }}>{used.toLocaleString()} tokens</span>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>No daily ceiling</div>
            </div>
          );
        }
        const pct = Math.min(100, Math.round((used / limit) * 100));
        const isNear = pct >= 80;
        return (
          <div style={{ width: 160 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 3 }}>
              <span>{used.toLocaleString()} / {limit.toLocaleString()}</span>
              <span style={{ fontWeight: 600, color: isNear ? "var(--danger)" : "var(--cyan)" }}>
                {pct}%
              </span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: isNear ? "var(--danger)" : "linear-gradient(90deg, var(--cyan), var(--accent))",
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        );
      },
    },
    {
      header: "Monthly Limit",
      key: "monthly_token_limit",
      render: (val) => (val ? `${Number(val).toLocaleString()} tokens` : "Unlimited"),
    },
    {
      header: "Cost Limits",
      key: "cost_limits",
      render: (_, row) => {
        const daily = row.daily_cost_limit_usd ? `$${Number(row.daily_cost_limit_usd).toFixed(2)}/d` : null;
        const monthly = row.monthly_cost_limit_usd ? `$${Number(row.monthly_cost_limit_usd).toFixed(2)}/mo` : null;
        if (!daily && !monthly) return <span style={{ color: "var(--text-muted)" }}>Unlimited</span>;
        return [daily, monthly].filter(Boolean).join(" · ");
      },
    },
    {
      header: "Notes",
      key: "notes",
      render: (val) => val || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      header: "Actions",
      key: "actions",
      render: (_, row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={sharedStyles.pageBtn}
            onClick={() => handleOpenEdit(row)}
            title="Edit limits"
          >
            <FiEdit2 /> Edit
          </button>
          <button
            type="button"
            className={sharedStyles.pageBtn}
            onClick={() => handleDelete(row.end_user)}
            style={{ color: "var(--danger)" }}
            title="Remove limit"
          >
            <FiTrash2 />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>
            Token Quotas &amp; Range Management
          </h2>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Set hard token ranges, maximum utilization ceilings, and access controls so users cannot exceed assigned thresholds.
          </p>
        </div>
        <button
          type="button"
          className={sharedStyles.filterBtn}
          onClick={handleOpenAdd}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <FiPlus /> Set New Quota Boundary
        </button>
      </div>

      <DataTable
        columns={columns}
        data={quotas}
        loading={loading}
        emptyMessage="No customized user quotas set. All authenticated users operate under the global virtual key tiers."
      />

      {/* Modal Dialog */}
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
          }}
          onClick={() => setModalOpen(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              backdropFilter: "var(--glass-blur)",
              borderRadius: "var(--radius-sm)",
              width: "100%",
              maxWidth: 540,
              padding: 24,
              boxShadow: "var(--depth-2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem" }}>
                {editingUser ? "Edit User Utilization Boundaries" : "Configure Token Quota"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                <FiX />
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  End-User Hash / Identifier *
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingUser)}
                  className={sharedStyles.filterInput}
                  placeholder="e.g. u_8c827e00df21b592234f2d62 or sub"
                  value={form.end_user}
                  onChange={(e) => setForm({ ...form, end_user: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  Display Name / Department Label
                </label>
                <input
                  type="text"
                  className={sharedStyles.filterInput}
                  placeholder="e.g. Finance Team Caller"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                    Daily Token Limit (Ceiling)
                  </label>
                  <input
                    type="number"
                    className={sharedStyles.filterInput}
                    placeholder="e.g. 50000"
                    value={form.daily_token_limit}
                    onChange={(e) => setForm({ ...form, daily_token_limit: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                    Monthly Token Limit
                  </label>
                  <input
                    type="number"
                    className={sharedStyles.filterInput}
                    placeholder="e.g. 1000000"
                    value={form.monthly_token_limit}
                    onChange={(e) => setForm({ ...form, monthly_token_limit: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                    Daily Cost Limit ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className={sharedStyles.filterInput}
                    placeholder="e.g. 5.00"
                    value={form.daily_cost_limit_usd}
                    onChange={(e) => setForm({ ...form, daily_cost_limit_usd: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                    Monthly Cost Limit ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className={sharedStyles.filterInput}
                    placeholder="e.g. 50.00"
                    value={form.monthly_cost_limit_usd}
                    onChange={(e) => setForm({ ...form, monthly_cost_limit_usd: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  Governance Notes / Policy Justification
                </label>
                <input
                  type="text"
                  className={sharedStyles.filterInput}
                  placeholder="e.g. Project Apollo batch testing"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ padding: "10px 12px", background: "rgba(255,93,122,0.1)", borderRadius: 8, border: "1px solid rgba(255,93,122,0.25)" }}>
                <label className={sharedStyles.filterCheckbox} style={{ color: "var(--danger)" }}>
                  <input
                    type="checkbox"
                    checked={form.is_blocked}
                    onChange={(e) => setForm({ ...form, is_blocked: e.target.checked })}
                  />
                  <span style={{ fontWeight: 600 }}>Block this user (Immediate 403 Forbidden on all requests)</span>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className={sharedStyles.resetBtn}
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={sharedStyles.filterBtn}>
                  {editingUser ? "Update Limits" : "Create Quota"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

