import * as adminService from "../services/admin.service.js";
import * as usersService from "../services/users.service.js";
import * as transcriptService from "../services/transcript.service.js";
import ApiError from "../utils/ApiError.js";

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



// ── Access list (invite-only sign-in) ───────────────────────────────────────

/** GET /api/admin/access - users an administrator has granted access to. */
export async function listAccess(req, res, next) {
  try {
    const { search, status, role } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10) || 50));
    const result = await usersService.listUsers({
      search,
      status,
      role,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({
      success: true,
      data: result.data,
      pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/access/:endUser — one person, with their usage and transcript index. */
export async function getAccessUser(req, res, next) {
  try {
    const data = await usersService.getUserDetail(req.params.endUser);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/access — invite someone. This is the only way in. */
export async function inviteUser(req, res, next) {
  try {
    const user = await usersService.inviteUser(
      {
        email: req.body?.email,
        role: req.body?.role,
        displayName: req.body?.displayName,
        department: req.body?.department,
        notes: req.body?.notes,
      },
      req.auth?.user ?? { email: req.auth?.subject },
      { ip: req.ip },
    );
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/access/:endUser — change role or status. */
export async function updateUser(req, res, next) {
  try {
    const actor = req.auth?.user ?? { email: req.auth?.subject };
    const { role, status } = req.body ?? {};
    if (!role && !status) {
      throw new ApiError(400, "Provide a role or a status to change.", {
        code: "invalid_request",
      });
    }

    let user;
    if (role) user = await usersService.updateRole(req.params.endUser, role, actor, { ip: req.ip });
    if (status) user = await usersService.updateStatus(req.params.endUser, status, actor, { ip: req.ip });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/access/:endUser — revoke access (history is preserved). */
export async function removeUser(req, res, next) {
  try {
    const user = await usersService.removeUser(
      req.params.endUser,
      req.auth?.user ?? { email: req.auth?.subject },
      { ip: req.ip },
    );
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/organisation-labels — helper for the UI to disable self-demotion. */
export async function getAdminActions(req, res, next) {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || "100", 10) || 100));
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const [actions, denials] = await Promise.all([
      usersService.listAdminActions({ limit, offset: (page - 1) * limit }),
      usersService.listAccessDenials({ limit: 50 }),
    ]);
    res.json({
      success: true,
      data: actions.data,
      denials,
      pagination: {
        page,
        limit,
        total: actions.total,
        totalPages: Math.ceil(actions.total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Conversation transcripts (admin-only, every read is logged) ────────────

/** GET /api/admin/conversations — recent prompt/reply exchanges. */
export async function getConversations(req, res, next) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10) || 50));
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const result = await transcriptService.listTranscripts({
      endUser: req.query.endUser,
      requestId: req.query.requestId,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({
      success: true,
      data: result.data,
      pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/conversations/:id — read one transcript (recorded as a view). */
export async function getConversation(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      throw new ApiError(400, "Invalid conversation id.", { code: "invalid_request" });
    }
    const data = await transcriptService.getTranscript(
      id,
      req.auth?.user ?? { email: req.auth?.subject },
      { ip: req.ip },
    );
    if (!data) throw new ApiError(404, "Conversation not found.", { code: "not_found" });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
