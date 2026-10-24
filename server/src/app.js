// Express adapter: HTTP concerns only (headers, cookies, rate limiting, uploads, static files).
// All business rules live in services/ and are reached through the neutral route table.
//
// NOTE: this file requires express, helmet, cookie-parser, express-rate-limit and multer. They could not be
// installed in the environment where LUNA was authored (npm registry blocked), so THIS FILE HAS NOT BEEN EXECUTED.
// See README "Verification status".
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { HttpError } from './lib/errors.js';
import { authorize, checkCsrf } from './lib/access.js';
import { getSessionUser } from './services/sessions.js';
import { LocalDiskStorage } from './services/photos.js';
import { defineRoutes } from './routes/index.js';

export const COOKIE_NAME = 'luna_sid';

export function createApp({ config, db, storage = new LocalDiskStorage(config.uploadDir) }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
        objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      },
    },
    hsts: config.nodeEnv === 'production',
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Coarse per-IP limits (the per-account lockout lives in services/auth.js and is covered by tests)
  const authLimiter = rateLimit({ windowMs: config.loginWindowMs, limit: config.loginMaxAttempts * 3, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'Too many requests. Please try again later.' } } });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'Too many requests. Please slow down.' } } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api', apiLimiter);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

  for (const route of defineRoutes()) {
    // 1) guard FIRST (CSRF header, session, role) so unauthenticated/cross-site requests never reach body parsing or uploads
    const guard = (req, res, next) => {
      try {
        checkCsrf(req.method, req.headers);
        req.luna = { token: req.cookies?.[COOKIE_NAME] };
        req.luna.user = getSessionUser(db, config, req.luna.token);
        authorize(route.access, req.luna.user);
        next();
      } catch (e) {
        sendError(res, e);
      }
    };
    // 2) multipart parsing only for upload routes
    const middleware = route.upload ? [guard, upload.single('photo')] : [guard];
    app[route.method.toLowerCase()](route.path, ...middleware, async (req, res) => {
      try {
        const ctx = {
          db, config, storage, user: req.luna.user, token: req.luna.token, ip: req.ip || 'unknown', params: req.params, query: req.query,
          body: req.body ?? {}, file: req.file?.buffer, status: 200, cookie: null,
        };
        const result = await route.handler(ctx);
        if (ctx.cookie?.set) {
          res.cookie(COOKIE_NAME, ctx.cookie.set.token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: ctx.cookie.set.maxAgeMs, path: '/' });
        } else if (ctx.cookie?.clear) {
          res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
        }
        if (result?.__binary) {
          res.set({ 'Content-Type': result.__binary.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' });
          return res.send(result.__binary.buffer);
        }
        return res.status(ctx.status).json(result ?? { ok: true });
      } catch (e) {
        return sendError(res, e);
      }
    });
  }

  app.use('/api', (req, res) => res.status(404).json({ error: { message: 'Not found' } }));

  // Production: serve the built React app and fall back to index.html for client-side routes.
  const dist = path.join(config.clientDir, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => sendError(res, err));
  return app;
}

function sendError(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: { message: e.message, fields: e.fields } });
  if (e?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { message: 'Image is too large' } });
  if (e?.type === 'entity.too.large') return res.status(413).json({ error: { message: 'Request is too large' } });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'Invalid JSON body' } });
  console.error('Unhandled error:', e?.message); // message only: never log bodies, cookies or stack data containing user input
  return res.status(500).json({ error: { message: 'Something went wrong on our side' } });
}
