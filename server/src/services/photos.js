// Photo upload handling with a swappable storage backend.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, notFound } from '../lib/errors.js';
import { isStaff } from '../lib/access.js';

/** Local-disk storage. To move to S3/GCS later, implement the same save/read/remove interface. */
export class LocalDiskStorage {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  #file(name) {
    if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(name)) throw new Error('invalid stored name');
    return path.join(this.dir, name);
  }
  async save(name, buffer) { await fs.promises.writeFile(this.#file(name), buffer, { flag: 'wx', mode: 0o640 }); }
  async read(name) { return fs.promises.readFile(this.#file(name)); }
  async remove(name) { await fs.promises.rm(this.#file(name), { force: true }); }
}

/** Identify the REAL image type from magic bytes; the client-supplied filename and Content-Type are never trusted. */
export function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const COL = { lost: ['lost_reports', 'lost_report_id'], found: ['found_reports', 'found_report_id'] };

export async function savePhoto(db, storage, config, user, type, reportId, buffer) {
  const [table, col] = COL[type];
  const report = db.get(`SELECT id, user_id FROM ${table} WHERE id = ?`, reportId);
  if (!report || (report.user_id !== user.id && !isStaff(user))) throw notFound('Report not found');
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'No image received');
  if (buffer.length > config.maxUploadBytes) throw new HttpError(413, `Image is too large (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB)`);
  const kind = detectImage(buffer);
  if (!kind) throw new HttpError(415, 'Only JPEG, PNG or WebP images are allowed');
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  await storage.save(storedName, buffer);
  let previous;
  try {
    previous = db.tx(() => {
      const old = db.get(`SELECT stored_name FROM item_photos WHERE ${col} = ?`, reportId);
      db.run(`DELETE FROM item_photos WHERE ${col} = ?`, reportId);
      db.run(`INSERT INTO item_photos (${col}, stored_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?)`, reportId, storedName, kind.mime, buffer.length, user.id);
      return old;
    });
  } catch (e) {
    await storage.remove(storedName);
    throw e;
  }
  if (previous) await storage.remove(previous.stored_name);
  return { photo_url: `/uploads/${storedName}` };
}

/** Serve a photo. Photos of hidden reports are visible only to the owner and staff. */
export async function readPhoto(db, storage, user, name) {
  const row = db.get(
    `SELECT p.mime_type, COALESCE(l.is_hidden, f.is_hidden) AS hidden, COALESCE(l.user_id, f.user_id) AS owner
       FROM item_photos p LEFT JOIN lost_reports l ON l.id = p.lost_report_id LEFT JOIN found_reports f ON f.id = p.found_report_id
      WHERE p.stored_name = ?`, name);
  if (!row) throw notFound('Image not found');
  if (row.hidden && !(user && (user.id === row.owner || isStaff(user)))) throw notFound('Image not found');
  return { buffer: await storage.read(name), mime: row.mime_type };
}
