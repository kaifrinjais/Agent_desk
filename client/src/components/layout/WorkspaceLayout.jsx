import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function WorkspaceLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="wordmark" href="/projects">
          <span className="wordmark-mark" aria-hidden="true">A</span>AgencyDesk
        </a>
        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink to="/projects">Projects</NavLink>
          {user.role === 'manager' && <NavLink to="/clients">Clients</NavLink>}
        </nav>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">{user.fullName.slice(0, 1).toUpperCase()}</span>
          <span className="user-copy">
            <strong>{user.fullName}</strong>
            <small>{user.role}</small>
          </span>
          <button className="icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>
      <main className="workspace-main"><Outlet /></main>
    </div>
  );
}