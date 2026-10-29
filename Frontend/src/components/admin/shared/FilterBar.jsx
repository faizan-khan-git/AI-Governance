import styles from "./shared.module.css";

export default function FilterBar({ children, onReset, onSubmit }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSubmit) onSubmit();
  };

  return (
    <form className={styles.filterBar} onSubmit={handleSubmit}>
      {children}
      {onSubmit && (
        <button type="submit" className={styles.filterBtn}>
          Apply Filters
        </button>
      )}
      {onReset && (
        <button type="button" className={styles.resetBtn} onClick={onReset}>
          Reset
        </button>
      )}
    </form>
  );
}

