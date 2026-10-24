import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, PageHeader } from '../components/ui.jsx';
import { errorMessage } from '../lib/format.js';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ full_name: user.full_name, student_id: user.student_id || '', phone: user.phone || '' });
  const [pErrors, setPErrors] = useState({});
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [wErrors, setWErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function saveProfile(e) {
    e.preventDefault(); setPErrors({});
    if (profile.full_name.trim().length < 2) return setPErrors({ full_name: 'Full name must be at least 2 characters' });
    setBusy(true);
    try {
      const d = await api.patch('/api/auth/me', { full_name: profile.full_name, student_id: profile.student_id || null, phone: profile.phone || null });
      setUser(d.user); toast.success('Profile saved');
    } catch (err) { setPErrors(err.fields || {}); toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  async function changePassword(e) {
    e.preventDefault(); setWErrors({});
    const errs = {};
    if (!pw.current_password) errs.current_password = 'Enter your current password';
    if (pw.new_password.length < 8 || !/[A-Za-z]/.test(pw.new_password) || !/\d/.test(pw.new_password)) errs.new_password = 'At least 8 characters with a letter and a number';
    if (pw.new_password !== pw.confirm) errs.confirm = 'Passwords do not match';
    if (Object.keys(errs).length) return setWErrors(errs);
    setBusy(true);
    try {
      await api.post('/api/auth/password', { current_password: pw.current_password, new_password: pw.new_password });
      toast.success('Password changed. Other devices were signed out.');
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (err) { setWErrors(err.fields || {}); toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <PageHeader title="Profile & settings" subtitle={`${user.email} · ${user.role}`} />
      <div className="grid grid-2">
        <form className="card stack" onSubmit={saveProfile} noValidate aria-labelledby="prof-h">
          <h2 id="prof-h">Your details</h2>
          <Field label="Full name" error={pErrors.full_name} required>{(p) => <input {...p} value={profile.full_name} onChange={(e) => setProfile((v) => ({ ...v, full_name: e.target.value }))} />}</Field>
          <Field label="Student ID" error={pErrors.student_id}>{(p) => <input {...p} value={profile.student_id} onChange={(e) => setProfile((v) => ({ ...v, student_id: e.target.value }))} />}</Field>
          <Field label="Phone" error={pErrors.phone} hint="Only used if you choose phone as a contact preference.">{(p) => <input {...p} type="tel" value={profile.phone} onChange={(e) => setProfile((v) => ({ ...v, phone: e.target.value }))} />}</Field>
          <div><button className="btn" type="submit" disabled={busy}>Save changes</button></div>
        </form>
        <form className="card stack" onSubmit={changePassword} noValidate aria-labelledby="pw-h">
          <h2 id="pw-h">Change password</h2>
          <Alert kind="info">Changing your password signs you out everywhere else.</Alert>
          <Field label="Current password" error={wErrors.current_password} required>{(p) => <input {...p} type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw((v) => ({ ...v, current_password: e.target.value }))} />}</Field>
          <Field label="New password" error={wErrors.new_password} required>{(p) => <input {...p} type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw((v) => ({ ...v, new_password: e.target.value }))} />}</Field>
          <Field label="Confirm new password" error={wErrors.confirm} required>{(p) => <input {...p} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((v) => ({ ...v, confirm: e.target.value }))} />}</Field>
          <div><button className="btn" type="submit" disabled={busy}>Change password</button></div>
        </form>
      </div>
    </div>
  );
}
