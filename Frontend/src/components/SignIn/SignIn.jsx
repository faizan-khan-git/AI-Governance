import { useEffect, useMemo, useState } from "react";
import { FiLogIn } from "react-icons/fi";

import { useAuth } from "../../context/AuthContext.jsx";
import { getAuthConfig } from "../../api/auth.js";
import styles from "./SignIn.module.css";

/** Human-readable explanation for each denial reason the Backend can return. */
const DENIAL_MESSAGES = {
  not_invited: "Access not granted. An administrator has to add your account first.",
  identity_mismatch: "This invitation is already linked to a different Google account.",
  account_suspended: "Your access has been suspended. Please contact an administrator.",
  account_removed: "Your access has been removed. Please contact an administrator.",
  state_mismatch: "The sign-in attempt could not be verified. Please try again.",
  state_missing: "The sign-in attempt expired. Please try again.",
  code_missing: "Google did not return an authorization code. Please try again.",
  verification_failed: "We could not verify your Google account. Please try again.",
  google_not_configured: "Company sign-in is not configured on this deployment.",
  access_denied: "Sign-in was cancelled.",
};

/**
 * Sign-in screen. The only way into the console: a company Google account that
 * an administrator has already granted access to.
 */
export default function SignIn() {
  const { signIn, status } = useAuth();
  const [authConfig, setAuthConfig] = useState({ google: false, loading: true });
  const [query] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((data) => {
        if (!cancelled) setAuthConfig({ ...data, loading: false });
      })
      .catch(() => {
        if (!cancelled) setAuthConfig({ google: false, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const denial = useMemo(() => {
    if (query.get("auth") !== "denied") return null;
    const reason = query.get("reason") ?? "";
    return DENIAL_MESSAGES[reason] ?? "Sign-in was refused. Please contact an administrator.";
  }, [query]);

  const failed = useMemo(
    () => (query.get("auth") === "error" ? "Sign-in failed unexpectedly. Please try again." : null),
    [query],
  );

  return (
    <div className={styles.page}>
      <div className={styles.scene} aria-hidden="true" />

      <main className={styles.card}>
        <div className={styles.logo} aria-hidden="true">
          🛡️
        </div>
        <h1 className={styles.title}>AI Governance Console</h1>
        <p className={styles.subtitle}>
          Sign in with your company Google account. Access is granted by an
          administrator.
        </p>

        {denial && (
          <p className={styles.denied} role="alert">
            {denial}
          </p>
        )}
        {failed && (
          <p className={styles.denied} role="alert">
            {failed}
          </p>
        )}

        <button
          type="button"
          className={styles.primary}
          onClick={signIn}
          disabled={authConfig.loading || !authConfig.google || status === "loading"}
        >
          {authConfig.loading || status === "loading" ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            <FiLogIn aria-hidden="true" />
          )}
          {authConfig.loading ? "Checking sign-in…" : "Sign in with Google"}
        </button>

        {!authConfig.loading && !authConfig.google && (
          <p className={styles.notice}>
            Company sign-in is not configured on this deployment. An administrator
            must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
          </p>
        )}

        <p className={styles.notice}>
          Prompts and replies are logged for governance and can be reviewed by
          administrators.
        </p>
      </main>
    </div>
  );
}
