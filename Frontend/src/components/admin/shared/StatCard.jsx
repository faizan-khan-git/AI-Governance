import styles from "./shared.module.css";

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  variant = "default", // default | danger | success | warning
}) {
  const variantClass =
    variant === "danger"
      ? styles.statCardDanger
      : variant === "success"
        ? styles.statCardSuccess
        : variant === "warning"
          ? styles.statCardWarning
          : "";

  return (
    <div className={`${styles.statCard} ${variantClass}`}>
      <div className={styles.statHeader}>
        <span className={styles.statTitle}>{title}</span>
        {icon && <span className={styles.statIcon}>{icon}</span>}
      </div>
      <div className={styles.statValue}>{value}</div>
      {subtitle && <div className={styles.statSubtitle}>{subtitle}</div>}
    </div>
  );
}

