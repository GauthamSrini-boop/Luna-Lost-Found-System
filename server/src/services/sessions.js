import crypto from 'node:crypto';

const hashToken = (config, token) => crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');
const ts = (ms) => new Date(ms).toISOString();

export function createSession(db, config, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = ts(Date.now() + config.sessionTtlHours * 3600 * 1000);
  db.run('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', userId, hashToken(config, token), expiresAt);
  db.run('DELETE FROM sessions WHERE expires_at < ?', ts(Date.now())); // opportunistic cleanup
  return { token, expiresAt, maxAgeMs: config.sessionTtlHours * 3600 * 1000 };
}

/** Returns the active user for a raw cookie token, or null. */
export function getSessionUser(db, config, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  return (
    db.get(
      `SELECT u.id, u.email, u.full_name, u.student_id, u.phone, u.role, u.is_active, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
      hashToken(config, token),
      ts(Date.now()),
    ) || null
  );
}
export function destroySession(db, config, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(config, token));
}
export function destroyUserSessions(db, userId, exceptToken, config) {
  if (exceptToken) db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, hashToken(config, exceptToken));
  else db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}
