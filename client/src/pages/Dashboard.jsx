import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isStaff, isAdmin } from '../context/AuthContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Badge, EmptyState, ErrorState, LoadingBlock, PageHeader, Stat } from '../components/ui.jsx';
import { timeAgo, statusLabel } from '../lib/format.js';

function TrendChart({ data }) {
  const max = Math.max(1, ...data.flatMap((m) => [m.lost, m.found, m.returned]));
  return (
    <figure style={{ margin: 0 }}>
      <div className="bars" role="img" aria-label={`Monthly reports and returns for the last ${data.length} months`}>
        {data.map((m) => (
          <div className="col" key={m.month} title={`${m.month}: ${m.lost} lost, ${m.found} found, ${m.returned} returned`}>
            <div className="pair">
              <div className="bar lost" style={{ height: `${(m.lost / max) * 100}%` }} />
              <div className="bar found" style={{ height: `${(m.found / max) * 100}%` }} />
              <div className="bar returned" style={{ height: `${(m.returned / max) * 100}%` }} />
            </div>
            <span className="tick">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>
      <figcaption className="legend"><span><i style={{ background: 'var(--violet-soft)' }} />Lost</span><span><i style={{ background: 'var(--teal)' }} />Found</span><span><i style={{ background: 'var(--amber)' }} />Returned</span></figcaption>
      <table className="visually-hidden"><caption>Monthly trend data</caption><thead><tr><th>Month</th><th>Lost</th><th>Found</th><th>Returned</th></tr></thead>
        <tbody>{data.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.lost}</td><td>{m.found}</td><td>{m.returned}</td></tr>)}</tbody></table>
    </figure>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get('/api/dashboard'), []);
  if (loading) return <LoadingBlock label="Loading your dashboard..." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const s = data.student;
  const st = data.staff;
  const ad = data.admin;

  return (
    <div className="stack">
      <PageHeader title={`Hello, ${user.full_name.split(' ')[0]}`} subtitle="Here is what is happening with your reports."
        actions={<><Link className="btn" to="/report/new/lost">Report lost item</Link><Link className="btn teal" to="/report/new/found">Report found item</Link></>} />
      <section aria-labelledby="mine" className="card">
        <h2 id="mine">My activity</h2>
        <div className="grid grid-4">
          <Stat value={s.lost_reports} label="My lost reports" tone="violet" />
          <Stat value={s.found_reports} label="My found reports" tone="accent" />
          <Stat value={s.active_claims} label="Active claims" />
          <Stat value={s.awaiting_action} label="Awaiting my action" />
          <Stat value={s.potential_matches} label="Potential matches" tone="accent" />
        </div>
        {s.awaiting_action > 0 && <p className="alert info" style={{ marginTop: 14 }}>Staff asked for more information on a claim. <Link to="/claims">Open my claims</Link></p>}
        {s.potential_matches > 0 && <p className="alert info" style={{ marginTop: 14 }}>You have possible matches to review (suggestions only). <Link to="/matches">Review matches</Link></p>}
      </section>
      <section aria-labelledby="recent" className="card">
        <h2 id="recent">Recently updated</h2>
        {s.recent.length === 0 ? (
          <EmptyState title="No reports yet" action={<Link className="btn" to="/report/new/lost">Create your first report</Link>}>When you report something lost or found it will show up here.</EmptyState>
        ) : (
          <div className="table-wrap"><table><thead><tr><th>Report</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{s.recent.map((r) => (<tr key={`${r.type}-${r.id}`}><td><Link to={`/reports/${r.type}/${r.id}`}>{r.title}</Link></td><td>{r.type}</td><td><Badge status={r.status} /></td><td>{timeAgo(r.updated_at)}</td></tr>))}</tbody></table></div>
        )}
      </section>

      {isStaff(user) && st && (
        <section aria-labelledby="staff" className="card">
          <h2 id="staff">Staff workload</h2>
          <div className="grid grid-4">
            <Stat value={st.reports_needing_review} label="Found reports to review" tone="violet" />
            <Stat value={st.pending_claims} label="Pending claims" />
            <Stat value={st.unreviewed_claims} label="Not yet picked up" />
            <Stat value={st.awaiting_return} label="Approved, awaiting return" tone="accent" />
            <Stat value={st.my_active_reviews} label="My active reviews" />
            <Stat value={st.open_flags} label="Open flags" />
          </div>
          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <div><h3>Oldest pending claims</h3>
              {st.oldest_pending_claims.length === 0 ? <p className="muted">No pending claims.</p> : (
                <ul>{st.oldest_pending_claims.map((c) => <li key={c.id}><Link to={`/claims/${c.id}`}>{c.found_title}</Link> <Badge status={c.status} /> <span className="muted small">{timeAgo(c.created_at)}</span></li>)}</ul>)}
            </div>
            <div><h3>Recent status changes</h3>
              {st.recent_status_changes.length === 0 ? <p className="muted">Nothing yet.</p> : (
                <ul>{st.recent_status_changes.map((c, i) => <li key={i}><Link to={`/reports/${c.type}/${c.id}`}>{c.title}</Link> <span className="muted small">{c.from_status ? `${statusLabel(c.from_status)} → ` : ''}{statusLabel(c.to_status)} · {timeAgo(c.created_at)}</span></li>)}</ul>)}
            </div>
          </div>
        </section>
      )}

      {isAdmin(user) && ad && (
        <section aria-labelledby="admin" className="card">
          <h2 id="admin">Campus overview</h2>
          <div className="grid grid-4">
            <Stat value={ad.active_users} label="Active users" />
            <Stat value={ad.lost_total} label="Lost reports" tone="violet" />
            <Stat value={ad.found_total} label="Found reports" tone="accent" />
            <Stat value={ad.open_claims} label="Open claims" />
            <Stat value={ad.returned_items} label="Items returned" tone="accent" />
            <Stat value={ad.open_flags} label="Flagged reports" />
          </div>
          <h3 style={{ marginTop: 22 }}>Monthly reports and returns</h3>
          {ad.lost_total + ad.found_total === 0 ? <p className="muted">No activity yet. Charts appear once reports are submitted.</p> : <TrendChart data={ad.monthly} />}
          <h3 style={{ marginTop: 22 }}>Reports by category and status</h3>
          {ad.by_category_status.length === 0 ? <p className="muted">No reports yet.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Category</th><th>Type</th><th>Status</th><th>Count</th></tr></thead>
              <tbody>{ad.by_category_status.map((r, i) => <tr key={i}><td>{r.category}</td><td>{r.type}</td><td><Badge status={r.status} /></td><td>{r.n}</td></tr>)}</tbody></table></div>)}
        </section>
      )}
    </div>
  );
}
