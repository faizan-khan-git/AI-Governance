import ApiError from "../utils/ApiError.js";
import logger from "../utils/logger.js";

/**
 * Client errors raised by body-parser / raw-body, keyed by their `type`.
 * Without this table an oversized body would surface as a generic 500.
 */
const BODY_PARSER_ERRORS = Object.freeze({
  "entity.too.large": {
    status: 413,
    code: "payload_too_large",
    message: "Request body is too large.",
  },
  "entity.parse.failed": {
    status: 400,
    code: "invalid_json",
    message: "Request body is not valid JSON.",
  },
  "encoding.unsupported": {
    status: 415,
    code: "unsupported_media_type",
    message: "Unsupported request encoding.",
  },
  "charset.unsupported": {
    status: 415,
    code: "unsupported_media_type",
    message: "Unsupported request charset.",
  },
  "request.aborted": {
    status: 400,
    code: "request_aborted",
    message: "The request was aborted before it completed.",
  },
  "request.size.invalid": {
    status: 400,
    code: "invalid_request",
    message: "The request body size did not match its Content-Length.",
  },
});

/**
 * Translate any thrown value into a safe, client-facing error description.
 * Unknown errors collapse to a generic 500 so internals never leak.
 *
 * @param {unknown} err
 * @returns {{ status: number, code: string, message: string, details?: unknown }}
 */
export function toErrorResponse(err) {
  if (err instanceof ApiError) {
    return {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  const known = BODY_PARSER_ERRORS[err?.type];
  if (known) {
    return { ...known };
  }

  // Malformed JSON bodies can also surface as a bare SyntaxError from body-parser.
  if (err instanceof SyntaxError && "body" in err && err.status === 400) {
    return { ...BODY_PARSER_ERRORS["entity.parse.failed"] };
  }

  return {
    status: 500,
    code: "internal_error",
    message: "An unexpected error occurred.",
  };
}

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
  const { status, code, message, details } = toErrorResponse(err);

  if (status >= 500) {
    logger.error("Unhandled error", {
      method: req.method,
      path: req.originalUrl,
      message: err?.message,
      stack: err?.stack,
    });
  }

  const body = { success: false, error: { code, message } };
  if (details !== undefined) {
    body.error.details = details;
  }

  res.status(status).json(body);
}
