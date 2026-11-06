import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiChevronUp, FiTrash2 } from "react-icons/fi";

import { request } from "../../../api/client.js";
import shared from "../shared/shared.module.css";
import styles from "./Conversations.module.css";

/**
 * Prompt and reply transcripts.
 *
 * Governance is only meaningful if an administrator can see what was actually
 * asked and answered. Reads are recorded server-side, so viewing a transcript is
 * itself auditable.
 */
export default function Conversations() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [openId, setOpenId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search.trim()) params.set("endUser", search.trim());
      const res = await request(`/api/admin/conversations?${params.toString()}`, { method: "GET" });
      setRows(res?.data ?? []);
      setPagination(res?.pagination ?? { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      setError(err.message ?? "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) => setOpenId((current) => (current === id ? null : id));

  const flash = (message, kind = "ok") => {
    setNotice({ message, kind });
    setTimeout(() => setNotice(null), 4000);
  };

  /**
   * Delete one conversation. Only the prompt/reply text is destroyed; the audit
   * log keeps its metadata row, so governance reporting is unaffected.
   */
  const deleteOne = async (row) => {
    const who = row.user_display_name || row.end_user || "this caller";
    if (
      !window.confirm(
        `Delete this conversation from ${who}?\n\nOnly the prompt and reply text is removed. ` +
          "The audit record (model, tokens, cost, guardrail outcome) is kept.",
      )
    ) {
      return;
    }
    setDeleting(row.id);
    setError(null);
    try {
      await request(`/api/admin/conversations/${row.id}`, { method: "DELETE" });
      if (openId === row.id) setOpenId(null);
      await load();
      flash("Conversation deleted.");
    } catch (err) {
      setError(err.message ?? "Could not delete the conversation.");
    } finally {
      setDeleting(null);
    }
  };

  /** Delete every stored conversation, or just one caller's when filtered. */
  const deleteAll = async () => {
    const scope = search.trim();
    const what = scope ? `all stored conversations for ${scope}` : "ALL stored conversations";
    if (
      !window.confirm(
        `Delete ${what}?\n\nThis cannot be undone. Audit records are kept; only prompt and reply text is removed.`,
      )
    ) {
      return;
    }
    setDeleting("all");
    setError(null);
    try {
      const query = scope ? `?endUser=${encodeURIComponent(scope)}` : "";
      const res = await request(`/api/admin/conversations${query}`, { method: "DELETE" });
      await load();
      flash(`Deleted ${res?.data?.deleted ?? 0} conversation(s).`);
    } catch (err) {
      setError(err.message ?? "Could not delete the conversations.");
    } finally {
      setDeleting(null);
    }
  };

  const label = useMemo(
    () => (total) => `${total} stored conversation${total === 1 ? "" : "s"}`,
    [],
  );

  return (
    <div>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title}>Conversations</h2>
          <p className={styles.subtitle}>
            Prompts and replies. Stored for governance review and deleted automatically
            after the retention window. Opening or deleting one is recorded in the action
            log; the audit record of each request is always kept.
          </p>
        </div>
        {pagination.total > 0 && (
          <button
            type="button"
            className={styles.deleteAll}
            onClick={deleteAll}
            disabled={deleting === "all"}
          >
            <FiTrash2 aria-hidden="true" />
            {search.trim() ? "Delete this caller's history" : "Delete all"}
          </button>
        )}
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
          placeholder="Filter by user id (u_…)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </form>

      <p className={styles.count}>{label(pagination.total)}</p>

      {loading ? (
        <p className={styles.empty}>Loading conversations…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No conversations stored yet.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const open = openId === row.id;
            return (
              <li key={row.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.summary}
                  onClick={() => toggle(row.id)}
                  aria-expanded={open}
                >
                  <span className={styles.meta}>
                    <span className={styles.user}>
                      {row.user_display_name || row.end_user || "unknown"}
                    </span>
                    <span className={styles.when}>
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                  </span>
                  <span className={styles.promptPreview}>{row.prompt_text}</span>
                  <span className={styles.summaryRight}>
                    <span className={styles.model}>{row.model ?? "—"}</span>
                    <span
                      className={`${styles.status} ${
                        row.status_code >= 400 ? styles.statusBad : styles.statusOk
                      }`}
                    >
                      {row.status_code}
                    </span>
                    {open ? <FiChevronUp /> : <FiChevronDown />}
                  </span>
                </button>

                {open && (
                  <div className={styles.detail}>
                    <div className={styles.block}>
                      <h4>Prompt</h4>
                      <pre className={styles.text}>{row.prompt_text || "—"}</pre>
                    </div>
                    <div className={styles.block}>
                      <h4>Reply</h4>
                      <pre className={styles.text}>
                        {row.response_text || (row.error_code ? `Blocked (${row.error_code})` : "—")}
                      </pre>
                    </div>
                    <div className={styles.detailActions}>
                      <button
                        type="button"
                        className={styles.deleteOne}
                        onClick={() => deleteOne(row)}
                        disabled={deleting === row.id}
                      >
                        <FiTrash2 aria-hidden="true" />
                        {deleting === row.id ? "Deleting…" : "Delete conversation"}
                      </button>
                    </div>
                    <dl className={styles.stats}>
                      <div>
                        <dt>Tokens in / out</dt>
                        <dd>
                          {row.prompt_tokens ?? "—"} / {row.completion_tokens ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Latency</dt>
                        <dd>{row.latency_ms ? `${row.latency_ms} ms` : "—"}</dd>
                      </div>
                      <div>
                        <dt>Request</dt>
                        <dd className={styles.ellipsis}>{row.request_id ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pagination.totalPages > 1 && (
        <div className={styles.pager}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
