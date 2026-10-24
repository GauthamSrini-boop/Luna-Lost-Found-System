import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { resetMeta, useAsync, useDebounced } from '../lib/hooks.js';
import { Alert, Badge, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Pagination, Stat } from '../components/ui.jsx';
import ReportCard from '../components/ReportCard.jsx';
import { errorMessage, formatDateTime, statusLabel } from '../lib/format.js';

const TABS = [['overview', 'Insights'], ['users', 'Users'], ['catalogue', 'Categories & locations'], ['moderation', 'Moderation'], ['audit', 'Audit log']];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="stack">
      <PageHeader title="Administration" subtitle="Manage users, reference data and report quality." />
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(([k, l]) => <button key={k} role="tab" type="button" id={`tab-${k}`} aria-selected={tab === k} aria-controls="admin-panel" onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div id="admin-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Insights />}
        {tab === 'users' && <Users />}
        {tab === 'catalogue' && <Catalogue />}
        {tab === 'moderation' && <Moderation />}
        {tab === 'audit' && <AuditLog />}
      </div>
    </div>
  );
}

function Insights() {
  const { data, loading, error, reload } = useAsync(() => api.get('/api/admin/insights'), []);
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const rr = data.return_rate;
  return (
    <div className="stack">
      <div className="card"><h2>Return success</h2>
        <div className="grid grid-4"><Stat value={rr.found_total} label="Found reports" /><Stat value={rr.returned || 0} label="Returned to owners" tone="accent" /><Stat value={rr.rate_percent === null ? 'n/a' : `${rr.rate_percent}%`} label="Return rate" tone="violet" /></div>
        <h3 style={{ marginTop: 16 }}>Claim outcomes</h3>
        {data.claim_outcomes.length === 0 ? <p className="muted">No claims yet.</p> : <ul>{data.claim_outcomes.map((c) => <li key={c.status}>{statusLabel(c.status)}: {c.n}</li>)}</ul>}
      </div>
      <div className="grid grid-2">
        <div className="card"><h2>Most reported categories</h2>{data.top_categories.length === 0 ? <p className="muted">No data yet.</p> : <ol>{data.top_categories.map((c) => <li key={c.category}>{c.category} <span className="muted">({c.reports})</span></li>)}</ol>}</div>
        <div className="card"><h2>Most reported locations</h2>{data.top_locations.length === 0 ? <p className="muted">No data yet.</p> : <ol>{data.top_locations.map((c) => <li key={c.location}>{c.location} <span className="muted">({c.reports})</span></li>)}</ol>}</div>
      </div>
      <div className="card"><h2>Overdue and unresolved</h2>
        <h3>Found items unprocessed for 7+ days</h3>
        {data.overdue.found_unprocessed.length === 0 ? <p className="muted">None. Nice work.</p> : <ul>{data.overdue.found_unprocessed.map((r) => <li key={r.id}><Link to={`/reports/found/${r.id}`}>{r.title}</Link> <Badge status={r.status} /></li>)}</ul>}
        <h3>Claims waiting 3+ days</h3>
        {data.overdue.claims_waiting.length === 0 ? <p className="muted">None.</p> : <ul>{data.overdue.claims_waiting.map((r) => <li key={r.id}><Link to={`/claims/${r.id}`}>{r.title}</Link> <Badge status={r.status} /></li>)}</ul>}
        <h3>Lost reports open for 30+ days</h3>
        {data.overdue.lost_open_long.length === 0 ? <p className="muted">None.</p> : <ul>{data.overdue.lost_open_long.map((r) => <li key={r.id}><Link to={`/reports/lost/${r.id}`}>{r.title}</Link></li>)}</ul>}
      </div>
    </div>
  );
}

function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/admin/users', { q: dq, role, page }), [dq, role, page]);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'staff' });
  const [errors, setErrors] = useState({});
  async function patch(u, body) { try { await api.patch(`/api/admin/users/${u.id}`, body); toast.success('User updated'); reload(); } catch (e) { toast.error(errorMessage(e)); } }
  async function create(e) {
    e.preventDefault(); setErrors({});
    try { await api.post('/api/admin/users', form); toast.success('Account created'); setForm({ full_name: '', email: '', password: '', role: 'staff' }); reload(); }
    catch (err) { setErrors(err.fields || {}); toast.error(errorMessage(err)); }
  }
  return (
    <div className="stack">
      <form className="card form-grid" onSubmit={create} noValidate aria-labelledby="newuser-h">
        <h2 id="newuser-h" className="full" style={{ margin: 0 }}>Create staff or admin account</h2>
        <Field label="Full name" error={errors.full_name} required>{(p) => <input {...p} value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />}</Field>
        <Field label="Email" error={errors.email} required>{(p) => <input {...p} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />}</Field>
        <Field label="Temporary password" error={errors.password} required>{(p) => <input {...p} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />}</Field>
        <Field label="Role" error={errors.role}>{(p) => <select {...p} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}><option value="staff">Staff</option><option value="admin">Administrator</option><option value="student">Student</option></select>}</Field>
        <div className="full"><button className="btn" type="submit">Create account</button></div>
      </form>
      <div className="card filters">
        <Field label="Search users">{(p) => <input {...p} type="search" placeholder="Name, email or student ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}</Field>
        <Field label="Role">{(p) => <select {...p} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option><option value="student">Student</option><option value="staff">Staff</option><option value="admin">Admin</option></select>}</Field>
      </div>
      {loading && !data && <LoadingBlock />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="No users match" />}
      {data && data.items.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td>
              <td><label className="visually-hidden" htmlFor={`role-${u.id}`}>Role for {u.full_name}</label>
                <select id={`role-${u.id}`} value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value })} style={{ minHeight: 34, padding: '4px 8px' }}><option value="student">Student</option><option value="staff">Staff</option><option value="admin">Admin</option></select></td>
              <td>{u.is_active ? <Badge status="open">Active</Badge> : <Badge status="withdrawn">Deactivated</Badge>}</td>
              <td>{u.id !== me.id && <button type="button" className="btn secondary sm" onClick={() => patch(u, { is_active: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>}</td></tr>))}</tbody>
        </table></div>
      )}
      {data && <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} />}
    </div>
  );
}

function RefManager({ kind, label, withZone }) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/admin/${kind}`), [kind]);
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [errors, setErrors] = useState({});
  async function add(e) {
    e.preventDefault(); setErrors({});
    try { await api.post(`/api/admin/${kind}`, withZone ? { name, zone: zone || undefined } : { name }); toast.success(`${label} added`); setName(''); setZone(''); resetMeta(); reload(); }
    catch (err) { setErrors(err.fields || {}); toast.error(errorMessage(err)); }
  }
  async function toggle(item) { try { await api.patch(`/api/admin/${kind}/${item.id}`, { is_active: !item.is_active }); resetMeta(); reload(); } catch (e) { toast.error(errorMessage(e)); } }
  async function rename(item) {
    const next = window.prompt(`Rename ${label.toLowerCase()}`, item.name);
    if (!next || next === item.name) return;
    try { await api.patch(`/api/admin/${kind}/${item.id}`, { name: next }); toast.success('Renamed'); resetMeta(); reload(); } catch (e) { toast.error(e.fields?.name || errorMessage(e)); }
  }
  return (
    <div className="card stack">
      <h2>{label}s</h2>
      <form className="row" onSubmit={add} noValidate style={{ alignItems: 'flex-end' }}>
        <Field label={`New ${label.toLowerCase()}`} error={errors.name}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        {withZone && <Field label="Area / zone" hint="Same zone = nearby" error={errors.zone}>{(p) => <input {...p} value={zone} onChange={(e) => setZone(e.target.value)} />}</Field>}
        <button className="btn" type="submit">Add</button>
      </form>
      {loading && <LoadingBlock />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (<ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{data.items.map((i) => (
        <li key={i.id} className="row spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span>{i.name}{withZone && <span className="muted small"> · {i.zone}</span>} {!i.is_active && <Badge status="withdrawn">Inactive</Badge>}</span>
          <span className="row"><button type="button" className="btn ghost sm" onClick={() => rename(i)}>Rename</button><button type="button" className="btn secondary sm" onClick={() => toggle(i)}>{i.is_active ? 'Deactivate' : 'Reactivate'}</button></span>
        </li>))}</ul>)}
    </div>
  );
}
const Catalogue = () => (<div className="grid grid-2"><RefManager kind="categories" label="Category" /><RefManager kind="locations" label="Location" withZone /></div>);

function Moderation() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/admin/moderation', { q: dq }), [dq]);
  return (
    <div className="stack">
      <div className="card"><h2>Flagged reports</h2>
        {loading && !data && <LoadingBlock />}
        {error && <ErrorState error={error} onRetry={reload} />}
        {data && data.flagged.length === 0 && <p className="muted">No open flags.</p>}
        {data?.flagged.map((f) => (
          <div key={`${f.type}-${f.id}`} className="row spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div><Link to={`/reports/${f.type}/${f.id}`}><strong>{f.title}</strong></Link> <span className="muted small">({f.type}, {f.flags} {f.flags === 1 ? 'flag' : 'flags'}{f.is_hidden ? ', hidden' : ''})</span><div className="muted small">{f.reasons}</div></div>
            <Link className="btn secondary sm" to={`/reports/${f.type}/${f.id}`}>Review</Link>
          </div>))}
      </div>
      <div className="card"><h2>All reports (including hidden)</h2>
        <Field label="Search">{(p) => <input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        {data && data.reports.items.length === 0 && <EmptyState title="No reports found" />}
        <div className="report-list" style={{ marginTop: 14 }}>{data?.reports.items.map((r) => <div key={`${r.type}-${r.id}`}>{r.is_hidden && <Alert kind="info">Hidden</Alert>}<ReportCard report={r} /></div>)}</div>
      </div>
    </div>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/admin/audit', { page }), [page]);
  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="stack">
      {data.items.length === 0 ? <EmptyState title="No audit entries yet">Sensitive actions such as approvals, role changes and moderation are recorded here.</EmptyState> : (
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>{data.items.map((a) => <tr key={a.id}><td>{formatDateTime(a.created_at)}</td><td>{a.actor || 'system'}</td><td>{a.action}</td><td>{a.entity_type} #{a.entity_id}</td><td>{a.detail}</td></tr>)}</tbody></table></div>
      )}
      <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} />
    </div>
  );
}
