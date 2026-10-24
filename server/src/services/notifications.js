import { v, validate } from '../lib/validate.js';

export function notify(db, userId, message, link = null) {
  db.run('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)', userId, message, link);
}
export function notifyStaff(db, message, link = null, exceptUserId = null) {
  for (const s of db.all("SELECT id FROM users WHERE role IN ('staff','admin') AND is_active = 1 AND id <> ?", exceptUserId ?? -1)) {
    notify(db, s.id, message, link);
  }
}
/** Append-only audit trail. Never put passwords, tokens or claim explanations in `detail`. */
export function audit(db, actorId, action, entityType, entityId, detail = null) {
  db.run('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)', actorId, action, entityType, entityId, detail);
}

export function listNotifications(db, user, query = {}) {
  const { page, page_size } = validate(
    { page: query.page ?? 1, page_size: query.page_size ?? 20 },
    { page: v.int({ min: 1, max: 10000 }), page_size: v.int({ min: 1, max: 50 }) },
  );
  const total = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', user.id).n;
  const items = db.all(
    'SELECT id, message, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    user.id, page_size, (page - 1) * page_size,
  );
  const unread = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', user.id).n;
  return { items, total, unread, page, page_size, total_pages: Math.max(1, Math.ceil(total / page_size)) };
}
export const unreadCount = (db, user) => db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', user.id).n;
export function markRead(db, user, id) {
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, user.id); // scoped to the owner
}
export function markAllRead(db, user) {
  db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', user.id);
}
