import { Router } from "express";

import chatRoutes from "./chat.routes.js";

const router = Router();

/**
 * Liveness/health probe for Kubernetes and load balancers.
 */
router.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "ai-governance-backend" });
});

router.use("/api", chatRoutes);

export default router;
