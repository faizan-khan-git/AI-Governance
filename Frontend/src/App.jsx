import { Routes, Route, Navigate } from "react-router-dom";

import { useAuth } from "./context/AuthContext.jsx";
import SignIn from "./components/SignIn/SignIn.jsx";
import ChatConsole from "./components/ChatConsole/ChatConsole.jsx";
import AdminLayout from "./components/admin/AdminLayout/AdminLayout.jsx";
import DashboardOverview from "./components/admin/DashboardOverview/DashboardOverview.jsx";
import AuditLogViewer from "./components/admin/AuditLogViewer/AuditLogViewer.jsx";
import FlaggedPrompts from "./components/admin/FlaggedPrompts/FlaggedPrompts.jsx";
import PIIIncidents from "./components/admin/PIIIncidents/PIIIncidents.jsx";
import UserManagement from "./components/admin/UserManagement/UserManagement.jsx";
import UserDetail from "./components/admin/UserManagement/UserDetail.jsx";
import QuotaManager from "./components/admin/QuotaManager/QuotaManager.jsx";
import SystemsOverview from "./components/admin/SystemsOverview/SystemsOverview.jsx";
import AccessControl from "./components/admin/AccessControl/AccessControl.jsx";
import Conversations from "./components/admin/Conversations/Conversations.jsx";
import ActivityLog from "./components/admin/ActivityLog/ActivityLog.jsx";

/**
 * Blocks the whole app behind a sign-in session.
 *
 * Access is invite-only, so nothing is rendered until the Backend confirms who
 * the visitor is. This is a convenience gate: every API call is still
 * authorised server-side.
 */
function RequireSession({ children }) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "rgba(214,220,255,0.62)",
          fontSize: 14,
        }}
      >
        Checking your session…
      </div>
    );
  }

  if (status !== "signedIn") {
    return <SignIn />;
  }

  return children;
}

export default function App() {
  return (
    <RequireSession>
    <Routes>
      {/* Default Chat Console Route — 100% preserves existing functionality */}
      <Route path="/" element={<ChatConsole />} />

      {/* Admin Governance Portal Routes */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardOverview />} />
        <Route path="audit-logs" element={<AuditLogViewer />} />
        <Route path="flagged" element={<FlaggedPrompts />} />
        <Route path="pii-incidents" element={<PIIIncidents />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="users/:endUser" element={<UserDetail />} />
        <Route path="quotas" element={<QuotaManager />} />
        <Route path="systems" element={<SystemsOverview />} />
        <Route path="access" element={<AccessControl />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="activity" element={<ActivityLog />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </RequireSession>
  );
}
