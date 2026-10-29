import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchFlaggedPrompts } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import FilterBar from "../shared/FilterBar.jsx";
import StatCard from "../shared/StatCard.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiAlertOctagon, FiAlertTriangle, FiShield, FiUser } from "react-icons/fi";

export default function FlaggedPrompts() {
  const { auth } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [scannerStats, setScannerStats] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    type: "", // 'blocked' | 'flagged' | ''
    end_user: "",
    scanner: "",
  });

  const loadIncidents = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        const res = await fetchFlaggedPrompts(auth, {
          page,
          limit: pagination.limit,
          type: filters.type || undefined,
          end_user: filters.end_user || undefined,
          scanner: filters.scanner || undefined,
        });
        setIncidents(res.data || []);
        setScannerStats(res.scannerStats || []);
        setPagination(res.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("Failed to load flagged incidents:", err);
      } finally {
        setLoading(false);
      }
    },
    [auth, filters, pagination.limit],
  );

  useEffect(() => {
    loadIncidents(1);
  }, [loadIncidents]);

  const handleReset = () => {
    setFilters({ type: "", end_user: "", scanner: "" });
  };

  const columns = [
    {
      header: "Incident Time",
      key: "created_at",
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      header: "Searched / Triggered By",
      key: "end_user",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <FiUser style={{ color: "var(--accent)" }} />
            {row.user_display_name || "Anonymous User"}
          </div>
          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            Hash: {val}
          </div>
        </div>
      ),
    },
    {
      header: "Model Targeted",
      key: "model_requested",
      render: (val, row) => val || row.model_used || "—",
    },
    {
      header: "Intervention Status",
      key: "status",
      render: (_, row) =>
        row.guardrail_security_triggered ? (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
            <FiAlertOctagon /> BLOCKED (HTTP {row.status_code})
          </span>
        ) : (
          <span className={`${sharedStyles.badge} ${sharedStyles.badgeWarning}`}>
            <FiAlertTriangle /> FLAGGED (Advisory)
          </span>
        ),
    },
    {
      header: "Scanners Triggered",
      key: "scanners",
      render: (_, row) => {
        const scanners = [
          ...(row.guardrail_security_scanners || []),
          ...(row.guardrail_security_flagged_scanners || []),
        ];
        if (scanners.length === 0) return "—";
        return (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {scanners.map((s, i) => (
              <span
                key={i}
                className={`${sharedStyles.badge} ${
                  row.guardrail_security_triggered
                    ? sharedStyles.badgeDanger
                    : sharedStyles.badgePurple
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      header: "AI System Attributed",
      key: "system_name",
      render: (val) => val || <span style={{ color: "var(--text-muted)" }}>Default Gateway</span>,
    },
    {
      header: "Tokens Burned",
      key: "total_tokens",
      render: (val) => Number(val || 0).toLocaleString(),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>
          Security Guardrail Interventions &amp; Flagged Prompts
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Full visibility into prompts marked as flagged or blocked by ML security scanners (BanSubstrings, PromptInjection, Toxicity).
        </p>
      </div>

      {/* Scanner Frequency KPI Cards */}
      <div className={sharedStyles.statGrid}>
        <StatCard
          title="Total Incidents"
          value={pagination.total}
          subtitle="Security interventions & flags"
          icon={<FiAlertTriangle />}
          variant="danger"
        />
        {scannerStats.slice(0, 3).map((st) => (
          <StatCard
            key={st.scanner_name}
            title={`${st.scanner_name} Scanner`}
            value={st.count}
            subtitle="Adversarial detections"
            icon={<FiShield />}
          />
        ))}
      </div>

      {/* Filter Controls */}
      <FilterBar onSubmit={() => loadIncidents(1)} onReset={handleReset}>
        <input
          type="text"
          className={sharedStyles.filterInput}
          placeholder="Filter by caller hash or name..."
          value={filters.end_user}
          onChange={(e) => setFilters({ ...filters, end_user: e.target.value })}
        />

        <select
          className={sharedStyles.filterSelect}
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
        >
          <option value="">All Security Events</option>
          <option value="blocked">Blocked Requests Only</option>
          <option value="flagged">Monitor-Only Flagged Prompts</option>
        </select>

        <select
          className={sharedStyles.filterSelect}
          value={filters.scanner}
          onChange={(e) => setFilters({ ...filters, scanner: e.target.value })}
        >
          <option value="">All Scanner Models</option>
          <option value="PromptInjection">PromptInjection (DeBERTa)</option>
          <option value="Toxicity">Toxicity Filter</option>
          <option value="BanSubstrings">BanSubstrings (Jailbreaks/DAN)</option>
        </select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={incidents}
        loading={loading}
        emptyMessage="No security interventions recorded. All prompts have passed guardrail validations cleanly."
        pagination={pagination}
        onPageChange={(page) => loadIncidents(page)}
      />
    </div>
  );
}

