import { Router } from "express";

import { handleChat } from "../controllers/chat.controller.js";

const router = Router();

/**
 * POST /api/chat
 * Accepts raw text (text/plain) or JSON ({ text|message|prompt, model?,
 * temperature?, system? }) and returns the sanitized model response.
 */
router.post("/chat", handleChat);

export default router;
