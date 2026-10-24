import { Link } from 'react-router-dom';
import { Logo } from '../components/ui.jsx';

export function NotFound() {
  return (
    <div className="auth-wrap"><div className="card auth-card center stack">
      <Logo size={48} /><h1>Page not found</h1>
      <p className="muted">That page does not exist or has moved.</p>
      <Link className="btn" to="/">Back to LUNA</Link>
    </div></div>
  );
}
export function Unauthorized() {
  return (
    <div className="card center stack" role="alert">
      <h1>You do not have access</h1>
      <p className="muted">Your account role cannot open this page. If you think this is a mistake, contact an administrator.</p>
      <div><Link className="btn" to="/dashboard">Go to dashboard</Link></div>
    </div>
  );
}
