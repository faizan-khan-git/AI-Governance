import { useHealth } from "../../hooks/useHealth.js";
import styles from "./HealthBadge.module.css";

export default function HealthBadge() {
  const { online, checking, refresh } = useHealth();

  const state = checking ? "checking" : online ? "online" : "offline";
  const label = checking
    ? "Checking…"
    : online
      ? "Backend online"
      : "Backend offline";

  return (
    <button
      type="button"
      className={styles.badge}
      data-state={state}
      onClick={refresh}
      title="Click to re-check backend health"
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
    </button>
  );
}
