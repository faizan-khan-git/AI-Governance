import ApiError from "../utils/ApiError.js";

/**
 * Middleware ensuring the authenticated user has the 'admin' role.
 * Must be mounted after the `authenticate` middleware.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export default function requireAdmin(req, _res, next) {
  if (!req.auth) {
    return next(
      new ApiError(401, "Authentication required.", {
        code: "unauthenticated",
      }),
    );
  }

  if (req.auth.role !== "admin") {
    return next(
      new ApiError(403, "Administrator access required. Only admins can access governance controls.", {
        code: "admin_required",
        details: `Your current role is '${req.auth.role}'. Admin privileges are required.`,
      }),
    );
  }

  return next();
}

