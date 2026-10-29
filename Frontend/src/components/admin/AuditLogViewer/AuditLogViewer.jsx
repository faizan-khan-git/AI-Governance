import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext.jsx";
import { fetchAuditLogs } from "../../../api/admin.js";
import DataTable from "../shared/DataTable.jsx";
import FilterBar from "../shared/FilterBar.jsx";
import sharedStyles from "../shared/shared.module.css";
import { FiX, FiCheck, FiAlertTriangle, FiShield } from "react-icons/fi";

export default function AuditLogViewer() {
  const { auth } = useAuth();
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);

  const [filters, setFilters] = useState({
    search: "",
    model: "",
    status_code: "",
    flagged_only: false,
    pii_only: false,
  });

  const loadLogs = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        const res = await fetchAuditLogs(auth, {
          page,
          limit: pagination.limit,
          search: filters.search,
          model: filters.model,
          status_code: filters.status_code,
          flagged_only: filters.flagged_only ? "true" : undefined,
          pii_only: filters.pii_only ? "true" : undefined,
        });
        setLogs(res.data || []);
        setPagination(res.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("Failed to load audit logs:", err);
      } finally {
        setLoading(false);
      }
    },
    [auth, filters, pagination.limit],
  );

  useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  const handlePageChange = (newPage) => {
    loadLogs(newPage);
  };

  const handleReset = () => {
    setFilters({
      search: "",
      model: "",
      status_code: "",
      flagged_only: false,
      pii_only: false,
    });
  };

  const columns = [
    {
      header: "Timestamp",
      key: "created_at",
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      header: "Caller / End User",
      key: "end_user",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.user_display_name || "Anonymous"}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
            {val || "—"}
          </div>
        </div>
      ),
    },
    {
      header: "Model",
      key: "model_used",
      render: (val, row) => (
        <div>
          <span>{val || row.model_requested || "—"}</span>
          {row.system_name && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{row.system_name}</div>
          )}
        </div>
      ),
    },
    {
      header: "Tokens (In / Out / Total)",
      key: "total_tokens",
      render: (val, row) => (
        <div>
          <span style={{ color: "var(--cyan)", fontWeight: 600 }}>
            {Number(val || 0).toLocaleString()}
          </span>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            {Number(row.prompt_tokens || 0).toLocaleString()} ↑ · {Number(row.completion_tokens || 0).toLocaleString()} ↓
          </div>
        </div>
      ),
    },
    {
      header: "Cost",
      key: "response_cost_usd",
      render: (val) => `$${Number(val || 0).toFixed(5)}`,
    },
    {
      header: "Latency",
      key: "latency_ms",
      render: (val) => `${val || 0} ms`,
    },
    {
      header: "Status",
      key: "status_code",
      render: (val) => {
        const code = Number(val || 200);
        const isOk = code >= 200 && code < 300;
        const isWarn = code >= 400 && code < 500;
        return (
          <span
            className={`${sharedStyles.badge} ${
              isOk
                ? sharedStyles.badgeSuccess
                : isWarn
                  ? sharedStyles.badgeWarning
                  : sharedStyles.badgeDanger
            }`}
          >
            {isOk ? <FiCheck /> : <FiAlertTriangle />} {code}
          </span>
        );
      },
    },
    {
      header: "Guardrails",
      key: "guardrails",
      render: (_, row) => {
        const badges = [];
        if (row.guardrail_security_triggered) {
          badges.push(
            <span key="sec-block" className={`${sharedStyles.badge} ${sharedStyles.badgeDanger}`}>
              BLOCKED
            </span>,
          );
        } else if (row.guardrail_security_flagged) {
          badges.push(
            <span key="sec-flag" className={`${sharedStyles.badge} ${sharedStyles.badgeWarning}`}>
              FLAGGED
            </span>,
          );
        }

        if (row.guardrail_pii_triggered) {
          badges.push(
            <span key="pii" className={`${sharedStyles.badge} ${sharedStyles.badgeInfo}`}>
              PII MASKED
            </span>,
          );
        }

        if (badges.length === 0) {
          return <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>None</span>;
        }

        return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{badges}</div>;
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem", fontWeight: 700 }}>Audit Log Explorer</h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Zero-retention governance audit trail recording model consumption, latency, costs, and security guardrail outcomes.
        </p>
      </div>

      {/* Filter Controls */}
      <FilterBar onSubmit={() => loadLogs(1)} onReset={handleReset}>
        <input
          type="text"
          className={sharedStyles.filterInput}
          placeholder="Search user, request ID, model..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <select
          className={sharedStyles.filterSelect}
          value={filters.model}
          onChange={(e) => setFilters({ ...filters, model: e.target.value })}
        >
          <option value="">All Models</option>
          <option value="gemini-flash">Gemini Flash</option>
          <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          <option value="gemini-pro">Gemini Pro</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
          <option value="gpt-4o">GPT-4o</option>
        </select>

        <select
          className={sharedStyles.filterSelect}
          value={filters.status_code}
          onChange={(e) => setFilters({ ...filters, status_code: e.target.value })}
        >
          <option value="">All Statuses</option>
          <option value="200">200 OK</option>
          <option value="400">400 Bad Request / Blocked</option>
          <option value="401">401 Unauthorized</option>
          <option value="403">403 Forbidden</option>
          <option value="429">429 Rate / Quota Limited</option>
          <option value="500">500 Server Error</option>
        </select>

        <label className={sharedStyles.filterCheckbox}>
          <input
            type="checkbox"
            checked={filters.flagged_only}
            onChange={(e) => setFilters({ ...filters, flagged_only: e.target.checked })}
          />
          <span>Security Interventions Only</span>
        </label>

        <label className={sharedStyles.filterCheckbox}>
          <input
            type="checkbox"
            checked={filters.pii_only}
            onChange={(e) => setFilters({ ...filters, pii_only: e.target.checked })}
          />
          <span>PII Masked Only</span>
        </label>
      </FilterBar>

      {/* Table */}
      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        emptyMessage="No audit log entries match your filter criteria."
        pagination={pagination}
        onPageChange={handlePageChange}
        onRowClick={(row) => setSelectedLog(row)}
      />

      {/* Modal Inspector */}
      {selectedLog && (
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
          onClick={() => setSelectedLog(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              backdropFilter: "var(--glass-blur)",
              borderRadius: "var(--radius-sm)",
              width: "100%",
              maxWidth: 620,
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
              boxShadow: "var(--depth-2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem" }}>Audit Log Telemetry Record</h3>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer" }}
              >
                <FiX />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: "0.88rem" }}>
              <div>
                <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>REQUEST ID</strong>
                <code>{selectedLog.request_id || "N/A"}</code>
              </div>
              <div>
                <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>CALLER END-USER HASH</strong>
                <code>{selectedLog.end_user || "anonymous"}</code>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>MODEL REQUESTED</strong>
                  <span>{selectedLog.model_requested}</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>MODEL USED</strong>
                  <span>{selectedLog.model_used}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>PROMPT TOKENS</strong>
                  <span>{selectedLog.prompt_tokens}</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>COMPLETION TOKENS</strong>
                  <span>{selectedLog.completion_tokens}</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>TOTAL TOKENS</strong>
                  <span style={{ color: "var(--cyan)", fontWeight: 600 }}>{selectedLog.total_tokens}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>RESPONSE LATENCY</strong>
                  <span>{selectedLog.latency_ms} ms</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-muted)", display: "block", fontSize: "0.78rem" }}>UPSTREAM SPEND</strong>
                  <span>${Number(selectedLog.response_cost_usd || 0).toFixed(6)}</span>
                </div>
              </div>

              {/* Guardrails Detail */}
              <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: 8, marginTop: 6 }}>
                <strong style={{ color: "var(--accent)", display: "block", fontSize: "0.85rem", marginBottom: 6 }}>
                  Guardrail Invariants &amp; Analysis
                </strong>
                <div>PII Triggered: <strong>{selectedLog.guardrail_pii_triggered ? "YES" : "NO"}</strong></div>
                {selectedLog.guardrail_pii_entities && (
                  <pre style={{ fontSize: "0.75rem", background: "rgba(0,0,0,0.4)", padding: 8, borderRadius: 4, marginTop: 4 }}>
                    {JSON.stringify(selectedLog.guardrail_pii_entities, null, 2)}
                  </pre>
                )}
                <div style={{ marginTop: 8 }}>
                  Security Blocked: <strong>{selectedLog.guardrail_security_triggered ? "YES" : "NO"}</strong>
                  {selectedLog.guardrail_security_scanners?.length > 0 && (
                    <span> ({selectedLog.guardrail_security_scanners.join(", ")})</span>
                  )}
                </div>
                <div>
                  Security Flagged (Monitor-only): <strong>{selectedLog.guardrail_security_flagged ? "YES" : "NO"}</strong>
                  {selectedLog.guardrail_security_flagged_scanners?.length > 0 && (
                    <span> ({selectedLog.guardrail_security_flagged_scanners.join(", ")})</span>
                  )}
                </div>
              </div>

              {selectedLog.error_message && (
                <div style={{ color: "var(--danger)", background: "var(--danger-soft)", padding: 10, borderRadius: 6 }}>
                  <strong>Error Message:</strong> {selectedLog.error_message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

