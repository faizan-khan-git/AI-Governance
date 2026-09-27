import { useCallback, useEffect, useState } from "react";

import { getHealth } from "../api/health.js";

/**
 * Polls the Backend health endpoint on an interval and exposes connection state.
 * @param {number} [intervalMs]
 */
export function useHealth(intervalMs = 15000) {
  const [state, setState] = useState({
    online: false,
    checking: true,
    service: null,
  });

  const check = useCallback(async () => {
    setState((prev) => ({ ...prev, checking: true }));
    try {
      const data = await getHealth();
      setState({
        online: data?.status === "ok",
        checking: false,
        service: data?.service ?? null,
      });
    } catch {
      setState({ online: false, checking: false, service: null });
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
