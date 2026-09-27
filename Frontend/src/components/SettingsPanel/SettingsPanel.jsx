import { MODELS } from "../../constants/models.js";
import styles from "./SettingsPanel.module.css";

/**
 * Generation controls: model, temperature, and an optional system prompt.
 * Values flow up to App and are sent with each chat request.
 */
export default function SettingsPanel({ settings, onChange }) {
  const update = (patch) => onChange((prev) => ({ ...prev, ...patch }));

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>Generation</h2>

      <label className={styles.label}>
        Model
        <select
          className={styles.select}
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.label}>
        <span className={styles.rowBetween}>
          <span>Temperature</span>
          <span className={styles.value}>
            {Number(settings.temperature).toFixed(2)}
          </span>
        </span>
        <input
          className={styles.range}
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={settings.temperature}
          onChange={(e) =>
            update({ temperature: Number.parseFloat(e.target.value) })
          }
        />
      </label>

      <label className={styles.label}>
        System prompt <span className={styles.optional}>(optional)</span>
        <textarea
          className={styles.textarea}
          rows={3}
          value={settings.system}
          onChange={(e) => update({ system: e.target.value })}
          placeholder="e.g. You are a concise, professional assistant."
        />
      </label>
    </section>
  );
}
