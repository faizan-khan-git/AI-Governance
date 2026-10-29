import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchUsers } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import FilterBar from "../shared/FilterBar.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiUser, FiZap, FiExternalLink, FiSliders, FiSlash } from "react-icons/fi";

export default function UserManagement() {
  const { auth } = useAuth();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadUsers = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        const res = await fetchUsers(auth, {
          page,
          limit: pagination.limit,
          search: search || undefined,
        });
        setUsers(res.data || []);
        setPagination(res.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("Failed to load users summary:", err);
      } finally {
        setLoading(false);
      }
    },
    [auth, search, pagination.limit],
  );

  useEffect(() => {
    loadUsers(1);
  }, [loadUsers]);

  const columns = [
    {
      header: "Caller / User",
      key: "end_user",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <FiUser style={{ color: "var(--accent)" }} />
            {row.display_name || "Anonymous User"}
          </div>
          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            {val}
          </div>
        </div>
      ),
    },
    {
      header: "Total Requests",
      key: "total_requests",
      render: (val) => Number(val || 0).toLocaleString(),
    },
    {
      header: "Token Consumption",
      key: "total_tokens",
      render: (val, row) => (
        <div>
          <span style={{ color: "var(--cyan)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            <FiZap /> {Number(val || 0).toLocaleString()}
          </span>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            {Number(row.total_prompt_tokens || 0).toLocaleString()} in · {Number(row.total_completion_tokens || 0).toLocaleString()} out
          </div>
        </div>
      ),
    },
    {
      header: "Total Spend",
      key: "total_cost_usd",
      render: (val) => `$${Number(val || 0).toFixed(4)}`,
    },
    {
      header: "Active Limits / Quota",
      key: "quota_status",
      render: (_, row) => {
        if (row.is_blocked) {
          return (
            <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
              <FiSlash /> BLOCKED
            </span>
          );
        }
        if (row.daily_token_limit) {
          return (
            <span className={`${sharedStyles.badge} ${sharedStyles.badgeInfo}`}>
              Max {Number(row.daily_token_limit).toLocaleString()} / day
            </span>
          );
        }
        return <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Unlimited</span>;
      },
    },
    {
      header: "Security Hits",
      key: "security_count",
      render: (_, row) => {
        const triggers = Number(row.security_trigger_count || 0);
        const flags = Number(row.security_flag_count || 0);
        if (triggers + flags === 0) {
          return <span className={`${sharedStyles.badge} ${sharedStyles.badgeSuccess}`}>Clean</span>;
        }
        return (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
            {triggers} blocks · {flags} flags
          </span>
        );
      },
    },
    {
      header: "Actions",
      key: "actions",
      render: (_, row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            to={`/admin/users/${encodeURIComponent(row.end_user)}`}
            className={sharedStyles.pageBtn}
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <FiExternalLink /> Inspect
          </Link>
          <Link
            to="/admin/quotas"
            className={sharedStyles.pageBtn}
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <FiSliders /> Set Limit
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>
          User Directory &amp; Token Utilization Telemetry
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Monitor individual caller token consumption, cost accumulation, and configure boundary limits.
        </p>
      </div>

      <FilterBar
        onSubmit={() => loadUsers(1)}
        onReset={() => {
          setSearch("");
        }}
      >
        <input
          type="text"
          className={sharedStyles.filterInput}
          placeholder="Search by user pseudonym hash or display name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 320 }}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={users}
        loading={loading}
        emptyMessage="No users found."
        pagination={pagination}
        onPageChange={(page) => loadUsers(page)}
      />
    </div>
  );
}

