import { Link } from 'react-router-dom';
import { Logo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <nav aria-label="Site">
        <span className="brand"><Logo /> LUNA</span>
        <div className="row">
          {user ? <Link className="btn" to="/dashboard">Open dashboard</Link> : (<><Link className="btn ghost" to="/login">Sign in</Link><Link className="btn" to="/register">Create account</Link></>)}
        </div>
      </nav>
      <main id="main">
        <section className="hero">
          <h1>Lost something on campus? <span>Let LUNA bring it home.</span></h1>
          <p>LUNA is the campus Lost &amp; Found Network. Report what you lost or found, see explainable match suggestions, and claim items through a verified, tracked handover.</p>
          <div className="row">
            <Link className="btn teal" to={user ? '/report/new/lost' : '/register'}>Report a lost item</Link>
            <Link className="btn secondary" to={user ? '/report/new/found' : '/login'}>I found something</Link>
          </div>
        </section>
        <section className="steps" aria-label="How it works">
          <div className="card"><h3>Report</h3><p className="muted">Describe the item, where and when. Private identifying details stay private.</p></div>
          <div className="card"><h3>Match</h3><p className="muted">LUNA suggests possible matches using clear, deterministic rules and shows the reasons. Suggestions are never proof of ownership.</p></div>
          <div className="card"><h3>Claim &amp; verify</h3><p className="muted">Claimants explain what only the owner would know. Staff review, request more information, then approve or decline with a recorded reason.</p></div>
          <div className="card"><h3>Handover</h3><p className="muted">Staff record the return, so an item can never be handed over twice.</p></div>
        </section>
      </main>
    </div>
  );
}
