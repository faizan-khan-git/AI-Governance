import styles from "./shared.module.css";

export default function Pagination({ page = 1, totalPages = 1, total = 0, onPageChange }) {
  if (totalPages <= 1 && total === 0) return null;

  return (
    <div className={styles.pagination}>
      <span>
        Page <strong>{page}</strong> of <strong>{Math.max(1, totalPages)}</strong> ({total} total items)
      </span>
      <div className={styles.pageControls}>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

