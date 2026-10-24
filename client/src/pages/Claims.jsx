import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isStaff } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Alert, Badge, ConfirmDialog, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Pagination, Timeline } from '../components/ui.jsx';
import { errorMessage, formatDate, statusLabel, timeAgo } from '../lib/format.js';

export function ClaimsList() {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [status, setStatus] = useState(staff ? 'active' : '');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/claims', { status, page, scope: staff ? 'all' : undefined }), [status, page]);
  return (
    <div className="stack">
      <PageHeader title={staff ? 'Claim review' : 'My claims'} subtitle={staff ? 'Review ownership claims, request more information and record handovers.' : 'Track the claims you have submitted.'} />
      <div className="card"><Field label="Status">{(p) => (
        <select {...p} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All</option><option value="active">Active</option>
          {['submitted', 'under_review', 'info_requested', 'approved', 'completed', 'rejected', 'withdrawn'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>)}</Field></div>
      {loading && !data && <LoadingBlock label="Loading claims..." />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="No claims here" action={!staff && <Link className="btn" to="/browse?type=found">Browse found items</Link>}>{staff ? 'Nothing is waiting for review with this filter.' : 'When you submit a claim for a found item, it appears here.'}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th>{staff && <th>Claimant</th>}<th>Status</th><th>Submitted</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{data.items.map((c) => (
            <tr key={c.id}><td>{c.found_title}</td>{staff && <td>{c.claimant_name}</td>}<td><Badge status={c.status} /></td><td>{timeAgo(c.created_at)}</td>
              <td><Link className="btn secondary sm" to={`/claims/${c.id}`}>{staff ? 'Review' : 'View'}</Link></td></tr>))}</tbody>
        </table></div>
      )}
      {data && <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} />}
    </div>
  );
}

export function ClaimDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data: c, loading, error, reload } = useAsync(() => api.get(`/api/claims/${id}`), [id]);
  const [dialog, setDialog] = useState(null); // 'request_info' | 'approve' | 'reject' | 'handover' | 'respond' | 'withdraw'
  const [form, setForm] = useState({ message: '', reason: '', recipient_name: '', notes: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  if (loading) return <LoadingBlock label="Loading claim..." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const staff = isStaff(user);
  const can = (a) => c.allowed_actions.includes(a);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function run(action, extra = {}) {
    setBusy(true); setFieldErrors({});
    try {
      await api.post(`/api/claims/${id}/action`, { action, ...extra });
      toast.success('Claim updated');
      setDialog(null); setForm({ message: '', reason: '', recipient_name: '', notes: '' });
      reload();
    } catch (e) {
      if (e.fields && Object.keys(e.fields).length) setFieldErrors(e.fields); else { toast.error(errorMessage(e)); setDialog(null); }
    } finally { setBusy(false); }
  }
  const close = () => { setDialog(null); setFieldErrors({}); };

  return (
    <div className="stack">
      <PageHeader title={`Claim for "${c.found_report.title}"`} subtitle={`Submitted ${formatDate(c.created_at)}`} actions={<Badge status={c.status} />} />
      {c.status === 'approved' && !staff && <Alert kind="success">Your claim was approved. Staff will arrange the handover.</Alert>}
      {c.status === 'completed' && <Alert kind="success">This item was handed over{c.handover ? ` to ${c.handover.recipient_name} on ${formatDate(c.handover.handed_at)}` : ''}.</Alert>}
      {c.status === 'info_requested' && !staff && <Alert kind="info"><strong>Staff need more information:</strong> {c.verification_request}</Alert>}
      {c.status === 'rejected' && <Alert>This claim was not approved. Reason: {c.decision_reason}</Alert>}
      {staff && c.competing_claims > 0 && <Alert kind="info">{c.competing_claims} other active {c.competing_claims === 1 ? 'claim exists' : 'claims exist'} for this item. Only one can be approved.</Alert>}

      <div className="grid grid-2">
        <section className="card" aria-labelledby="c-h">
          <h2 id="c-h">Claim</h2>
          <dl className="kv">
            <dt>Item</dt><dd><Link to={`/reports/found/${c.found_report.id}`}>{c.found_report.title}</Link> <Badge status={c.found_report.status} /></dd>
            <dt>Where found</dt><dd>{c.found_report.location} · {formatDate(c.found_report.date)}</dd>
            {c.claimant && (<><dt>Claimant</dt><dd>{c.claimant.name} ({c.claimant.email})</dd></>)}
            {c.reviewer && (<><dt>Reviewer</dt><dd>{c.reviewer}</dd></>)}
          </dl>
          <div className="private-box" style={{ marginTop: 12 }}>
            <span className="tag">Private: claimant’s explanation</span>
            <p style={{ margin: '6px 0 0' }}>{c.explanation}</p>
          </div>
          {c.verification_request && staff && <p style={{ marginTop: 12 }}><strong>Staff asked:</strong> {c.verification_request}</p>}
          {c.verification_response && <p style={{ marginTop: 12 }}><strong>Claimant answered:</strong> {c.verification_response}</p>}
          {staff && (
            <div className="private-box" style={{ marginTop: 12 }}>
              <span className="tag">Private: finder’s distinguishing details (compare with explanation)</span>
              <p style={{ margin: '6px 0 0' }}>{c.found_private_details || 'None recorded'}</p>
            </div>
          )}
        </section>
        <section className="card" aria-labelledby="ch-h"><h2 id="ch-h">History</h2><Timeline items={c.history} /></section>
      </div>

      <section className="card" aria-labelledby="act-h">
        <h2 id="act-h">Actions</h2>
        {c.allowed_actions.length === 0 ? <p className="muted">No further actions are available for this claim.</p> : (
          <div className="row">
            {can('start_review') && <button type="button" className="btn" disabled={busy} onClick={() => run('start_review')}>Start review</button>}
            {can('request_info') && <button type="button" className="btn secondary" onClick={() => setDialog('request_info')}>Request more information</button>}
            {can('approve') && <button type="button" className="btn teal" onClick={() => setDialog('approve')}>Approve claim</button>}
            {can('handover') && <button type="button" className="btn teal" onClick={() => { setForm((f) => ({ ...f, recipient_name: c.claimant?.name || '' })); setDialog('handover'); }}>Record handover</button>}
            {can('reject') && <button type="button" className="btn danger" onClick={() => setDialog('reject')}>Reject claim</button>}
            {can('respond') && <button type="button" className="btn" onClick={() => setDialog('respond')}>Respond to staff</button>}
            {can('withdraw') && <button type="button" className="btn secondary" onClick={() => setDialog('withdraw')}>Withdraw claim</button>}
          </div>
        )}
      </section>

      <ConfirmDialog open={dialog === 'request_info'} title="Request more information" confirmLabel="Send request" busy={busy} onCancel={close} onConfirm={() => run('request_info', { message: form.message })}>
        <Field label="What should the claimant explain?" error={fieldErrors.message} required>{(p) => <textarea {...p} value={form.message} onChange={set('message')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'approve'} title="Approve this claim?" confirmLabel="Approve" busy={busy} onCancel={close} onConfirm={() => run('approve', { reason: form.reason || undefined })}>
        <p>Only one claim can be approved for an item. Other claims stay open until the handover is recorded.</p>
        <Field label="Note (optional)" error={fieldErrors.reason}>{(p) => <input {...p} value={form.reason} onChange={set('reason')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'reject'} title="Reject this claim" danger confirmLabel="Reject claim" busy={busy} onCancel={close} onConfirm={() => run('reject', { reason: form.reason })}>
        <Field label="Reason (shown to the claimant)" error={fieldErrors.reason} required>{(p) => <textarea {...p} value={form.reason} onChange={set('reason')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'handover'} title="Record handover" confirmLabel="Record handover" busy={busy} onCancel={close} onConfirm={() => run('handover', { recipient_name: form.recipient_name, notes: form.notes || undefined })}>
        <p>Confirm you have checked the recipient’s identity and handed the item over. This marks the item as returned and cannot be repeated.</p>
        <Field label="Recipient name" error={fieldErrors.recipient_name} required>{(p) => <input {...p} value={form.recipient_name} onChange={set('recipient_name')} />}</Field>
        <Field label="Notes (optional)" error={fieldErrors.notes}>{(p) => <input {...p} value={form.notes} onChange={set('notes')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'respond'} title="Respond to staff" confirmLabel="Send response" busy={busy} onCancel={close} onConfirm={() => run('respond', { message: form.message })}>
        <Field label="Your response" error={fieldErrors.message} required>{(p) => <textarea {...p} value={form.message} onChange={set('message')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'withdraw'} title="Withdraw this claim?" danger confirmLabel="Withdraw claim" busy={busy} onCancel={close} onConfirm={() => run('withdraw')}>
        <p>You will no longer be considered for this item. You can submit a new claim later if it is still available.</p>
      </ConfirmDialog>
    </div>
  );
}
