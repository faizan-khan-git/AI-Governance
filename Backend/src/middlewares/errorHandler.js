import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";

/**
 * Centralized error handler. Converts any thrown error into a consistent JSON
 * envelope and ensures internal details (stack traces, tokens) never leak.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
// eslint-disable-next-line no-unused-vars
export default function errorHandler(err, req, res, _next) {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;

  // Malformed JSON bodies surface as SyntaxError from body-parser.
  const isBodyParseError =
    err instanceof SyntaxError && "body" in err && err.status === 400;

  const finalStatus = isBodyParseError ? 400 : statusCode;

  if (finalStatus >= 500) {
    logger.error("Unhandled error", {
      method: req.method,
      path: req.originalUrl,
      message: err.message,
      stack: err.stack,
    });
  }

  const body = {
    success: false,
    error: {
      code: isBodyParseError
        ? "invalid_json"
        : isApiError
          ? err.code
          : "internal_error",
      message: isBodyParseError
        ? "Request body is not valid JSON."
        : isApiError
          ? err.message
          : "An unexpected error occurred.",
    },
  };

  if (isApiError && err.details !== undefined) {
    body.error.details = err.details;
  }

  res.status(finalStatus).json(body);
}
