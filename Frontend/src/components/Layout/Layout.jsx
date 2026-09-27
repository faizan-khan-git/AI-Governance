import styles from "./Layout.module.css";

/**
 * Top-level page shell: header bar, left sidebar (controls), and the main
 * conversation column.
 */
export default function Layout({ header, sidebar, children }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>{header}</header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>{sidebar}</aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
