import { useEffect, useId, useRef } from 'react';
import { statusLabel, statusTone, errorMessage } from '../lib/format.js';

export function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#141b33" stroke="#2a3459" />
      <path d="M40 12a22 22 0 1 0 12 30A18 18 0 0 1 40 12z" fill="#a78bfa" />
      <circle cx="46" cy="20" r="3" fill="#2dd4bf" />
    </svg>
  );
}

export function Spinner() { return <span className="spinner" aria-hidden="true" />; }

export function LoadingBlock({ label = 'Loading...' }) {
  return (<div className="state" role="status" aria-live="polite"><Spinner /><p>{label}</p></div>);
}

export function EmptyState({ title, children, action }) {
  return (<div className="state"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>);
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state" role="alert">
      <h3>We could not load this</h3>
      <p>{errorMessage(error)}</p>
      {onRetry && <button type="button" className="btn secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Alert({ kind = 'error', children }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

/** Status badge: always shows the text label (colour is only a secondary cue). */
export function Badge({ status, children }) {
  return <span className={`badge badge-${statusTone(status)}`}>{children || statusLabel(status)}</span>;
}

/** Labelled form control. `children` is a render function receiving the aria/id props to spread on the control. */
export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, 'aria-required': required ? 'true' : undefined })}
      {hint && <p id={hintId} className="hint">{hint}</p>}
      {error && <p id={errId} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn secondary sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="muted small" aria-live="polite">Page {page} of {totalPages}</span>
      <button type="button" className="btn secondary sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

/** Accessible confirmation built on the native <dialog> element (focus trap and Esc handling come from the browser). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      {open && (
        <>
          <h2 id={titleId}>{title}</h2>
          <div className="stack">{children}</div>
          <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button>
          </div>
        </>
      )}
    </dialog>
  );
}

export function Stat({ value, label, tone = '' }) {
  return (<div className={`stat ${tone}`}><span className="num">{value ?? 0}</span><span className="lbl">{label}</span></div>);
}

export function Timeline({ items, renderNote }) {
  if (!items?.length) return null;
  return (
    <ol className="timeline">
      {items.map((h, i) => (
        <li key={i}>
          <div className="row"><Badge status={h.to_status} />{h.from_status && <span className="muted small">from {statusLabel(h.from_status)}</span>}</div>
          {(h.note || renderNote) && <div className="small">{renderNote ? renderNote(h) : h.note}</div>}
          <div className="muted small">{new Date(h.created_at).toLocaleString()}{h.changed_by ? ` · ${h.changed_by}` : ''}</div>
        </li>
      ))}
    </ol>
  );
}
