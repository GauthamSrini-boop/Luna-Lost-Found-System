// Central configuration. Values come from environment variables (optionally loaded from .env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile();

const resolvePath = (p) => (p === ':memory:' || path.isAbsolute(p) ? p : path.resolve(ROOT, p));

export function makeConfig(overrides = {}) {
  const env = process.env;
  const nodeEnv = env.NODE_ENV || 'development';
  const prod = nodeEnv === 'production';
  const cfg = {
    nodeEnv,
    port: Number(env.PORT || 3000),
    databasePath: resolvePath(env.DATABASE_PATH || 'server/data/luna.db'),
    uploadDir: resolvePath(env.UPLOAD_DIR || 'server/uploads'),
    clientDir: path.join(ROOT, 'client'),
    sessionSecret: env.SESSION_SECRET || '',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS || 168),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' || env.COOKIE_SECURE === '1' : prod,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024),
    loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 10),
    loginWindowMs: Number(env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000,
    trustProxy: env.TRUST_PROXY === '1',
    ...overrides,
  };
  if (!cfg.sessionSecret) {
    if (cfg.nodeEnv === 'production') {
      throw new Error('SESSION_SECRET must be set (32+ characters) when NODE_ENV=production');
    }
    cfg.sessionSecret = 'dev-only-insecure-secret-change-me';
    cfg.usingDevSecret = true;
  }
  if (cfg.nodeEnv === 'production' && cfg.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
  return cfg;
}
