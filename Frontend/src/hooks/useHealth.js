import { useCallback, useEffect, useState } from "react";

import { getHealth } from "../api/health.js";

/**
 * Polls the Backend readiness endpoint on an interval and exposes connection state.
 *
 * `online` means the Backend itself answered; `gateway` is "up" or "down" as reported
 * by the Backend (or "unknown" while the Backend is unreachable).
 *
 * @param {number} [intervalMs]
 */
export function useHealth(intervalMs = 15000) {
  const [state, setState] = useState({
    online: false,
    gateway: "unknown",
    checking: true,
    service: null,
  });

  const check = useCallback(async () => {
    setState((prev) => ({ ...prev, checking: true }));
    try {
      const data = await getHealth();
      setState({
        online: true,
        gateway:
          data?.checks?.gateway ?? (data?.status === "ok" ? "up" : "down"),
        checking: false,
        service: data?.service ?? null,
      });
    } catch {
      setState({
        online: false,
        gateway: "unknown",
        checking: false,
        service: null,
      });
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);

  return { ...state, refresh: check };
}

export default useHealth;
