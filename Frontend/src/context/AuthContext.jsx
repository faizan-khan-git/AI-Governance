import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "ai-gov.auth";
const DEFAULT_AUTH = { scheme: "jwt", token: "" };

const AuthContext = createContext(null);

function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTH };
    const parsed = JSON.parse(raw);
    return {
      scheme: parsed?.scheme === "apikey" ? "apikey" : "jwt",
      token: typeof parsed?.token === "string" ? parsed.token : "",
    };
  } catch {
    return { ...DEFAULT_AUTH };
  }
}

/**
 * Holds the caller's credential (a JWT or API key) and scheme. Persisted to
 * localStorage so a page reload keeps the session. The signing secret is NEVER
 * present in the frontend — only the already-issued token the user pastes.
 */
export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(loadAuth);

  const setAuth = useCallback((next) => {
    setAuthState((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        /* ignore storage failures (private mode, etc.) */
      }
      return merged;
    });
  }, []);

  const clearAuth = useCallback(() => {
    setAuthState({ ...DEFAULT_AUTH });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      auth,
      setAuth,
      clearAuth,
      isAuthenticated: Boolean(auth.token),
    }),
    [auth, setAuth, clearAuth],
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
