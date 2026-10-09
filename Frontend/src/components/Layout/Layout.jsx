import styles from "./Layout.module.css";

/**
 * Top-level page shell: header bar, left sidebar (controls), and the main
 * conversation column.
 */
export default function Layout({ header, sidebar, children }) {
  return (
    <div className={styles.shell}>
      <div className={styles.scene} aria-hidden="true">
        <span className={`${styles.orb} ${styles.orbA}`} />
        <span className={`${styles.orb} ${styles.orbB}`} />
        <span className={`${styles.orb} ${styles.orbC}`} />
        <span className={styles.floor} />
        <span className={styles.stars} />
      </div>

      <header className={styles.header}>{header}</header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>{sidebar}</aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
