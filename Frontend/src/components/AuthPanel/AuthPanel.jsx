import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../../context/AuthContext.jsx";
import { AUTH_SCHEMES } from "../../constants/models.js";
import { decodeJwtPayload } from "../../utils/jwt.js";
import styles from "./AuthPanel.module.css";

/**
 * Lets the caller supply their RBAC credential — either a signed JWT (role
 * claim) or an API key mapped to a role on the Backend. The token is stored
 * locally and attached to every chat request.
 */
export default function AuthPanel() {
  const { auth, setAuth, clearAuth, isAuthenticated } = useAuth();
  const [scheme, setScheme] = useState(auth.scheme);
  const [token, setToken] = useState(auth.token);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    setScheme(auth.scheme);
    setToken(auth.token);
  }, [auth.scheme, auth.token]);

  const detectedRole = useMemo(() => {
    if (scheme !== "jwt" || !token) return null;
    const payload = decodeJwtPayload(token);
    return payload?.role ?? null;
  }, [scheme, token]);

  const dirty = scheme !== auth.scheme || token !== auth.token;

  const handleSave = (e) => {
    e.preventDefault();
    setAuth({ scheme, token: token.trim() });
  };

  const handleClear = () => {
    setToken("");
    clearAuth();
  };

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Authentication</h2>
        <span
          className={styles.status}
          data-on={isAuthenticated ? "true" : "false"}
        >
          {isAuthenticated ? "Credential set" : "No credential"}
        </span>
      </div>

      <form onSubmit={handleSave} className={styles.form}>
        <label className={styles.label}>
          Scheme
          <select
            className={styles.select}
            value={scheme}
            onChange={(e) => setScheme(e.target.value)}
          >
            {AUTH_SCHEMES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.label}>
          {scheme === "jwt" ? "JWT (Bearer token)" : "API key"}
          <div className={styles.tokenRow}>
            <input
              className={styles.input}
              type={reveal ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                scheme === "jwt" ? "eyJhbGciOiJIUzI1Ni…" : "dev-abc123"
              }
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setReveal((v) => !v)}
              title={reveal ? "Hide" : "Show"}
            >
              {reveal ? "🙈" : "👁️"}
            </button>
          </div>
        </label>

        {detectedRole && (
          <div className={styles.roleRow}>
            Detected role: <span className={styles.role}>{detectedRole}</span>
          </div>
        )}

        <div className={styles.buttons}>
          <button
            type="submit"
            className={styles.save}
            disabled={!dirty || !token.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={handleClear}
            disabled={!isAuthenticated && !token}
          >
            Clear
          </button>
        </div>
      </form>

      <p className={styles.hint}>
        Mint a JWT on the Backend:
        <code className={styles.code}>
          node scripts/issue-jwt.mjs --role dev
        </code>
      </p>
    </section>
  );
}
