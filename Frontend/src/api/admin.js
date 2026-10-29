import { request } from "./client.js";

/**
 * Builds query string from an object, omitting null, undefined, or empty string values.
 */
function toQueryString(params = {}) {
  const entries = Object.entries(params).filter(
    ([_, val]) => val !== undefined && val !== null && val !== "",
  );
  if (entries.length === 0) return "";
  const searchParams = new URLSearchParams();
  for (const [key, val] of entries) {
    searchParams.append(key, String(val));
  }
  return `?${searchParams.toString()}`;
}

export async function fetchDashboard(auth) {
  const res = await request("/api/admin/dashboard", { auth });
  return res.data;
}

export async function fetchTrends(auth, days = 30) {
  const qs = toQueryString({ days });
  const res = await request(`/api/admin/dashboard/trends${qs}`, { auth });
  return res.data;
}

export async function fetchAuditLogs(auth, params = {}) {
  const qs = toQueryString(params);
  return request(`/api/admin/audit-logs${qs}`, { auth });
}

export async function fetchAuditLogById(auth, id) {
  const res = await request(`/api/admin/audit-logs/${id}`, { auth });
  return res.data;
}

export async function fetchFlaggedPrompts(auth, params = {}) {
  const qs = toQueryString(params);
  return request(`/api/admin/flagged${qs}`, { auth });
}

export async function fetchPiiIncidents(auth, params = {}) {
  const qs = toQueryString(params);
  return request(`/api/admin/pii-incidents${qs}`, { auth });
}

export async function fetchUsers(auth, params = {}) {
  const qs = toQueryString(params);
  return request(`/api/admin/users${qs}`, { auth });
}

export async function fetchUserDetail(auth, endUser) {
  const res = await request(`/api/admin/users/${encodeURIComponent(endUser)}`, { auth });
  return res.data;
}

export async function fetchQuotas(auth) {
  const res = await request("/api/admin/quotas", { auth });
  return res.data;
}

export async function saveQuota(auth, endUser, quotaData) {
  const res = await request(`/api/admin/quotas/${encodeURIComponent(endUser)}`, {
    method: "PUT",
    body: quotaData,
    auth,
  });
  return res.data;
}

export async function deleteQuota(auth, endUser) {
  const res = await request(`/api/admin/quotas/${encodeURIComponent(endUser)}`, {
    method: "DELETE",
    auth,
  });
  return res.data;
}

export async function fetchSystems(auth) {
  const res = await request("/api/admin/systems", { auth });
  return res.data;
}

export async function fetchSystemById(auth, id) {
  const res = await request(`/api/admin/systems/${encodeURIComponent(id)}`, { auth });
  return res.data;
}

export async function fetchRiskReviews(auth) {
  const res = await request("/api/admin/risk-reviews", { auth });
  return res.data;
}

