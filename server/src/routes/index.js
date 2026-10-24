// Framework-neutral route table. Each handler receives a plain `ctx` object and returns data (or throws HttpError).
// The Express adapter (app.js) and the test dispatcher (tests/helpers.js) both run THIS table through the same
// authorize() check, so role enforcement happens on the server and is exercised by the automated tests.
//
// ctx = { db, config, storage, user, token, ip, params, query, body, file, status, cookie }
import { notFound } from '../lib/errors.js';
import { isStaff } from '../lib/access.js';
import * as auth from '../services/auth.js';
import * as sessions from '../services/sessions.js';
import * as reports from '../services/reports.js';
import * as matching from '../services/matching.js';
import * as claims from '../services/claims.js';
import * as photos from '../services/photos.js';
import * as notifs from '../services/notifications.js';
import * as admin from '../services/admin.js';
import { dashboardFor } from '../services/dashboard.js';
import { insights } from '../services/insights.js';

const pid = (raw) => {
  if (!/^\d{1,12}$/.test(String(raw)) || Number(raw) < 1) throw notFound('Not found');
  return Number(raw);
};

export function defineRoutes() {
  const R = [];
  const add = (method, path, access, handler, opts = {}) => R.push({ method, path, access, handler, ...opts });

  // ---------- auth ----------
  add('POST', '/api/auth/register', 'public', async (ctx) => {
    const { user, session } = await auth.register(ctx.db, ctx.config, ctx.body);
    ctx.status = 201; ctx.cookie = { set: session };
    return { user };
  });
  add('POST', '/api/auth/login', 'public', async (ctx) => {
    const { user, session } = await auth.login(ctx.db, ctx.config, ctx.body, ctx.ip);
    ctx.cookie = { set: session };
    return { user };
  });
  add('POST', '/api/auth/logout', 'public', (ctx) => {
    sessions.destroySession(ctx.db, ctx.config, ctx.token);
    ctx.cookie = { clear: true };
    return { ok: true };
  });
  add('GET', '/api/auth/me', 'public', (ctx) => ({ user: ctx.user || null, unread: ctx.user ? notifs.unreadCount(ctx.db, ctx.user) : 0 }));
  add('PATCH', '/api/auth/me', 'auth', (ctx) => ({ user: auth.updateProfile(ctx.db, ctx.user, ctx.body) }));
  add('POST', '/api/auth/password', 'auth', async (ctx) => {
    await auth.changePassword(ctx.db, ctx.config, ctx.user, ctx.body, ctx.token);
    return { ok: true };
  });

  // ---------- reference data ----------
  add('GET', '/api/meta', 'public', (ctx) => ({ categories: admin.listRef(ctx.db, 'categories'), locations: admin.listRef(ctx.db, 'locations') }));

  // ---------- reports ----------
  add('GET', '/api/reports', 'auth', (ctx) => reports.browse(ctx.db, ctx.user, ctx.query));
  add('GET', '/api/my/reports', 'auth', (ctx) => reports.myReports(ctx.db, ctx.user));

  for (const type of ['lost', 'found']) {
    add('POST', `/api/${type}`, 'auth', (ctx) => { ctx.status = 201; return reports.createReport(ctx.db, ctx.user, type, ctx.body); });
    add('GET', `/api/${type}/:id`, 'auth', (ctx) => reports.getReport(ctx.db, ctx.user, type, pid(ctx.params.id)));
    add('PATCH', `/api/${type}/:id`, 'auth', (ctx) => reports.updateReport(ctx.db, ctx.user, type, pid(ctx.params.id), ctx.body));
    add('POST', `/api/${type}/:id/status`, 'auth', (ctx) => reports.changeStatus(ctx.db, ctx.user, type, pid(ctx.params.id), ctx.body));
    add('POST', `/api/${type}/:id/flag`, 'auth', (ctx) => { ctx.status = 201; return reports.flagReport(ctx.db, ctx.user, type, pid(ctx.params.id), ctx.body); });
    add('POST', `/api/${type}/:id/photo`, 'auth', async (ctx) => {
      ctx.status = 201;
      return photos.savePhoto(ctx.db, ctx.storage, ctx.config, ctx.user, type, pid(ctx.params.id), ctx.file);
    }, { upload: true });
  }
  add('POST', '/api/lost/:id/refresh-matches', 'auth', (ctx) => {
    const id = pid(ctx.params.id);
    const r = ctx.db.get('SELECT user_id FROM lost_reports WHERE id = ?', id);
    if (!r || (r.user_id !== ctx.user.id && !isStaff(ctx.user))) throw notFound('Report not found');
    return { new_suggestions: matching.refreshMatchesForLost(ctx.db, id) };
  });

  // ---------- matches ----------
  add('GET', '/api/matches', 'auth', (ctx) => matching.listMatches(ctx.db, ctx.user, ctx.query));
  add('POST', '/api/matches/:id/review', 'auth', (ctx) => matching.reviewMatch(ctx.db, ctx.user, pid(ctx.params.id), ctx.body));

  // ---------- claims ----------
  add('POST', '/api/found/:id/claims', 'auth', (ctx) => { ctx.status = 201; return claims.submitClaim(ctx.db, ctx.user, pid(ctx.params.id), ctx.body); });
  add('GET', '/api/claims', 'auth', (ctx) => claims.listClaims(ctx.db, ctx.user, ctx.query));
  add('GET', '/api/claims/:id', 'auth', (ctx) => claims.getClaim(ctx.db, ctx.user, pid(ctx.params.id)));
  add('POST', '/api/claims/:id/action', 'auth', (ctx) => claims.claimAction(ctx.db, ctx.user, pid(ctx.params.id), ctx.body));

  // ---------- notifications & dashboard ----------
  add('GET', '/api/notifications', 'auth', (ctx) => notifs.listNotifications(ctx.db, ctx.user, ctx.query));
  add('POST', '/api/notifications/read-all', 'auth', (ctx) => { notifs.markAllRead(ctx.db, ctx.user); return { ok: true }; });
  add('POST', '/api/notifications/:id/read', 'auth', (ctx) => { notifs.markRead(ctx.db, ctx.user, pid(ctx.params.id)); return { ok: true }; });
  add('GET', '/api/dashboard', 'auth', (ctx) => dashboardFor(ctx.db, ctx.user));

  // ---------- uploaded photos ----------
  add('GET', '/uploads/:name', 'auth', async (ctx) => ({ __binary: await photos.readPhoto(ctx.db, ctx.storage, ctx.user, ctx.params.name) }));

  // ---------- admin ----------
  add('GET', '/api/admin/users', 'admin', (ctx) => admin.listUsers(ctx.db, ctx.query));
  add('POST', '/api/admin/users', 'admin', async (ctx) => { ctx.status = 201; return { user: await admin.createUser(ctx.db, ctx.user, ctx.body) }; });
  add('PATCH', '/api/admin/users/:id', 'admin', (ctx) => ({ user: admin.updateUser(ctx.db, ctx.user, pid(ctx.params.id), ctx.body) }));
  for (const kind of ['categories', 'locations']) {
    add('GET', `/api/admin/${kind}`, 'admin', (ctx) => ({ items: admin.listRef(ctx.db, kind, { includeInactive: true }) }));
    add('POST', `/api/admin/${kind}`, 'admin', (ctx) => { ctx.status = 201; return admin.createRef(ctx.db, ctx.user, kind, ctx.body); });
    add('PATCH', `/api/admin/${kind}/:id`, 'admin', (ctx) => admin.updateRef(ctx.db, ctx.user, kind, pid(ctx.params.id), ctx.body));
  }
  add('GET', '/api/admin/moderation', 'admin', (ctx) => admin.moderationQueue(ctx.db, ctx.user, ctx.query));
  add('POST', '/api/admin/reports/:type/:id/moderation', 'admin', (ctx) => admin.moderateReport(ctx.db, ctx.user, ctx.params.type, pid(ctx.params.id), ctx.body));
  add('GET', '/api/admin/audit', 'admin', (ctx) => admin.listAudit(ctx.db, ctx.query));
  add('GET', '/api/admin/insights', 'admin', (ctx) => insights(ctx.db));

  return R;
}
