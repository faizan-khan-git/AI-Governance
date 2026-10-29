import styles from "./shared.module.css";
import Pagination from "./Pagination.jsx";

export default function DataTable({
  columns = [],
  data = [],
  loading = false,
  emptyMessage = "No records found.",
  pagination,
  onPageChange,
  onRowClick,
}) {
  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key || col.header} style={{ width: col.width }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className={styles.emptyState}>
                  <div className={styles.emptyIcon}>⏳</div>
                  <div>Loading governance telemetry...</div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={styles.emptyState}>
                  <div className={styles.emptyIcon}>📂</div>
                  <div>{emptyMessage}</div>
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={row.id || row.key || idx}
                  onClick={() => onRowClick && onRowClick(row)}
                  style={{ cursor: onRowClick ? "pointer" : "default" }}
                >
                  {columns.map((col) => (
                    <td key={col.key || col.header}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

