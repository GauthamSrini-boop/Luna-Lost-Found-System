import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync, useMeta } from '../lib/hooks.js';
import { Alert, ErrorState, Field, LoadingBlock, PageHeader } from '../components/ui.jsx';
import { isoToday, validateImage, validateReport } from '../lib/validate.js';
import { errorMessage, CONTACT_LABELS, STORAGE_LABELS } from '../lib/format.js';

const blank = (type) => ({ title: '', category_id: '', description: '', distinguishing_details: '', location_id: '', contact_preference: 'in_app', storage_status: 'with_finder', [type === 'lost' ? 'last_seen_date' : 'found_date']: '' });

export default function ReportForm() {
  const { type, id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const meta = useMeta();
  const dateField = type === 'lost' ? 'last_seen_date' : 'found_date';
  const [values, setValues] = useState(blank(type));
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = useAsync(() => (editing ? api.get(`/api/${type}/${id}`) : Promise.resolve(null)), [type, id]);
  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setValues({ title: r.title, category_id: String(r.category.id), description: r.description, distinguishing_details: r.private?.distinguishing_details || '', location_id: String(r.location.id), contact_preference: r.private?.contact_preference || 'in_app', storage_status: r.storage_status || 'with_finder', [dateField]: r.date });
  }, [existing.data, dateField]);
  useEffect(() => { if (!editing) setValues(blank(type)); }, [type, editing]);

  if (type !== 'lost' && type !== 'found') return <ErrorState error={{ status: 404, message: 'Unknown report type' }} />;
  if (editing && existing.loading) return <LoadingBlock label="Loading report..." />;
  if (editing && existing.error) return <ErrorState error={existing.error} onRetry={existing.reload} />;
  if (editing && existing.data && !existing.data.permissions.can_edit) return <ErrorState error={{ status: 403, message: 'This report can no longer be edited.' }} />;

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problems = validateReport(values, type);
    const imageProblem = validateImage(file);
    if (imageProblem) problems.photo = imageProblem;
    setErrors(problems); setFormError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const payload = { ...values, category_id: Number(values.category_id), location_id: Number(values.location_id), distinguishing_details: values.distinguishing_details.trim() || null };
      if (type === 'lost') delete payload.storage_status; else delete payload.contact_preference;
      const saved = editing ? await api.patch(`/api/${type}/${id}`, payload) : await api.post(`/api/${type}`, payload);
      if (file) {
        try { await api.upload(`/api/${type}/${saved.id}/photo`, file); } catch (err) { toast.error(`Report saved, but the photo failed: ${errorMessage(err)}`); }
      }
      toast.success(editing ? 'Report updated' : 'Report submitted');
      navigate(`/reports/${type}/${saved.id}`);
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(errorMessage(err));
    } finally { setBusy(false); }
  }

  const title = `${editing ? 'Edit' : 'Report'} ${type === 'lost' ? 'a lost item' : 'a found item'}`;
  return (
    <div className="stack">
      <PageHeader title={title} subtitle={type === 'lost' ? 'The more precise you are, the better the matches. Distinguishing details stay private.' : 'Thank you for helping! Keep the item safe or hand it to security. Private details help staff verify the true owner.'} />
      {formError && <Alert>{formError}</Alert>}
      <form className="card form-grid" onSubmit={submit} noValidate>
        <Field label="Item title" error={errors.title} required className="full">{(p) => <input {...p} maxLength={120} value={values.title} onChange={set('title')} />}</Field>
        <Field label="Category" error={errors.category_id} required>{(p) => <select {...p} value={values.category_id} onChange={set('category_id')}><option value="">Choose...</option>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label="Campus location" error={errors.location_id} required>{(p) => <select {...p} value={values.location_id} onChange={set('location_id')}><option value="">Choose...</option>{meta?.locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label={type === 'lost' ? 'Last seen date' : 'Date found'} error={errors[dateField]} required>{(p) => <input {...p} type="date" max={isoToday()} min="2000-01-01" value={values[dateField]} onChange={set(dateField)} />}</Field>
        {type === 'lost' ? (
          <Field label="Preferred contact method" error={errors.contact_preference}>{(p) => <select {...p} value={values.contact_preference} onChange={set('contact_preference')}>{Object.entries(CONTACT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
        ) : (
          <Field label="Where is the item now?" error={errors.storage_status}>{(p) => <select {...p} value={values.storage_status} onChange={set('storage_status')}>{Object.entries(STORAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
        )}
        <Field label="Public description" error={errors.description} required className="full" hint="Shown to everyone. Do not include details only the owner would know (serial numbers, contents, marks).">{(p) => <textarea {...p} maxLength={2000} value={values.description} onChange={set('description')} />}</Field>
        <Field label="Private distinguishing details" error={errors.distinguishing_details} className="full" hint={type === 'lost' ? 'Only you and staff can see this. Staff use it to verify claims.' : 'Only you and staff can see this. Staff compare it with claimants’ explanations. Never share it with a claimant.'}>{(p) => <textarea {...p} maxLength={1000} value={values.distinguishing_details} onChange={set('distinguishing_details')} />}</Field>
        <Field label="Photo (optional)" error={errors.photo} className="full" hint="JPEG, PNG or WebP, up to 2 MB.">{(p) => <input {...p} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
        <div className="full row">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Submit report'}</button>
          <button className="btn secondary" type="button" onClick={() => navigate(-1)} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
