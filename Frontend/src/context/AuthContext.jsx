import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getSession, signOut as endSession, startSignIn } from "../api/auth.js";

const AuthContext = createContext(null);

/**
 * Holds the signed-in user for the whole app.
 *
 * Authentication is a session cookie issued by the Backend after Google
 * sign-in, so the browser holds no token the page script can read. Access is
 * invite-only: if the Backend says the visitor has no session, they see the
 * sign-in screen and nothing else.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading", // loading | signedOut | signedIn | error
    user: null,
    error: null,
  });

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((s) => ({ ...s, status: s.user ? s.status : "loading" }));
    try {
      const session = await getSession();
      setState({
        status: session.authenticated ? "signedIn" : "signedOut",
        user: session.user ?? null,
        error: null,
      });
    } catch (error) {
      setState({ status: "error", user: null, error: error.message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(() => startSignIn(), []);

  const signOut = useCallback(async () => {
    try {
      await endSession();
    } finally {
      setState({ status: "signedOut", user: null, error: null });
    }
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      user: state.user,
      role: state.user?.role ?? null,
      isAuthenticated: state.status === "signedIn",
      isAdmin: state.user?.role === "admin",
      signIn,
      signOut,
      refresh,
    }),
    [state, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>.");
  }
  return ctx;
}

export default AuthContext;
