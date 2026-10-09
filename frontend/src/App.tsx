import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { ChangePasswordPage, ForgotPage, LoginPage, ResetPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { DocEditor, DocList } from './pages/Documents';
import { ApprovalsPage, AuditPage, LedgerPage, NotificationsPage, ReportsPage, StockPage } from './pages/Operations';
import { MastersPage, RolesPage, UsersPage } from './pages/Setup';

function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="grid min-h-[100dvh] place-items-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPage />} />
      <Route path="/reset-password" element={<ResetPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="purchases" element={<DocList kind="purchases" />} />
          <Route path="purchases/:id" element={<DocEditor kind="purchases" />} />
          <Route path="production" element={<DocList kind="production" />} />
          <Route path="production/:id" element={<DocEditor kind="production" />} />
          <Route path="transfers" element={<DocList kind="transfers" />} />
          <Route path="transfers/:id" element={<DocEditor kind="transfers" />} />
          <Route path="shipments" element={<DocList kind="shipments" />} />
          <Route path="shipments/:id" element={<DocEditor kind="shipments" />} />
          <Route path="adjustments" element={<DocList kind="adjustments" />} />
          <Route path="adjustments/:id" element={<DocEditor kind="adjustments" />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="stock/ledger" element={<LedgerPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="master" element={<MastersPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
