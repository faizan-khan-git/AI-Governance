import { formatNumber } from "../../utils/format.js";
import styles from "./UsageStats.module.css";

/**
 * Aggregate token usage across the session (from gateway-reported usage).
 */
export default function UsageStats({ usage, replies }) {
  const rows = [
    { label: "Replies", value: replies },
    { label: "Prompt tokens", value: usage.prompt },
    { label: "Completion tokens", value: usage.completion },
    { label: "Total tokens", value: usage.total, highlight: true },
  ];

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>Session usage</h2>
      <dl className={styles.grid}>
        {rows.map((row) => (
          <div
            key={row.label}
            className={styles.cell}
            data-highlight={row.highlight ? "true" : "false"}
          >
            <dt className={styles.k}>{row.label}</dt>
            <dd className={styles.v}>{formatNumber(row.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
