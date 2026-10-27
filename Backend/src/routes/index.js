import { Router } from "express";

import chatRoutes from "./chat.routes.js";
import { isGatewayReady } from "../services/health.service.js";

const SERVICE_NAME = "ai-governance-backend";

const router = Router();

/**
 * Liveness probe for Kubernetes and load balancers. It deliberately checks no
 * dependencies, so a gateway outage never gets this process restarted.
 */
router.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: SERVICE_NAME });
});

/**
 * Readiness probe: the Backend is up *and* can reach the LiteLLM gateway.
 * Responds 503 when the gateway is down so UIs and orchestrators can tell
 * "Backend alive but gateway unavailable" apart from "Backend unreachable".
 */
router.get("/health/ready", async (_req, res, next) => {
  try {
    const gatewayUp = await isGatewayReady();
    res.status(gatewayUp ? 200 : 503).json({
      status: gatewayUp ? "ok" : "degraded",
      service: SERVICE_NAME,
      checks: { gateway: gatewayUp ? "up" : "down" },
    });
  } catch (error) {
    next(error);
  }
});

router.use("/api", chatRoutes);

export default router;
