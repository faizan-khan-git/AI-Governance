import { Routes, Route, Navigate } from "react-router-dom";

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

export default function App() {
  return (
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
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
