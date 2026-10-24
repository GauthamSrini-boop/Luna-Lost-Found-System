// Tiny fetch wrapper. Cookies carry the session; the X-Requested-With header is required by the server on
// state-changing requests (CSRF defence together with SameSite cookies).
import { toQuery } from './lib/format.js';

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function request(method, url, { body, raw } = {}) {
  const headers = { 'X-Requested-With': 'LUNA' };
  let payload;
  if (raw) payload = raw; // FormData: the browser sets the multipart boundary
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || res.statusText || 'Request failed', data?.error?.fields);
  return data;
}

export const api = {
  get: (url, params) => request('GET', `${url}${toQuery(params)}`),
  post: (url, body) => request('POST', url, { body: body ?? {} }),
  patch: (url, body) => request('PATCH', url, { body }),
  upload: (url, file) => { const fd = new FormData(); fd.append('photo', file); return request('POST', url, { raw: fd }); },
};
