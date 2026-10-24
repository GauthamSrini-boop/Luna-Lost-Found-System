import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isStaff, isAdmin } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Alert, Badge, ConfirmDialog, ErrorState, Field, LoadingBlock, Timeline } from '../components/ui.jsx';
import { validateClaim } from '../lib/validate.js';
import { CONTACT_LABELS, STORAGE_LABELS, errorMessage, formatDate, statusLabel } from '../lib/format.js';

const DESTRUCTIVE = new Set(['withdrawn', 'archived', 'resolved']);

function MatchPanel({ lostId }) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/api/matches', { lost_id: lostId }), [lostId]);
  async function review(id, action) {
    try { await api.post(`/api/matches/${id}/review`, { action }); toast.success(action === 'dismissed' ? 'Suggestion dismissed' : 'Marked as reviewed'); reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <section className="card" aria-labelledby="matches-h">
      <h2 id="matches-h">Possible matches</h2>
      <p className="muted small">Suggestions are based on simple, visible rules. They are not proof of ownership. Open a found item and submit a claim to start verification.</p>
      {loading && <LoadingBlock label="Looking for matches..." />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <p className="muted">No possible matches yet. LUNA checks again whenever new items are reported.</p>}
      {data?.items.map((m) => (
        <div key={m.id} className="card pad-sm" style={{ marginTop: 10 }}>
          <div className="row spread"><Link to={`/reports/found/${m.found_report_id}`}><strong>{m.found_title}</strong></Link><span className="row"><Badge status={m.status} /><span className="score" aria-label={`Match score ${m.score} out of 100`}>{m.score}</span></span></div>
          <ul className="reasons">{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}>
            {m.status === 'suggested' && <button type="button" className="btn secondary sm" onClick={() => review(m.id, 'reviewed')}>Mark as reviewed</button>}
            <button type="button" className="btn ghost sm" onClick={() => review(m.id, 'dismissed')}>Not mine</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ClaimBox({ report, onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const myLost = useAsync(() => api.get('/api/my/reports'), []);
  const [values, setValues] = useState({ explanation: '', lost_report_id: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const p = validateClaim(values);
    setErrors(p); setFormError('');
    if (Object.keys(p).length) return;
    setBusy(true);
    try {
      const c = await api.post(`/api/found/${report.id}/claims`, { explanation: values.explanation, lost_report_id: values.lost_report_id ? Number(values.lost_report_id) : undefined });
      toast.success('Claim submitted. Staff will review it.');
      onDone?.();
      navigate(`/claims/${c.id}`);
    } catch (err) { setErrors(err.fields || {}); setFormError(errorMessage(err)); } finally { setBusy(false); }
  }
  const openLost = (myLost.data?.lost || []).filter((l) => l.status === 'open');
  return (
    <section className="card" aria-labelledby="claim-h">
      <h2 id="claim-h">Is this yours? Submit a claim</h2>
      <p className="muted small">Describe details only the owner would know (contents, marks, lock-screen, serial). Your explanation is private to you and staff.</p>
      {formError && <Alert>{formError}</Alert>}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="How can you prove it is yours?" error={errors.explanation} required>{(p) => <textarea {...p} maxLength={2000} value={values.explanation} onChange={(e) => setValues((v) => ({ ...v, explanation: e.target.value }))} />}</Field>
        {openLost.length > 0 && (
          <Field label="Link to your lost report (optional)" error={errors.lost_report_id}>{(p) => <select {...p} value={values.lost_report_id} onChange={(e) => setValues((v) => ({ ...v, lost_report_id: e.target.value }))}><option value="">None</option>{openLost.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>}</Field>
        )}
        <div><button className="btn teal" type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Submit claim'}</button></div>
      </form>
    </section>
  );
}

export default function ReportDetail() {
  const { type, id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: r, loading, error, reload } = useAsync(() => api.get(`/api/${type}/${id}`), [type, id]);
  const [pending, setPending] = useState(null); // status awaiting confirmation
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [modOpen, setModOpen] = useState(false);
  const [modReason, setModReason] = useState('');

  if (loading) return <LoadingBlock label="Loading report..." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  async function changeStatus(to) {
    setBusy(true);
    try { await api.post(`/api/${type}/${id}/status`, { to, note: note.trim() || undefined }); toast.success(`Status changed to ${statusLabel(to)}`); setPending(null); setNote(''); reload(); }
    catch (e) { toast.error(errorMessage(e)); setPending(null); } finally { setBusy(false); }
  }
  async function flag() {
    setBusy(true);
    try { await api.post(`/api/${type}/${id}/flag`, { reason: flagReason }); toast.success('Thanks. An administrator will review this report.'); setFlagOpen(false); setFlagReason(''); reload(); }
    catch (e) { toast.error(e.fields?.reason || errorMessage(e)); } finally { setBusy(false); }
  }
  async function moderate(hidden) {
    setBusy(true);
    try { await api.post(`/api/admin/reports/${type}/${id}/moderation`, { hidden, reason: hidden ? modReason : undefined }); toast.success(hidden ? 'Report hidden' : 'Report restored'); setModOpen(false); setModReason(''); reload(); }
    catch (e) { toast.error(e.fields?.reason || errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {r.is_hidden && <Alert kind="info">This report is hidden from other users{r.hidden_reason ? `: ${r.hidden_reason}` : '.'}</Alert>}
      <div className="page-header">
        <div>
          <span className={`type-tag ${r.type}`}>{r.type} item</span>
          <h1>{r.title}</h1>
          <div className="row"><Badge status={r.status} /><span className="muted small">Reported {formatDate(r.created_at)}</span></div>
        </div>
        <div className="row">
          {r.permissions.can_edit && <Link className="btn secondary" to={`/reports/${type}/${id}/edit`}>Edit</Link>}
          {r.permissions.next_statuses.map((s) => (
            <button key={s} type="button" className={`btn ${DESTRUCTIVE.has(s) ? 'secondary' : ''}`} onClick={() => (DESTRUCTIVE.has(s) ? setPending(s) : changeStatus(s))} disabled={busy}>
              {type === 'lost' && s === 'withdrawn' ? 'Withdraw report' : type === 'lost' && s === 'resolved' ? 'Mark as found / resolved' : `Mark ${statusLabel(s).toLowerCase()}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="details-h">
          <h2 id="details-h">Details</h2>
          {r.photo_url && <img src={r.photo_url} alt={`Photo of ${r.title}`} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 10, marginBottom: 14, background: 'var(--surface-2)' }} />}
          <dl className="kv">
            <dt>Category</dt><dd>{r.category.name}</dd>
            <dt>Location</dt><dd>{r.location.name}</dd>
            <dt>{r.type === 'lost' ? 'Last seen' : 'Found on'}</dt><dd>{formatDate(r.date)}</dd>
            {r.storage_status && (<><dt>Item is</dt><dd>{STORAGE_LABELS[r.storage_status]}</dd></>)}
            <dt>Description</dt><dd>{r.description}</dd>
            {r.reporter && (<><dt>Reported by</dt><dd>{r.reporter.name} ({r.reporter.email})</dd></>)}
          </dl>
          {r.private && (
            <div className="private-box" style={{ marginTop: 14 }}>
              <span className="tag">Private: visible to you and staff only</span>
              <dl className="kv" style={{ marginTop: 6 }}>
                <dt>Distinguishing details</dt><dd>{r.private.distinguishing_details || 'None provided'}</dd>
                {r.private.contact_preference && (<><dt>Contact preference</dt><dd>{CONTACT_LABELS[r.private.contact_preference]}</dd></>)}
              </dl>
            </div>
          )}
        </section>
        {r.history && (
          <section className="card" aria-labelledby="hist-h"><h2 id="hist-h">Status history</h2><Timeline items={r.history} /></section>
        )}
      </div>

      {type === 'lost' && r.is_mine && r.status === 'open' && <MatchPanel lostId={r.id} />}
      {type === 'found' && r.can_claim && <ClaimBox report={r} onDone={reload} />}
      {type === 'found' && r.my_claim && (
        <Alert kind="info">You have a claim on this item ({statusLabel(r.my_claim.status)}). <Link to={`/claims/${r.my_claim.id}`}>View your claim</Link></Alert>
      )}
      {type === 'found' && !r.can_claim && !r.my_claim && !r.is_mine && ['returned', 'archived'].includes(r.status) && <Alert kind="info">This item has been {r.status}. It can no longer be claimed.</Alert>}

      {!r.is_mine && (
        <div className="row">
          {!r.already_flagged ? <button type="button" className="btn ghost sm" onClick={() => setFlagOpen(true)}>Flag as inappropriate or duplicate</button> : <span className="muted small">You flagged this report. Thank you.</span>}
          {isAdmin(user) && (r.is_hidden ? <button type="button" className="btn secondary sm" onClick={() => moderate(false)} disabled={busy}>Restore report</button> : <button type="button" className="btn danger sm" onClick={() => setModOpen(true)}>Hide report</button>)}
        </div>
      )}
      {isStaff(user) && r.is_mine && null}

      <ConfirmDialog open={!!pending} title={`Change status to "${pending ? statusLabel(pending) : ''}"?`} danger confirmLabel="Yes, change status" busy={busy} onConfirm={() => changeStatus(pending)} onCancel={() => setPending(null)}>
        <p>This cannot always be undone. Add an optional note for the history.</p>
        <Field label="Note (optional)">{(p) => <input {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={flagOpen} title="Flag this report" confirmLabel="Send flag" busy={busy} onConfirm={flag} onCancel={() => setFlagOpen(false)}>
        <Field label="What is wrong with it?" required>{(p) => <textarea {...p} maxLength={500} value={flagReason} onChange={(e) => setFlagReason(e.target.value)} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={modOpen} title="Hide this report" danger confirmLabel="Hide report" busy={busy} onConfirm={() => moderate(true)} onCancel={() => setModOpen(false)}>
        <p>It will disappear from search for everyone except the owner and staff, and the owner is notified.</p>
        <Field label="Reason" required>{(p) => <input {...p} maxLength={500} value={modReason} onChange={(e) => setModReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}
