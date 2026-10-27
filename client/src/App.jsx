import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import ClientsPage from './features/clients/ClientsPage.jsx';
import DeliverablePage from './features/deliverables/DeliverablePage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import PasswordChangePage from './features/auth/PasswordChangePage.jsx';
import ProjectDetailPage from './features/projects/ProjectDetailPage.jsx';
import ProjectsPage from './features/projects/ProjectsPage.jsx';
import WorkspaceLayout from './components/layout/WorkspaceLayout.jsx';

function AuthenticationGate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <main className="loading-screen" role="status">Loading your workspace…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/password') return <Navigate to="/password" replace />;
  if (!user.mustChangePassword && location.pathname === '/password') return <Navigate to="/projects" replace />;
  return <Outlet />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthenticationGate />}>
        <Route path="/password" element={<PasswordChangePage />} />
        <Route element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/deliverables/:deliverableId" element={<DeliverablePage />} />
          <Route path="/clients" element={<ClientsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter><AppRoutes /></BrowserRouter>
    </AuthProvider>
  );
}