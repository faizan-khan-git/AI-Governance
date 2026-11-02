import { useEffect, useState } from "react";

/**
 * Track whether a CSS media query currently matches.
 *
 * Used only for changes CSS cannot express (e.g. different placeholder copy on
 * phones). Layout itself is handled by the stylesheets; keep those as the
 * source of truth for anything that can be done in CSS.
 *
 * @param {string} query a media query, e.g. "(max-width: 640px)"
 * @returns {boolean} whether the query matches right now
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export default useMediaQuery;
