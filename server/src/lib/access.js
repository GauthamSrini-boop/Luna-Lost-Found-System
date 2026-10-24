// Authorization and CSRF rules shared by the Express adapter AND the test dispatcher,
// so what the tests verify is exactly what the server enforces.
import { forbidden, unauthorized } from './errors.js';

export const isStaff = (u) => !!u && (u.role === 'staff' || u.role === 'admin');
export const isAdmin = (u) => !!u && u.role === 'admin';

/** access: 'public' | 'auth' | 'staff' (staff or admin) | 'admin' */
export function authorize(access, user) {
  if (!access || access === 'public') return;
  if (!user || !user.is_active) throw unauthorized();
  if (access === 'auth') return;
  if (access === 'staff' && isStaff(user)) return;
  if (access === 'admin' && isAdmin(user)) return;
  throw forbidden();
}

/** Cookie auth is protected by SameSite=Lax plus a required custom header on state-changing requests. */
export function checkCsrf(method, headers) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  if (headers['x-requested-with'] !== 'LUNA') throw forbidden('Missing required request header');
}
