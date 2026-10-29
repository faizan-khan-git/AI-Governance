import { Router } from "express";

import { handleChat } from "../controllers/chat.controller.js";
import authenticate from "../middlewares/authenticate.js";
import checkQuota from "../middlewares/checkQuota.js";

const router = Router();

/**
 * POST /api/chat
 * Authenticates the caller (RBAC), enforces quota utilization bounds, then
 * accepts raw text (text/plain) or JSON and returns the sanitized model response.
 */
router.post("/chat", authenticate, checkQuota, handleChat);

export default router;
