import * as adminService from "../services/admin.service.js";

/**
 * Controller handling all administrative governance endpoints.
 */

export async function getDashboard(_req, res, next) {
  try {
    const data = await adminService.getDashboardStats();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getTrends(req, res, next) {
  try {
    const days = parseInt(req.query.days || "30", 10);
    const data = await adminService.getDailyTrends(days);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogs(req, res, next) {
  try {
    const result = await adminService.getAuditLogs(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLog(req, res, next) {
  try {
    const data = await adminService.getAuditLogById(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getFlagged(req, res, next) {
  try {
    const result = await adminService.getFlaggedPrompts(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getPii(req, res, next) {
  try {
    const result = await adminService.getPiiIncidents(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getUsers(req, res, next) {
  try {
    const result = await adminService.getUsersSummary(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const data = await adminService.getUserDetail(req.params.endUser);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getQuotas(_req, res, next) {
  try {
    const data = await adminService.getQuotas();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function putQuota(req, res, next) {
  try {
    const data = await adminService.setQuota(req.params.endUser, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function deleteQuota(req, res, next) {
  try {
    const data = await adminService.deleteQuota(req.params.endUser);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getSystems(_req, res, next) {
  try {
    const data = await adminService.getAiSystems();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getSystem(req, res, next) {
  try {
    const data = await adminService.getAiSystemById(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getReviews(_req, res, next) {
  try {
    const data = await adminService.getRiskReviews();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

