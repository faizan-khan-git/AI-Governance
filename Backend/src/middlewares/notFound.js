import ApiError from "../utils/ApiError.js";

/**
 * Catch-all for unmatched routes. Forwards a 404 ApiError to the error handler.
 */
export default function notFound(req, _res, next) {
  next(
    new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, {
      code: "not_found",
    }),
  );
}
