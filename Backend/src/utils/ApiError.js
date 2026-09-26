/**
 * Typed application error that carries an HTTP status code and an optional
 * machine-readable code and details payload. Thrown by services/controllers
 * and translated into a JSON response by the central error handler.
 */
export default class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status code
   * @param {string} message human-readable error message
   * @param {object} [options]
   * @param {string} [options.code] machine-readable error code
   * @param {unknown} [options.details] safe, client-facing detail payload
   */
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code ?? "error";
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }
}
