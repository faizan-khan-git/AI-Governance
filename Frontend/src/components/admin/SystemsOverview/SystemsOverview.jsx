import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchSystems, fetchRiskReviews } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import StatCard from "../shared/StatCard.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiCpu, FiAlertTriangle, FiCheckCircle, FiShield, FiFileText } from "react-icons/fi";

export default function SystemsOverview() {
  const { auth } = useAuth();
  const [systems, setSystems] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("systems"); // 'systems' | 'reviews'

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [sysRes, revRes] = await Promise.all([
        fetchSystems(auth),
        fetchRiskReviews(auth),
      ]);
      setSystems(sysRes || []);
      setReviews(revRes || []);
    } catch (err) {
      console.error("Failed to load systems data:", err);
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const highRiskCount = systems.filter((s) => s.risk_tier === "high" || s.risk_tier === "unacceptable").length;

  const systemColumns = [
    {
      header: "AI System Name",
      key: "system_name",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <FiCpu style={{ color: "var(--accent)" }} />
            {val}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
            Owner: {row.business_owner} {row.business_unit ? `(${row.business_unit})` : ""}
          </div>
        </div>
      ),
    },
    {
      header: "Risk Tier",
      key: "risk_tier",
      render: (tier) => {
        const isHigh = tier === "high" || tier === "unacceptable";
        const isLimited = tier === "limited";
        return (
          <span
            className={`${sharedStyles.badge} ${
              isHigh
                ? sharedStyles.badgeDanger
                : isLimited
                  ? sharedStyles.badgeWarning
                  : sharedStyles.badgeSuccess
            }`}
          >
            {isHigh && <FiAlertTriangle />} {tier?.toUpperCase()}
          </span>
        );
      },
    },
    {
      header: "Data Sensitivity",
      key: "data_sensitivity",
      render: (sens) => (
        <span
          className={`${sharedStyles.badge} ${
            sens === "restricted"
              ? sharedStyles.badgeDanger
              : sens === "confidential"
                ? sharedStyles.badgeWarning
                : sharedStyles.badgeDefault
          }`}
        >
          {sens?.toUpperCase()}
        </span>
      ),
    },
    {
      header: "Lifecycle Status",
      key: "status",
      render: (st) => (
        <span
          className={`${sharedStyles.badge} ${
            st === "active"
              ? sharedStyles.badgeSuccess
              : st === "suspended"
                ? sharedStyles.badgeDanger
                : sharedStyles.badgeWarning
          }`}
        >
          {st?.replace("_", " ").toUpperCase()}
        </span>
      ),
    },
    {
      header: "Token Consumption",
      key: "total_tokens",
      render: (val) => (
        <span style={{ color: "var(--cyan)", fontWeight: 600 }}>
          {Number(val || 0).toLocaleString()}
        </span>
      ),
    },
    {
      header: "Total Cost",
      key: "total_cost_usd",
      render: (val) => `$${Number(val || 0).toFixed(4)}`,
    },
    {
      header: "Guardrail Triggers",
      key: "triggers",
      render: (_, row) => (
        <div style={{ fontSize: "0.82rem" }}>
          <div>PII: <strong>{row.pii_trigger_count || 0}</strong></div>
          <div>Security: <strong>{(row.security_trigger_count || 0) + (row.security_flag_count || 0)}</strong></div>
        </div>
      ),
    },
  ];

  const reviewColumns = [
    {
      header: "Reviewed At",
      key: "reviewed_at",
      render: (val) => new Date(val).toLocaleDateString(),
    },
    {
      header: "System Evaluated",
      key: "system_name",
      render: (val) => <strong>{val}</strong>,
    },
    {
      header: "Lead Reviewer",
      key: "reviewer",
      render: (val) => val,
    },
    {
      header: "Risk Transition",
      key: "risk_transition",
      render: (_, row) => (
        <div>
          <span>{row.risk_tier_before}</span> → <strong style={{ color: "var(--accent)" }}>{row.risk_tier_after}</strong>
        </div>
      ),
    },
    {
      header: "Review Findings & Mandates",
      key: "findings",
      render: (val) => <div style={{ fontSize: "0.84rem", maxWidth: 350 }}>{val || "—"}</div>,
    },
    {
      header: "Next Review Due",
      key: "next_review_at",
      render: (val) => (val ? new Date(val).toLocaleDateString() : "—"),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>
          AI Systems Registry &amp; Risk Governance
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Centralized inventory of registered models, risk tier classifications, and ethics review audit trails.
        </p>
      </div>

      <div className={sharedStyles.statGrid}>
        <StatCard
          title="Total Registered Systems"
          value={systems.length}
          subtitle="Enterprise AI Assets"
          icon={<FiCpu />}
        />
        <StatCard
          title="High-Risk AI Systems"
          value={highRiskCount}
          subtitle="Subject to strict compliance"
          icon={<FiAlertTriangle />}
          variant={highRiskCount > 0 ? "danger" : "default"}
        />
        <StatCard
          title="Ethics & Risk Reviews"
          value={reviews.length}
          subtitle="Completed governance reviews"
          icon={<FiFileText />}
          variant="success"
        />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveTab("systems")}
          className={sharedStyles.pageBtn}
          style={{
            background: activeTab === "systems" ? "linear-gradient(135deg, var(--accent), var(--violet))" : undefined,
            color: activeTab === "systems" ? "#fff" : undefined,
            fontWeight: 600,
          }}
        >
          Registered AI Systems ({systems.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("reviews")}
          className={sharedStyles.pageBtn}
          style={{
            background: activeTab === "reviews" ? "linear-gradient(135deg, var(--accent), var(--violet))" : undefined,
            color: activeTab === "reviews" ? "#fff" : undefined,
            fontWeight: 600,
          }}
        >
          Governance Risk Reviews ({reviews.length})
        </button>
      </div>

      {activeTab === "systems" ? (
        <DataTable
          columns={systemColumns}
          data={systems}
          loading={loading}
          emptyMessage="No AI systems registered yet in the registry."
        />
      ) : (
        <DataTable
          columns={reviewColumns}
          data={reviews}
          loading={loading}
          emptyMessage="No risk reviews recorded."
        />
      )}
    </div>
  );
}

