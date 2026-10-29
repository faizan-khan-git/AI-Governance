import { useState, useEffect } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchDashboard, fetchTrends } from "../../../api/admin.js";
import StatCard from "../shared/StatCard.jsx";
import DataTable from "../shared/DataTable.jsx";
import sharedStyles from "../shared/shared.module.css";
import styles from "./DashboardOverview.module.css";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  FiActivity,
  FiUsers,
  FiZap,
  FiDollarSign,
  FiAlertTriangle,
  FiShield,
  FiCpu,
} from "react-icons/fi";

export default function DashboardOverview() {
  const { auth } = useAuth();
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [dashRes, trendsRes] = await Promise.all([
          fetchDashboard(auth),
          fetchTrends(auth, 30),
        ]);
        if (mounted) {
          setData(dashRes);
          setTrends(trendsRes);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err.message || "Failed to load dashboard data");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [auth]);

  const kpis = data?.kpis || {};
  const topUsers = data?.topUsers || [];

  const userColumns = [
    {
      header: "User Identifier",
      key: "end_user",
      render: (val, row) => (
        <div>
          <span style={{ fontWeight: 600 }}>{row.display_name || val}</span>
          {row.display_name && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
              {val}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Requests",
      key: "requests",
      render: (val) => Number(val).toLocaleString(),
    },
    {
      header: "Tokens Consumed",
      key: "total_tokens",
      render: (val) => (
        <span style={{ color: "var(--cyan)", fontWeight: 600 }}>
          {Number(val).toLocaleString()}
        </span>
      ),
    },
    {
      header: "Spend (USD)",
      key: "cost_usd",
      render: (val) => `$${Number(val).toFixed(4)}`,
    },
    {
      header: "Security Alerts",
      key: "security_flags",
      render: (val) =>
        Number(val) > 0 ? (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
            {val} flags
          </span>
        ) : (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeSuccess}`}>
            Clean
          </span>
        ),
    },
  ];

  if (error) {
    return (
      <div className={sharedStyles.emptyState}>
        <div className={sharedStyles.emptyIcon}>⚠️</div>
        <h3>Unable to load dashboard</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* KPI Cards Grid */}
      <div className={sharedStyles.statGrid}>
        <StatCard
          title="Total Requests"
          value={loading ? "..." : Number(kpis.total_requests || 0).toLocaleString()}
          subtitle={`${Number(kpis.requests_last_24h || 0).toLocaleString()} in last 24h`}
          icon={<FiActivity />}
        />
        <StatCard
          title="Active Users"
          value={loading ? "..." : Number(kpis.active_users || 0).toLocaleString()}
          subtitle="Unique pseudonymous callers"
          icon={<FiUsers />}
        />
        <StatCard
          title="Total Token Usage"
          value={loading ? "..." : Number(kpis.total_tokens || 0).toLocaleString()}
          subtitle={`${Number(kpis.tokens_last_24h || 0).toLocaleString()} in last 24h`}
          icon={<FiZap />}
          variant="success"
        />
        <StatCard
          title="Cumulative Cost"
          value={loading ? "..." : `$${Number(kpis.total_cost_usd || 0).toFixed(2)}`}
          subtitle={`$${Number(kpis.cost_last_24h || 0).toFixed(2)} in last 24h`}
          icon={<FiDollarSign />}
        />
        <StatCard
          title="Security Incidents"
          value={
            loading
              ? "..."
              : Number(kpis.security_blocks || 0) + Number(kpis.security_flags || 0)
          }
          subtitle={`${kpis.security_blocks || 0} blocked · ${kpis.security_flags || 0} flagged`}
          icon={<FiAlertTriangle />}
          variant={Number(kpis.security_blocks || 0) > 0 ? "danger" : "default"}
        />
        <StatCard
          title="PII Masked Events"
          value={loading ? "..." : Number(kpis.pii_triggers || 0).toLocaleString()}
          subtitle="Protected via Presidio vault"
          icon={<FiShield />}
          variant="warning"
        />
        <StatCard
          title="Registered AI Systems"
          value={loading ? "..." : Number(kpis.total_systems || 0)}
          subtitle={`${kpis.high_risk_systems || 0} high-risk systems`}
          icon={<FiCpu />}
        />
      </div>

      {/* Visual Analytics Charts */}
      <div className={styles.chartGrid}>
        {/* Token Activity Trend */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>Token Utilization Trends (30 Days)</h3>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            {trends.length === 0 ? (
              <div className={sharedStyles.emptyState} style={{ padding: 40 }}>
                No recent activity logged.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--cyan)" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis
                    dataKey="day"
                    stroke="var(--text-muted)"
                    fontSize={12}
                    tickFormatter={(val) => val.slice(5)}
                  />
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
                    dataKey="total_tokens"
                    stroke="var(--cyan)"
                    fillOpacity={1}
                    fill="url(#tokenGradient)"
                    name="Total Tokens"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Requests Activity */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>Daily Request Volume</h3>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            {trends.length === 0 ? (
              <div className={sharedStyles.emptyState} style={{ padding: 40 }}>
                No request volume data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis
                    dataKey="day"
                    stroke="var(--text-muted)"
                    fontSize={12}
                    tickFormatter={(val) => val.slice(5)}
                  />
                  <YAxis stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(10, 12, 26, 0.95)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--text)",
                    }}
                  />
                  <Bar dataKey="total_requests" fill="var(--accent)" radius={[4, 4, 0, 0]} name="Requests" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Top Consumers Table */}
      <div>
        <h3 className={styles.sectionTitle}>
          <FiUsers /> Top Token Consumers &amp; Callers
        </h3>
        <DataTable
          columns={userColumns}
          data={topUsers}
          loading={loading}
          emptyMessage="No user utilization recorded yet."
        />
      </div>
    </div>
  );
}

