import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isStaff } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Badge, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Pagination } from '../components/ui.jsx';
import { errorMessage, formatDate, statusLabel } from '../lib/format.js';

export default function Matches() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/matches', { status, page }), [status, page]);
  async function review(id, action) {
    try { await api.post(`/api/matches/${id}/review`, { action }); toast.success('Match updated'); reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div className="stack">
      <PageHeader title="Potential matches" subtitle="LUNA compares public details of lost and found reports using transparent rules. A suggestion is never proof of ownership and never grants a claim." />
      <div className="card">
        <Field label="Show">{(p) => <select {...p} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Active suggestions</option>{['suggested', 'reviewed', 'confirmed', 'dismissed'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>}</Field>
      </div>
      {loading && !data && <LoadingBlock label="Loading matches..." />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="No matches to show" action={<Link className="btn secondary" to="/browse">Browse reports</Link>}>New suggestions appear automatically when compatible lost and found reports exist.</EmptyState>}
      {data?.items.map((m) => (
        <article key={m.id} className="card">
          <div className="row spread">
            <div>
              <p className="muted small" style={{ margin: 0 }}>Your lost item</p>
              <h2 style={{ margin: 0 }}><Link to={`/reports/lost/${m.lost_report_id}`}>{m.lost_title}</Link></h2>
              <p className="muted small" style={{ margin: '8px 0 0' }}>may match found item</p>
              <h3 style={{ margin: 0 }}><Link to={`/reports/found/${m.found_report_id}`}>{m.found_title}</Link></h3>
              <p className="meta"><span>{m.found_category}</span><span>{m.found_location}</span><span>Found {formatDate(m.found_date)}</span></p>
            </div>
            <div className="row"><Badge status={m.status} /><span className={`score ${m.score < 60 ? 'low' : m.score < 80 ? 'mid' : ''}`} aria-label={`Match score ${m.score} out of 100`}>{m.score}</span></div>
          </div>
          <h3 style={{ marginTop: 12 }}>Why LUNA suggested this</h3>
          <ul className="reasons">{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="muted small">{m.note}</p>
          <div className="row">
            {m.status === 'suggested' && <button type="button" className="btn secondary sm" onClick={() => review(m.id, 'reviewed')}>Mark as reviewed</button>}
            {isStaff(user) && ['suggested', 'reviewed'].includes(m.status) && <button type="button" className="btn teal sm" onClick={() => review(m.id, 'confirmed')}>Confirm as likely match</button>}
            {['suggested', 'reviewed'].includes(m.status) && <button type="button" className="btn ghost sm" onClick={() => review(m.id, 'dismissed')}>Dismiss</button>}
            <Link className="btn sm" to={`/reports/found/${m.found_report_id}`}>View found item</Link>
          </div>
        </article>
      ))}
      {data && <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} />}
    </div>
  );
}
