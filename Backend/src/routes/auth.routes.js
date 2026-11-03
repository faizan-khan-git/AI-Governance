import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as authController from "../controllers/auth.controller.js";

const router = Router();

/**
 * Sign-in endpoints.
 *
 * These are mounted at /auth (outside /api) because Google redirects the
 * browser here, and cookies are scoped to this path during the handshake.
 *
 * The rate limiter applies to sign-in attempts only: it keeps a password-less
 * flow from being hammered, without affecting normal API traffic.
 */
const signInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "rate_limited",
      message: "Too many sign-in attempts. Please wait a moment and try again.",
    },
  },
});

router.get("/config", authController.authConfig);
router.get("/me", authController.me);
router.get("/google", signInLimiter, authController.beginGoogleSignIn);
router.get("/google/callback", signInLimiter, authController.googleCallback);
router.post("/signout", authController.signOut);

export default router;
