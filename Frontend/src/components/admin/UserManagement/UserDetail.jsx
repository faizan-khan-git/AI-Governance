import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchUserDetail, saveQuota } from "../../../api/admin.js";
import StatCard from "../shared/StatCard.jsx";
import DataTable from "../shared/DataTable.jsx";
import sharedStyles from "../shared/shared.module.css";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  FiArrowLeft,
  FiUser,
  FiZap,
  FiDollarSign,
  FiActivity,
  FiSliders,
  FiShield,
  FiSlash,
  FiCheck,
} from "react-icons/fi";

export default function UserDetail() {
  const { endUser } = useParams();
  const { auth } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Quick quota editor state
  const [isEditingQuota, setIsEditingQuota] = useState(false);
  const [quotaForm, setQuotaForm] = useState({
    display_name: "",
    daily_token_limit: "",
    monthly_token_limit: "",
    is_blocked: false,
    notes: "",
  });
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchUserDetail(auth, endUser);
      setData(res);
      setQuotaForm({
        display_name: res.quota?.display_name || res.user?.display_name || "",
        daily_token_limit: res.quota?.daily_token_limit || "",
        monthly_token_limit: res.quota?.monthly_token_limit || "",
        is_blocked: res.quota?.is_blocked || false,
        notes: res.quota?.notes || "",
      });
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load user telemetry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [auth, endUser]);

  const handleSaveQuota = async (e) => {
    e.preventDefault();
    try {
      await saveQuota(auth, endUser, {
        display_name: quotaForm.display_name,
        daily_token_limit: quotaForm.daily_token_limit ? Number(quotaForm.daily_token_limit) : null,
        monthly_token_limit: quotaForm.monthly_token_limit ? Number(quotaForm.monthly_token_limit) : null,
        is_blocked: quotaForm.is_blocked,
        notes: quotaForm.notes,
      });
      setSaveSuccess(true);
      setIsEditingQuota(false);
      setTimeout(() => setSaveSuccess(false), 3000);
      loadData();
    } catch (err) {
      alert("Error saving quota: " + err.message);
    }
  };

  if (loading) {
    return <div className={sharedStyles.emptyState}>Loading user governance profile...</div>;
  }

  if (error || !data) {
    return (
      <div className={sharedStyles.emptyState}>
        <div className={sharedStyles.emptyIcon}>⚠️</div>
        <h3>Failed to load user</h3>
        <p>{error}</p>
        <Link to="/admin/users" className={sharedStyles.pageBtn}>
          Back to Directory
        </Link>
      </div>
    );
  }

  const { user, dailyUsage, recentLogs, quota } = data;

  const logColumns = [
    {
      header: "Timestamp",
      key: "created_at",
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      header: "Model",
      key: "model_used",
      render: (val, row) => val || row.model_requested,
    },
    {
      header: "Tokens (Total)",
      key: "total_tokens",
      render: (val) => Number(val).toLocaleString(),
    },
    {
      header: "Spend",
      key: "response_cost_usd",
      render: (val) => `$${Number(val || 0).toFixed(5)}`,
    },
    {
      header: "Status",
      key: "status_code",
      render: (val) => (
        <span
          className={`${sharedStyles.badge} ${
            Number(val) < 400 ? sharedStyles.badgeSuccess : sharedStyles.badgeDanger
          }`}
        >
          {val}
        </span>
      ),
    },
    {
      header: "Guardrails",
      key: "guardrails",
      render: (_, row) => {
        if (row.guardrail_security_triggered) {
          return <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>BLOCKED</span>;
        }
        if (row.guardrail_security_flagged) {
          return <span className={`${sharedStyles.badge} ${sharedStyles.badgeWarning}`}>FLAGGED</span>;
        }
        if (row.guardrail_pii_triggered) {
          return <span className={`${sharedStyles.badge} ${sharedStyles.badgeInfo}`}>PII MASKED</span>;
        }
        return <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>Passed</span>;
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link
          to="/admin/users"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--accent)",
            textDecoration: "none",
            fontSize: "0.85rem",
            marginBottom: 8,
          }}
        >
          <FiArrowLeft /> Back to User Directory
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", fontSize: "1.5rem", fontWeight: 700 }}>
              {user.display_name || "Anonymous User Profile"}
            </h2>
            <div style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              End-User Hash: {endUser}
            </div>
          </div>
          <button
            type="button"
            className={sharedStyles.pageBtn}
            onClick={() => setIsEditingQuota(!isEditingQuota)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <FiSliders /> {isEditingQuota ? "Cancel Editing" : "Configure Range & Limits"}
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div
          style={{
            background: "rgba(68, 240, 176, 0.15)",
            border: "1px solid rgba(68, 240, 176, 0.3)",
            color: "var(--success)",
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <FiCheck /> Quota boundaries and permissions updated successfully!
        </div>
      )}

      {/* Quota Configuration Form */}
      {isEditingQuota && (
        <form
          onSubmit={handleSaveQuota}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            padding: 20,
            marginBottom: 24,
            backdropFilter: "var(--glass-blur)",
          }}
        >
          <h3 style={{ margin: "0 0 14px 0", fontSize: "1.05rem" }}>
            Set Utilization Boundaries for {user.display_name || endUser}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>
                Display Name / Department Label
              </label>
              <input
                type="text"
                className={sharedStyles.filterInput}
                placeholder="e.g. John Doe (Finance)"
                value={quotaForm.display_name}
                onChange={(e) => setQuotaForm({ ...quotaForm, display_name: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>
                Daily Token Limit (Ceiling)
              </label>
              <input
                type="number"
                className={sharedStyles.filterInput}
                placeholder="e.g. 50000 (empty = unlimited)"
                value={quotaForm.daily_token_limit}
                onChange={(e) => setQuotaForm({ ...quotaForm, daily_token_limit: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>
                Monthly Token Limit (Ceiling)
              </label>
              <input
                type="number"
                className={sharedStyles.filterInput}
                placeholder="e.g. 1000000"
                value={quotaForm.monthly_token_limit}
                onChange={(e) => setQuotaForm({ ...quotaForm, monthly_token_limit: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 16 }}>
            <label className={sharedStyles.filterCheckbox} style={{ color: "var(--danger)" }}>
              <input
                type="checkbox"
                checked={quotaForm.is_blocked}
                onChange={(e) => setQuotaForm({ ...quotaForm, is_blocked: e.target.checked })}
              />
              <span style={{ fontWeight: 600 }}>Block User (Deny all future prompts with 403)</span>
            </label>

            <button type="submit" className={sharedStyles.filterBtn} style={{ marginLeft: "auto" }}>
              Save Limits
            </button>
          </div>
        </form>
      )}

      {/* KPI Cards for User */}
      <div className={sharedStyles.statGrid}>
        <StatCard
          title="Total Tokens"
          value={Number(user.total_tokens || 0).toLocaleString()}
          subtitle="All-time consumption"
          icon={<FiZap />}
          variant="success"
        />
        <StatCard
          title="Total Spend"
          value={`$${Number(user.total_cost_usd || 0).toFixed(4)}`}
          subtitle="Estimated gateway cost"
          icon={<FiDollarSign />}
        />
        <StatCard
          title="Total Requests"
          value={Number(user.total_requests || 0).toLocaleString()}
          subtitle="Executed prompts"
          icon={<FiActivity />}
        />
        <StatCard
          title="Access Status"
          value={user.is_blocked ? "BLOCKED" : "ACTIVE"}
          subtitle={
            user.daily_token_limit
              ? `Limit: ${Number(user.daily_token_limit).toLocaleString()}/day`
              : "Unlimited usage"
          }
          icon={user.is_blocked ? <FiSlash /> : <FiUser />}
          variant={user.is_blocked ? "danger" : "default"}
        />
      </div>

      {/* 30-Day Activity Chart */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: "0 0 14px 0", fontSize: "0.95rem" }}>30-Day Token Utilization Telemetry</h3>
        <div style={{ width: "100%", height: 220 }}>
          {dailyUsage.length === 0 ? (
            <div className={sharedStyles.emptyState} style={{ padding: 40 }}>
              No activity in the last 30 days.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyUsage}>
                <defs>
                  <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(10, 12, 26, 0.95)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="daily_tokens"
                  stroke="var(--accent)"
                  fillOpacity={1}
                  fill="url(#userGrad)"
                  name="Daily Tokens"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent User Prompts / Audit Telemetry */}
      <div>
        <h3 style={{ margin: "0 0 12px 0", fontSize: "1.05rem" }}>Recent Request Metadata</h3>
        <DataTable
          columns={logColumns}
          data={recentLogs}
          emptyMessage="No recent requests recorded for this user."
        />
      </div>
    </div>
  );
}

