import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchPiiIncidents } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import FilterBar from "../shared/FilterBar.jsx";
import StatCard from "../shared/StatCard.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiShield, FiLock, FiUser } from "react-icons/fi";

export default function PIIIncidents() {
  const { auth } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [entityStats, setEntityStats] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [endUserFilter, setEndUserFilter] = useState("");

  const loadIncidents = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        const res = await fetchPiiIncidents(auth, {
          page,
          limit: pagination.limit,
          end_user: endUserFilter || undefined,
        });
        setIncidents(res.data || []);
        setEntityStats(res.entityStats || []);
        setPagination(res.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("Failed to load PII incidents:", err);
      } finally {
        setLoading(false);
      }
    },
    [auth, endUserFilter, pagination.limit],
  );

  useEffect(() => {
    loadIncidents(1);
  }, [loadIncidents]);

  const columns = [
    {
      header: "Timestamp",
      key: "created_at",
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      header: "Caller / User",
      key: "end_user",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <FiUser style={{ color: "var(--accent)" }} />
            {row.user_display_name || "Anonymous User"}
          </div>
          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
            Hash: {val}
          </div>
        </div>
      ),
    },
    {
      header: "Model Targeted",
      key: "model_requested",
      render: (val) => val || "—",
    },
    {
      header: "Masked Entity Types (Protected in Vault)",
      key: "guardrail_pii_entities",
      render: (entities) => {
        if (!entities || (Array.isArray(entities) && entities.length === 0)) {
          return <span className={`${sharedStyles.badge} ${sharedStyles.badgeInfo}`}>PII Detected</span>;
        }

        const items = Array.isArray(entities) ? entities : Object.keys(entities);
        return (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {items.map((item, idx) => {
              const name = typeof item === "string" ? item : item.entity_type || item.type || "ENTITY";
              return (
                <span key={idx} className={`${sharedStyles.badge} ${sharedStyles.badgeInfo}`}>
                  <FiLock /> {name}
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      header: "AI System Attributed",
      key: "system_name",
      render: (val) => val || <span style={{ color: "var(--text-muted)" }}>Default Gateway</span>,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>
          Privacy Compliance &amp; PII Vault Incidents
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Presidio + Redis vault telemetry: Personally Identifiable Information masked before reaching the model and rehydrated in transit.
        </p>
      </div>

      {/* Entity Breakdown Stats */}
      <div className={sharedStyles.statGrid}>
        <StatCard
          title="Total PII Incidents"
          value={pagination.total}
          subtitle="Requests requiring data masking"
          icon={<FiShield />}
          variant="warning"
        />
        {entityStats.slice(0, 3).map((st) => (
          <StatCard
            key={st.entity_type}
            title={`${st.entity_type}`}
            value={st.count}
            subtitle="Masked instances"
            icon={<FiLock />}
          />
        ))}
      </div>

      <FilterBar
        onSubmit={() => loadIncidents(1)}
        onReset={() => {
          setEndUserFilter("");
        }}
      >
        <input
          type="text"
          className={sharedStyles.filterInput}
          placeholder="Filter by user hash or name..."
          value={endUserFilter}
          onChange={(e) => setEndUserFilter(e.target.value)}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={incidents}
        loading={loading}
        emptyMessage="No PII maskings recorded yet."
        pagination={pagination}
        onPageChange={(page) => loadIncidents(page)}
      />
    </div>
  );
}

