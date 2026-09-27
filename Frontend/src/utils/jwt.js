/**
 * Decode (WITHOUT verifying) the payload of a JWT for display purposes only.
 * The Backend is the only party that verifies signatures — this is used solely
 * to show the caller which role their token carries.
 *
 * @param {string} token
 * @returns {object|null} decoded claims, or null if not a decodable JWT
 */
export function decodeJwtPayload(token) {
  try {
    const segment = String(token).split(".")[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default { decodeJwtPayload };
