import { useHealth } from "../../hooks/useHealth.js";
import styles from "./HealthBadge.module.css";

const LABELS = {
  checking: "Checking…",
  online: "Backend online",
  degraded: "Gateway offline",
  offline: "Backend offline",
};

const TITLES = {
  degraded:
    "The Backend is running but cannot reach the AI gateway. Click to re-check.",
};

/**
 * Connection badge: distinguishes "Backend unreachable" from "Backend up but the
 * AI gateway behind it is down", which need different fixes.
 */
export default function HealthBadge() {
  const { online, gateway, checking, refresh } = useHealth();

  let state = "online";
  if (checking) state = "checking";
  else if (!online) state = "offline";
  else if (gateway === "down") state = "degraded";

  return (
    <button
      type="button"
      className={styles.badge}
      data-state={state}
      onClick={refresh}
      title={TITLES[state] ?? "Click to re-check backend health"}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{LABELS[state]}</span>
    </button>
  );
}
