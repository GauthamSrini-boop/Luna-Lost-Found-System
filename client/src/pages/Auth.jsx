import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, Logo } from '../components/ui.jsx';
import { validateLogin, validateRegister } from '../lib/validate.js';
import { errorMessage } from '../lib/format.js';

function AuthShell({ title, children, footer }) {
  return (
    <div className="auth-wrap">
      <main id="main" className="card auth-card stack">
        <Link to="/" className="brand" aria-label="LUNA home"><Logo /> LUNA</Link>
        <h1>{title}</h1>
        {children}
        <p className="muted small center">{footer}</p>
      </main>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problems = validateLogin(values);
    setErrors(problems); setFormError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await login({ email: values.email.trim(), password: values.password });
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Sign in" footer={<>New to LUNA? <Link to="/register">Create an account</Link></>}>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={submit} noValidate className="stack">
        <Field label="Email" error={errors.email} required>{(p) => <input {...p} type="email" autoComplete="email" value={values.email} onChange={set('email')} />}</Field>
        <Field label="Password" error={errors.password} required>{(p) => <input {...p} type="password" autoComplete="current-password" value={values.password} onChange={set('password')} />}</Field>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [values, setValues] = useState({ full_name: '', email: '', student_id: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problems = validateRegister(values);
    setErrors(problems); setFormError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await register({ full_name: values.full_name.trim(), email: values.email.trim(), password: values.password, student_id: values.student_id.trim() || undefined });
      toast.success('Welcome to LUNA!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Create your account" footer={<>Already registered? <Link to="/login">Sign in</Link></>}>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={submit} noValidate className="stack">
        <Field label="Full name" error={errors.full_name} required>{(p) => <input {...p} autoComplete="name" value={values.full_name} onChange={set('full_name')} />}</Field>
        <Field label="Campus email" error={errors.email} required>{(p) => <input {...p} type="email" autoComplete="email" value={values.email} onChange={set('email')} />}</Field>
        <Field label="Student ID" error={errors.student_id} hint="Optional">{(p) => <input {...p} value={values.student_id} onChange={set('student_id')} />}</Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters with a letter and a number" required>{(p) => <input {...p} type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />}</Field>
        <Field label="Confirm password" error={errors.confirm} required>{(p) => <input {...p} type="password" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />}</Field>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}
