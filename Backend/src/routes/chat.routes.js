import { Router } from "express";

import { handleChat } from "../controllers/chat.controller.js";
import authenticate from "../middlewares/authenticate.js";

const router = Router();

/**
 * POST /api/chat
 * Authenticates the caller (RBAC), then accepts raw text (text/plain) or JSON
 * ({ text|message|prompt, model?, temperature?, system? }) and returns the
 * sanitized model response. The caller's role selects the LiteLLM virtual key.
 */
router.post("/chat", authenticate, handleChat);

export default router;
