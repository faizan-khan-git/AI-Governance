import env from "../config/env.js";

/**
 * Model catalog shown in the UI, sourced from env. The gateway remains the
 * source of truth for which models a role may actually use.
 */
export const MODELS = env.models.length > 0 ? env.models : [env.defaultModel];

/** Supported authentication schemes against the Backend RBAC layer. */
export const AUTH_SCHEMES = Object.freeze([
  { id: "jwt", label: "JWT (Bearer)" },
  { id: "apikey", label: "API Key" },
]);

export default { MODELS, AUTH_SCHEMES };
