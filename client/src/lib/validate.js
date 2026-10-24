// Client-side form validation. Mirrors the server rules for fast feedback only;
// the server remains the source of truth and always re-validates.
export const isoToday = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`; // local calendar date
};

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const req = (v) => (v === undefined || v === null || String(v).trim() === '');
const len = (label, v, min, max) => {
  const s = String(v).trim();
  if (min && s.length < min) return `${label} must be at least ${min} characters`;
  if (max && s.length > max) return `${label} must be at most ${max} characters`;
  return null;
};

/** Each validator returns an object {field: message}; an empty object means valid. */
export function validateReport(values, type, today = isoToday()) {
  const e = {};
  const dateField = type === 'lost' ? 'last_seen_date' : 'found_date';
  if (req(values.title)) e.title = 'Title is required'; else { const m = len('Title', values.title, 3, 120); if (m) e.title = m; }
  if (req(values.category_id)) e.category_id = 'Choose a category';
  if (req(values.description)) e.description = 'Description is required'; else { const m = len('Description', values.description, 10, 2000); if (m) e.description = m; }
  if (values.distinguishing_details && values.distinguishing_details.length > 1000) e.distinguishing_details = 'Must be at most 1000 characters';
  if (req(values[dateField])) e[dateField] = 'Date is required';
  else if (!validDate(values[dateField])) e[dateField] = 'Enter a valid date';
  else if (values[dateField] > today) e[dateField] = 'Date cannot be in the future';
  else if (values[dateField] < '2000-01-01') e[dateField] = 'Date is too far in the past';
  if (req(values.location_id)) e.location_id = 'Choose a location';
  return e;
}

export function validateLogin(v) {
  const e = {};
  if (req(v.email)) e.email = 'Email is required';
  if (req(v.password)) e.password = 'Password is required';
  return e;
}

export function validateRegister(v) {
  const e = {};
  if (req(v.full_name)) e.full_name = 'Full name is required'; else { const m = len('Full name', v.full_name, 2, 100); if (m) e.full_name = m; }
  if (req(v.email)) e.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = 'Enter a valid email address';
  const pw = v.password || '';
  if (!pw) e.password = 'Password is required';
  else if (pw.length < 8) e.password = 'Password must be at least 8 characters';
  else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) e.password = 'Password must include a letter and a number';
  if (v.confirm !== pw) e.confirm = 'Passwords do not match';
  return e;
}

export function validateClaim(v) {
  const e = {};
  if (req(v.explanation)) e.explanation = 'Please describe how you can prove this item is yours';
  else { const m = len('Explanation', v.explanation, 10, 2000); if (m) e.explanation = m; }
  return e;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export function validateImage(file) {
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.type)) return 'Photo must be a JPEG, PNG or WebP image';
  if (file.size > MAX_IMAGE_BYTES) return 'Photo must be 2 MB or smaller';
  return null;
}
