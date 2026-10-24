import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isStaff, isAdmin } from '../context/AuthContext.jsx';
import { LoadingBlock, Logo } from './ui.jsx';

export function RequireAuth({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingBlock label="Checking your session..." />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return children;
}

export default function Layout() {
  const { user, unread, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const link = (to, label, end = false) => (<NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>{label}</NavLink>);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary" id="sidebar">
        <Link to="/dashboard" className="brand"><Logo /> LUNA</Link>
        <nav className="nav" aria-label="Main navigation">
          {link('/dashboard', 'Dashboard')}
          {link('/browse', 'Browse reports')}
          <div className="nav-label">Report</div>
          {link('/report/new/lost', 'I lost something')}
          {link('/report/new/found', 'I found something')}
          <div className="nav-label">Follow-up</div>
          {link('/matches', 'Potential matches')}
          {link('/claims', isStaff(user) ? 'Claim review' : 'My claims')}
          {link('/notifications', `Notifications${unread ? ` (${unread})` : ''}`)}
          {isAdmin(user) && (<><div className="nav-label">Administration</div>{link('/admin', 'Admin console')}</>)}
          <div className="nav-label">Account</div>
          {link('/profile', 'Profile & settings')}
        </nav>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="btn secondary menu-btn" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((o) => !o)}>Menu</button>
          <span className="muted small">Signed in as <strong>{user.full_name}</strong> · {user.role}</span>
          <div className="row">
            <Link to="/notifications" className="btn ghost sm bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>Alerts{unread > 0 && <span className="count" aria-hidden="true">{unread}</span>}</Link>
            <button type="button" className="btn secondary sm" onClick={async () => { await logout(); navigate('/'); }}>Sign out</button>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
