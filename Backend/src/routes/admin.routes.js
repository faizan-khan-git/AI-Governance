import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import requireAdmin from "../middlewares/requireAdmin.js";
import * as adminController from "../controllers/admin.controller.js";

const router = Router();

// Enforce RBAC authentication and role: admin on all administrative endpoints
router.use(authenticate, requireAdmin);

// Dashboard overview & trend telemetry
router.get("/dashboard", adminController.getDashboard);
router.get("/dashboard/trends", adminController.getTrends);

// Audit logging explorer
router.get("/audit-logs", adminController.getAuditLogs);
router.get("/audit-logs/:id", adminController.getAuditLog);

// Security guardrail & flagged prompts review
router.get("/flagged", adminController.getFlagged);

// PII incident tracking & breakdown
router.get("/pii-incidents", adminController.getPii);

// User governance & search telemetry
router.get("/users", adminController.getUsers);
router.get("/users/:endUser", adminController.getUser);

// Token quotas & utilization limits
router.get("/quotas", adminController.getQuotas);
router.put("/quotas/:endUser", adminController.putQuota);
router.delete("/quotas/:endUser", adminController.deleteQuota);

// AI Systems registry & classifications
router.get("/systems", adminController.getSystems);
router.get("/systems/:id", adminController.getSystem);

// Risk review trails
router.get("/risk-reviews", adminController.getReviews);

export default router;

