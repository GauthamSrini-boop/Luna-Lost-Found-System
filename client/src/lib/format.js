export const STATUS_LABELS = {
  open: 'Open', resolved: 'Resolved', withdrawn: 'Withdrawn',
  reported: 'Reported', under_review: 'Under review', stored: 'Stored securely', claim_pending: 'Claim pending', returned: 'Returned', archived: 'Archived',
  submitted: 'Submitted', info_requested: 'Info requested', approved: 'Approved', rejected: 'Rejected', completed: 'Completed',
  suggested: 'Suggested', reviewed: 'Reviewed', dismissed: 'Dismissed', confirmed: 'Confirmed',
};
export const statusLabel = (s) => STATUS_LABELS[s] || String(s || '').replace(/_/g, ' ');

/** Visual tone for a status badge (never colour alone: the label text is always shown too). */
export function statusTone(s) {
  if (['open', 'reported', 'submitted', 'suggested'].includes(s)) return 'violet';
  if (['stored', 'approved', 'confirmed', 'resolved', 'returned', 'completed'].includes(s)) return 'teal';
  if (['under_review', 'claim_pending', 'info_requested', 'reviewed'].includes(s)) return 'amber';
  if (['rejected'].includes(s)) return 'red';
  return 'muted'; // withdrawn, archived, dismissed
}

export const STORAGE_LABELS = { with_finder: 'With the finder', handed_to_security: 'Handed to security', at_lost_found_desk: 'At the lost & found desk' };
export const CONTACT_LABELS = { email: 'Email', phone: 'Phone', in_app: 'In-app notification' };

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(iso);
}

/** Build a query string from a filter object, skipping empty values. */
export function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== '' && v !== null && v !== undefined) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Human-readable messages for a failed API call; field errors are returned separately. */
export function errorMessage(err) {
  if (!err) return '';
  if (err.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  if (err.status === 429) return err.message || 'Too many attempts. Please wait a moment.';
  if (err.status >= 500) return 'Something went wrong on our side. Please try again.';
  return err.message || 'Something went wrong.';
}
